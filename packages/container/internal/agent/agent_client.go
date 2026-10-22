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

// Bounds on talking to the coordinator. A coordinator (or a proxy in front of it) that accepts the
// TCP connection and then stops answering would otherwise hold the agent for good: in the upgrade
// or the challenge handshake it never reaches the reconnect loop, and a write into a connection
// nobody reads blocks the write loop for good. When a write loop write fails, timed out or not,
// the loop closes the connection and the message goes to the next one (carry).
const (
	// connectTimeout covers the WebSocket upgrade and, with signature auth, the challenge
	// handshake, a cold coordinator included.
	connectTimeout = 60 * time.Second
	// writeTimeout bounds one write, however large its message. No ping goes out while a write
	// holds the connection, and a runner without a ping for heartbeatTimeout is treated as gone
	// by the coordinator (and the pong check below closes the connection), so a longer write
	// could not succeed anyway: a link too slow for a message within it cannot carry the scan.
	writeTimeout = heartbeatTimeout - heartbeatInterval
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
	connectTimeout    time.Duration
	writeTimeout      time.Duration

	// connectedAt is when the current connection finished its setup; zero until it has.
	connectedAt time.Time
}

func newAgentSession(coordinatorURL, token string, disableTelemetry bool) *agentSession {
	outChan := make(chan interface{}, 50000)
	s := &agentSession{
		outChan:    outChan,
		dispatcher: NewAgentDispatcher(coordinatorURL, token, disableTelemetry, outChan),
		carry:      make(chan interface{}, carryCapacity),

		heartbeatInterval: heartbeatInterval,
		heartbeatTimeout:  heartbeatTimeout,
		connectTimeout:    connectTimeout,
		writeTimeout:      writeTimeout,
	}
	// Still to reach the coordinator: queued, carried over from a failed write, or sent but not
	// acknowledged (with a coordinator that acknowledges).
	s.dispatcher.pendingOutput = func() bool {
		return len(s.outChan) > 0 || len(s.carry) > 0 || len(s.dispatcher.delivery.unackedRuns()) > 0
	}
	return s
}

