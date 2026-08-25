// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"nhooyr.io/websocket"
	"nhooyr.io/websocket/wsjson"
)

var (
	errAgentShutdown  = errors.New("agent shutting down")
	errAgentAuthFatal = errors.New("authentication failed")
)

// runAgentConnection establishes a single coordinator connection and services
// it until the connection drops (returning the cause) or the agent is told to
// shut down (returning errAgentShutdown).
func runAgentConnection(ctx context.Context, urlWithParams string, opts *websocket.DialOptions, coordinatorURL, token, name string, useSignatureAuth bool, privKey ed25519.PrivateKey, pubKeyHex string, disableTelemetry bool) error {
	c, resp, err := websocket.Dial(ctx, urlWithParams, opts)
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

	// Write loop
	outChan := make(chan interface{}, 50000)
	dispatcher := NewAgentDispatcher(coordinatorURL, token, disableTelemetry, outChan)

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

	go func() {
		for {
			select {
			case msg, ok := <-outChan:
				if !ok {
					return
				}
				b, err := json.Marshal(msg)
				if err != nil {
					logError("Failed to marshal WS message: %v", err)
					continue
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
					continue
				}
				if err := c.Write(connCtx, websocket.MessageText, b); err != nil {
					logError("Failed to write to WS: %v", err)
					_ = c.Close(websocket.StatusInternalError, "write error")
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

		dispatcher.Dispatch(ctx, wsMsg)
	}
}
