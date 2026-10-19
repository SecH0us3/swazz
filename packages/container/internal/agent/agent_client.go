// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package agent

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"nhooyr.io/websocket"
	"nhooyr.io/websocket/wsjson"
)

var (
	errAgentShutdown  = errors.New("agent shutting down")
	errAgentAuthFatal = errors.New("authentication failed")
)

// Heartbeat: the agent sends heartbeatPing every heartbeatInterval. The coordinator answers it
// with heartbeatPong without waking up (a Durable Object WebSocket auto-response) and uses the time
// of the last ping to drop connections that died without a close frame. Once a pong has been seen,
// the agent likewise treats heartbeatTimeout without one as a dead connection and reconnects.
// carryCapacity bounds the messages handed from a failed connection to the next one: one per
// write goroutine that dies mid-write, so a handful is plenty.
const carryCapacity = 64

const (
	heartbeatPing     = `{"type":"ping"}`
	heartbeatInterval = 30 * time.Second
	heartbeatTimeout  = 90 * time.Second
)

// agentSession is the part of the agent that outlives a single coordinator connection: the
// dispatcher with its running scans and the queue of messages they emit. Scans keep running
// across a reconnect; their events wait in the queue and go out over the next connection, which
// names the runs it still holds in its URL (?resume=) so the coordinator hands them over before
// it dispatches anything else.
type agentSession struct {
	outChan    chan interface{}
	dispatcher *AgentDispatcher
	// carry holds messages whose write failed when a connection dropped (possibly only after the
	// next connection is up); the live connection sends them ahead of the queue.
	carry chan interface{}

	heartbeatInterval time.Duration
	heartbeatTimeout  time.Duration
}

func newAgentSession(coordinatorURL, token string, disableTelemetry bool) *agentSession {
	outChan := make(chan interface{}, 50000)
	return &agentSession{
		outChan:    outChan,
		dispatcher: NewAgentDispatcher(coordinatorURL, token, disableTelemetry, outChan),
		carry:      make(chan interface{}, carryCapacity),

		heartbeatInterval: heartbeatInterval,
		heartbeatTimeout:  heartbeatTimeout,
	}
}