// runConnection services one coordinator connection for this session.
func (s *agentSession) runConnection(ctx context.Context, urlWithParams string, opts *websocket.DialOptions, useSignatureAuth bool, privKey ed25519.PrivateKey) error {
	dialURL, runIDs, err := withResumeParam(urlWithParams, s.dispatcher.ResumeRunIDs())
	if err != nil {
		return err
	}
	setupCtx, setupCancel := context.WithTimeout(ctx, s.connectTimeout)
	defer setupCancel()
	c, resp, err := websocket.Dial(setupCtx, dialURL, opts)
	if err != nil {
		if resp != nil && (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) {
			logError("Critical Authentication Error: Unauthorized/Forbidden (Status Code: %d). Revoked or invalid credentials. Terminating agent process.", resp.StatusCode)
			return errAgentAuthFatal
		}
		return fmt.Errorf("failed to connect to coordinator: %w", err)
	}
	s.dispatcher.delivery.setEnabled(resp != nil && resp.Header.Get(deliveryHeader) == "ack")

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
		if err := wsjson.Read(setupCtx, c, &challengeMsg); err != nil {
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
		if err := wsjson.Write(setupCtx, c, responseMsg); err != nil {
			return fmt.Errorf("failed to send challenge response: %w", err)
		}

		var authResult struct {
			Type  string `json:"type"`
			Error string `json:"error"`
		}
		if err := wsjson.Read(setupCtx, c, &authResult); err != nil {
			return fmt.Errorf("failed to read authentication result: %w", err)
		}

		if authResult.Type == "auth_ok" {
			logInfo("✓ Authentication successful!")
		} else {
			logError("Critical Authentication Error: Handshake authentication failed: %s", authResult.Error)
			return errAgentAuthFatal
		}
	}

	setupCancel()
	s.connectedAt = time.Now()
	logInfo("Successfully connected to coordinator. Awaiting jobs...")

	// writing counts the writes in progress other than pings, so the heartbeat can skip a ping
	// instead of waiting behind a long write (and checking for the pong late).
	var writing atomic.Int32
	writeWithin := func(b []byte) error {
		wctx, cancel := context.WithTimeout(connCtx, s.writeTimeout)
		defer cancel()
		return c.Write(wctx, websocket.MessageText, b)
	}
	write := func(b []byte) error {
		writing.Add(1)
		defer writing.Add(-1)
		return writeWithin(b)
	}

	if len(runIDs) > 0 {
		// The coordinator decides which claims it honours; events of a refused run are dropped there.
		logInfo("Claimed %d active run(s) for resume on the new connection", len(runIDs))
	}

	// Write loop
	go func() {
		// Highest seq of each run's current execution written on this connection. Replayed events
		// are still in the queue too (or carried over); those copies are skipped.
		type sentMark struct {
			exec string
			seq  uint64
		}
		sentUpTo := make(map[string]sentMark)
		// When each run was last written to. Once a run has been quiet for ackRequestDelay, the
		// agent asks for acknowledgement of what the coordinator did not acknowledge on its own;
		// per run, so a run that keeps streaming does not hold back another one's tail.
		lastWrite := make(map[string]time.Time)
		ackTimer := time.NewTimer(ackRequestDelay)
		ackTimer.Stop()
		ackTimerArmed := false
		defer ackTimer.Stop()
		send := func(msg interface{}) bool {
			ev, sequenced := msg.(WSEventOut)
			sequenced = sequenced && ev.Seq > 0
			if mark, ok := sentUpTo[ev.RunID]; sequenced && ok && mark.exec == ev.Exec && ev.Seq <= mark.seq {
				return true
			}
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
			if err := write(b); err != nil {
				logError("Failed to write to WS: %v", err)
				// An ack request speaks only for the connection it was written on.
				if _, isAckRequest := msg.(ackRequestMsg); !isAckRequest {
					select {
					case s.carry <- msg:
					default:
						logError("Dropping a message that failed to send: the resend buffer is full")
					}
				}
				_ = c.Close(websocket.StatusInternalError, "write error")
				return false
			}
			if sequenced {
				sentUpTo[ev.RunID] = sentMark{exec: ev.Exec, seq: ev.Seq}
				lastWrite[ev.RunID] = time.Now()
				if !ackTimerArmed {
					ackTimer.Reset(ackRequestDelay)
					ackTimerArmed = true
				}
			}
			return true
		}
		requestAcks := func() bool {
			ackTimerArmed = false
			now := time.Now()
			var nextDue time.Duration
			for runID, at := range lastWrite {
				if quiet := now.Sub(at); quiet < ackRequestDelay {
					if wait := ackRequestDelay - quiet; nextDue == 0 || wait < nextDue {
						nextDue = wait
					}
					continue
				}
				delete(lastWrite, runID)
				mark := sentUpTo[runID]
				if req, ok := s.dispatcher.delivery.ackRequest(runID, mark.exec, mark.seq); ok {
					if !send(req) {
						return false
					}
				}
			}
			if nextDue > 0 && !ackTimerArmed {
				ackTimer.Reset(nextDue)
				ackTimerArmed = true
			}
			return true
		}
		// Everything the coordinator has not acknowledged goes first: whatever was written into
		// the previous connection may never have arrived. It drops the seqs it already has.
		for _, msg := range s.dispatcher.delivery.replay(s.dispatcher.isActive) {
			if !send(msg) {
				return
			}
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
			case <-ackTimer.C:
				if !requestAcks() {
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
				dispatcher.delivery.gc(dispatcher.isActive)
				// A coordinator without heartbeat support never answers; only enforce the
				// timeout once it has shown it does.
				if last := lastPong.Load(); last != 0 && time.Since(time.Unix(0, last)) > s.heartbeatTimeout {
					logError("No heartbeat reply from coordinator for %v; reconnecting", s.heartbeatTimeout)
					// CloseNow: the peer is gone, and a close handshake would wait behind a
					// stuck write for up to 10 s.
					_ = c.CloseNow()
					return
				}
				// No ping while another write holds the connection: the pong check above keeps
				// running on time, and a closed connection ends this loop through connCtx.
				if writing.Load() == 0 {
					_ = writeWithin([]byte(heartbeatPing))
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