// runConnection services one coordinator connection for this session.
func (s *agentSession) runConnection(ctx context.Context, urlWithParams string, opts *websocket.DialOptions, useSignatureAuth bool, privKey ed25519.PrivateKey) error {
	dialURL, runIDs, err := withResumeParam(urlWithParams, s.dispatcher.ActiveRunIDs())
	if err != nil {
		return err
	}
	c, resp, err := websocket.Dial(ctx, dialURL, opts)
	if err != nil {
		if resp != nil && (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) {
			logError("Critical Authentication Error: Unauthorized/Forbidden (Status Code: %d). Revoked or invalid credentials. Terminating agent process.", resp.StatusCode)
			return errAgentAuthFatal
		}
		return fmt.Errorf("failed to connect to coordinator: %w", err)
	}

	// Increase read limit to 50MB to support large HAR payloads from the browser extension
	c.SetReadLimit(50 * 1024 * 1024)

	connCtx, connCancel := context.WithCancel(ctx)
	defer connCancel()

	dispatcher := s.dispatcher

	// Add graceful shutdown handler to prevent abrupt WebSocket closures
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sigCh)
	go func() {
		select {
		case <-sigCh:
			logInfo("Received termination signal, shutting down agent gracefully...")
			dispatcher.StopAllRunners()
			time.Sleep(500 * time.Millisecond)
			_ = c.Close(websocket.StatusNormalClosure, "agent shutting down")
			os.Exit(0)
		case <-connCtx.Done():
			return
		}
	}()

	defer c.Close(websocket.StatusInternalError, "internal error")

	if useSignatureAuth {
		logInfo("Performing challenge-response authentication handshake...")
		var challengeMsg struct {
			Type  string `json:"type"`
			Nonce string `json:"nonce"`
		}
		if err := wsjson.Read(ctx, c, &challengeMsg); err != nil {
			return fmt.Errorf("failed to read challenge message from coordinator: %w", err)
		}

		if challengeMsg.Type != "challenge" {
			return fmt.Errorf("expected challenge message, got: %s", challengeMsg.Type)
		}

		if challengeMsg.Nonce == "" {
			return fmt.Errorf("challenge message missing nonce")
		}

		signatureHex := signChallenge(privKey, challengeMsg.Nonce)

		responseMsg := map[string]interface{}{
			"type":      "challenge_response",
			"signature": signatureHex,
		}
		if err := wsjson.Write(ctx, c, responseMsg); err != nil {
			return fmt.Errorf("failed to send challenge response: %w", err)
		}

		var authResult struct {
			Type  string `json:"type"`
			Error string `json:"error"`
		}
		if err := wsjson.Read(ctx, c, &authResult); err != nil {
			return fmt.Errorf("failed to read authentication result: %w", err)
		}

		if authResult.Type == "auth_ok" {
			logInfo("✓ Authentication successful!")
		} else {
			logError("Critical Authentication Error: Handshake authentication failed: %s", authResult.Error)
			return errAgentAuthFatal
		}
	}

	logInfo("Successfully connected to coordinator. Awaiting jobs...")

	if len(runIDs) > 0 {
		// The coordinator decides which claims it honours; events of a refused run are dropped there.
		logInfo("Claimed %d active run(s) for resume on the new connection", len(runIDs))
	}

	// Write loop
	go func() {
		send := func(msg interface{}) bool {
			b, err := json.Marshal(msg)
			if err != nil {
				logError("Failed to marshal WS message: %v", err)
				return true
			}
			if len(b) > 1*1024*1024 {
				payloadType := "unknown"
				if eventOut, ok := msg.(WSEventOut); ok {
					payloadType = fmt.Sprintf("%T", eventOut.Payload)
					if eventPayload, ok := eventOut.Payload.(WSEventPayload); ok {
						payloadType = fmt.Sprintf("WSEventPayload with Data: %T", eventPayload.Data)
					}
				}
				logError("WS message is too large: %d bytes. Payload type: %s. Dropping message to prevent WebSocket close.", len(b), payloadType)
				return true
			}
			if err := c.Write(connCtx, websocket.MessageText, b); err != nil {
				logError("Failed to write to WS: %v", err)
				select {
				case s.carry <- msg:
				default:
					logError("Dropping a message that failed to send: the resend buffer is full")
				}
				_ = c.Close(websocket.StatusInternalError, "write error")
				return false
			}
			return true
		}
		for {
			// Messages carried over from a failed connection go first, whenever they arrive.
			select {
			case msg := <-s.carry:
				if !send(msg) {
					return
				}
				continue
			default:
			}
			select {
			case msg := <-s.carry:
				if !send(msg) {
					return
				}
			case msg := <-s.outChan:
				if !send(msg) {
					return
				}
			case <-connCtx.Done():
				return
			}
		}
	}()

	// Heartbeat loop
	var lastPong atomic.Int64 // unix nanos of the last pong; 0 until the coordinator answers one
	go func() {
		ticker := time.NewTicker(s.heartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				// A coordinator without heartbeat support never answers; only enforce the
				// timeout once it has shown it does.
				if last := lastPong.Load(); last != 0 && time.Since(time.Unix(0, last)) > s.heartbeatTimeout {
					logError("No heartbeat reply from coordinator for %v; reconnecting", s.heartbeatTimeout)
					_ = c.Close(websocket.StatusGoingAway, "heartbeat timeout")
					return
				}
				if err := c.Write(connCtx, websocket.MessageText, []byte(heartbeatPing)); err != nil {
					return
				}
			case <-connCtx.Done():
				return
			}
		}
	}()

	// Agent message loop
	for {
		var wsMsg WSMessageIn
		if err := wsjson.Read(ctx, c, &wsMsg); err != nil {
			logError("Connection read error: %v", err)
			return err
		}
		if wsMsg.Type == "pong" {
			lastPong.Store(time.Now().UnixNano())
			continue
		}

		dispatcher.Dispatch(ctx, wsMsg)
	}
}

// withResumeParam adds the runs this agent is still executing to the connection URL. The
// coordinator hands each one back to this connection only if it was dispatched to the same
// runner identity, so the list is a claim, not a credential.
func withResumeParam(rawURL string, runIDs []string) (string, []string, error) {
	if len(runIDs) == 0 {
		return rawURL, nil, nil
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", nil, fmt.Errorf("invalid coordinator URL: %w", err)
	}
	q := u.Query()
	q.Set("resume", strings.Join(runIDs, ","))
	u.RawQuery = q.Encode()
	return u.String(), runIDs, nil
}
