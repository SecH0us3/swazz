// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"swazz-engine/internal/ai"
	"swazz-engine/internal/classifier"
	"swazz-engine/internal/graphql"
	"swazz-engine/internal/grpc"
	"swazz-engine/internal/har"
	"swazz-engine/internal/license"
	"swazz-engine/internal/logger"
	"swazz-engine/internal/mcp"
	"swazz-engine/internal/postman"
	"swazz-engine/internal/proto"
	"swazz-engine/internal/runner"
	"swazz-engine/internal/safenet"
	"swazz-engine/internal/swagger"
	"swazz-engine/internal/ws"
	"swazz-engine/internal/triage"
	"sync"
	"syscall"
	"time"

	"nhooyr.io/websocket"
	"nhooyr.io/websocket/wsjson"
)

// startAgent parses the arguments and connects to the coordinator
func startAgent(args []string) {
	var coordinatorURL, token, name, keyPathOrHex, logLevelStr, logFilterStr string
	var dangerousNoContainer bool
	var hasQuiet, hasLogLevel bool
	var disableTelemetry bool

	// Simple arg parsing
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--dangerous-no-container":
			dangerousNoContainer = true
		case "--disable-telemetry":
			disableTelemetry = true
		case "--log-level", "-log-level":
			if i+1 < len(args) {
				logLevelStr = args[i+1]
				hasLogLevel = true
				i++
			}
		case "--quiet", "-quiet", "-q", "--q":
			hasQuiet = true
		case "--log-filter":
			if i+1 < len(args) {
				logFilterStr = args[i+1]
				logger.SetFilter(logFilterStr)
				i++
			}
		case "--coordinator":
			if i+1 < len(args) {
				coordinatorURL = args[i+1]
				i++
			}
		case "--token":
			if i+1 < len(args) {
				token = args[i+1]
				i++
			}
		case "--key":
			if i+1 < len(args) {
				keyPathOrHex = args[i+1]
				i++
			}
		case "--name":
			if i+1 < len(args) {
				name = args[i+1]
				i++
			}
		case "--help", "-h":
			printHelp()
			os.Exit(0)
		}
	}

	if os.Getenv("SWAZZ_DISABLE_TELEMETRY") == "true" {
		disableTelemetry = true
	}

	var finalLevel string
	envLevel := os.Getenv("SWAZZ_LOG_LEVEL")
	if envLevel != "" {
		finalLevel = envLevel
	} else {
		finalLevel = "info"
	}

	if hasQuiet {
		finalLevel = "error"
	}
	if hasLogLevel {
		finalLevel = logLevelStr
	}

	logger.SetLevelByName(finalLevel)

	agentLicenseKey := os.Getenv("SWAZZ_LICENSE_KEY")
	if agentLicenseKey != "" {
		lic, err := license.LoadAndVerify(agentLicenseKey)
		if err != nil {
			logWarn("⚠️  License verification failed: %v (running in community mode)", err)
		} else if lic != nil {
			logInfo("🔑 Enterprise license active: %s (expires %s)", lic.Company, lic.ExpiresAt.Format("2006-01-02"))
			if lic.IsExpiringSoon(3) {
				logWarn("⚠️  License expires soon: %d day(s) remaining (expires %s)", lic.DaysRemaining(), lic.ExpiresAt.Format("2006-01-02"))
			}
		}
	}

	safenet.AssertRunningInContainer(dangerousNoContainer)

	if coordinatorURL == "" {
		fmt.Println("Error: --coordinator is required for run-agent.")
		fmt.Println()
		printHelp()
		os.Exit(1)
	}

	var privKey ed25519.PrivateKey
	var pubKeyHex string
	var useSignatureAuth bool

	// If --key wasn't passed and --token wasn't passed, check default ./swazz_runner.key
	if keyPathOrHex == "" && token == "" {
		if _, err := os.Stat("./swazz_runner.key"); err == nil {
			keyPathOrHex = "./swazz_runner.key"
		}
	}

	if keyPathOrHex != "" {
		var err error
		privKey, err = loadPrivateKey(keyPathOrHex)
		if err != nil {
			log.Fatalf("Error loading private key: %v", err)
		}
		pubKey := privKey.Public().(ed25519.PublicKey)
		pubKeyHex = hex.EncodeToString(pubKey)
		useSignatureAuth = true
	} else {
		if token == "" {
			fmt.Println("Error: --coordinator and either --token or a private key are required for run-agent.")
			fmt.Println()
			printHelp()
			os.Exit(1)
		}
	}

	if name == "" {
		hostname, _ := os.Hostname()
		name = "runner-" + hostname
	}

	logInfo("Starting agent '%s', connecting to %s (log level: %s)", name, coordinatorURL, logLevelStr) // #nosec G706

	headers := make(http.Header)
	headers.Set("User-Agent", "Swazz/1.0 (+https://github.com/SecH0us3/swazz)")
	u, err := url.Parse(coordinatorURL)
	if err != nil {
		log.Fatalf("Failed to parse coordinator URL: %v", err)
	}
	q := u.Query()
	q.Set("name", name)
	agentVer := Version
	if agentVer == "dev" {
		agentVer = "v1.0.0"
	}
	q.Set("version", agentVer)
	u.RawQuery = q.Encode()
	urlWithParams := u.String()

	if useSignatureAuth {
		headers.Set("X-Runner-Public-Key", pubKeyHex)
	} else {
		// Validate token to prevent security issues
		if strings.Contains(token, ";") || strings.Contains(token, "&") || strings.Contains(token, "|") {
			log.Fatalf("Token contains suspicious characters")
		}
		headers.Set("Authorization", "Bearer "+token)
	}

	opts := &websocket.DialOptions{
		Subprotocols: []string{"swazz-agent"},
		HTTPHeader:   headers,
	}

	ctx := context.Background()

	// Auto-reconnect loop: `wrangler dev` can crash and restart mid-session
	// (miniflare "Network connection lost"), which drops this WebSocket. Instead
	// of terminating the agent, retry the connection with exponential backoff so
	// the runner survives coordinator restarts.
	backoff := 2 * time.Second
	const maxBackoff = 30 * time.Second
	for {
		runErr := runAgentConnection(ctx, urlWithParams, opts, coordinatorURL, token, name, useSignatureAuth, privKey, pubKeyHex, disableTelemetry)
		if runErr == nil {
			return
		}
		if errors.Is(runErr, errAgentShutdown) {
			return
		}
		if errors.Is(runErr, errAgentAuthFatal) {
			os.Exit(1)
		}
		logError("Agent connection lost (%v). Reconnecting in %v...", runErr, backoff)
		time.Sleep(backoff)
		if backoff < maxBackoff {
			backoff *= 2
		}
	}
}

var (
	errAgentShutdown  = errors.New("agent shutting down")
	errAgentAuthFatal = errors.New("authentication failed")
)

// runAgentConnection establishes a single coordinator connection and services
// it until the connection drops (returning the cause) or the agent is told to
// shut down (returning errAgentShutdown).
func runAgentConnection(ctx context.Context, urlWithParams string, opts *websocket.DialOptions, coordinatorURL, token, name string, useSignatureAuth bool, privKey ed25519.PrivateKey, pubKeyHex string, disableTelemetry bool) error {
	var (
		activeRunners   = make(map[string]*runner.Runner)
		activeRunnersMu sync.Mutex
	)

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

	// Add graceful shutdown handler to prevent abrupt WebSocket closures
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sigCh)
	go func() {
		select {
		case <-sigCh:
			logInfo("Received termination signal, shutting down agent gracefully...")
			activeRunnersMu.Lock()
			for _, r := range activeRunners {
				r.Stop()
			}
			activeRunnersMu.Unlock()
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

		// Sign the raw nonce bytes directly as a string
		signatureBytes := ed25519.Sign(privKey, []byte(challengeMsg.Nonce))
		signatureHex := hex.EncodeToString(signatureBytes)

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

	// Write loop
	outChan := make(chan interface{}, 50000)
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
	sendWSEvent := func(runID, typ string, payload interface{}) {
		outChan <- WSEventOut{
			Type:  "event",
			RunID: runID,
			Payload: WSEventPayload{
				Type: typ,
				Data: payload,
			},
		}
	}

	sendWSError := func(runID, errStr string) {
		outChan <- WSEventOut{
			Type:  "error",
			RunID: runID,
			Payload: map[string]string{
				"error": errStr,
			},
		}
	}

	// Agent loop
	for {
		var wsMsg WSMessageIn
		if err := wsjson.Read(ctx, c, &wsMsg); err != nil {
			logError("Connection read error: %v", err)
			return err
		}

		switch wsMsg.Type {
		case "agent_restart":
			logInfo("Received remote restart request. Stopping active jobs...")
			activeRunnersMu.Lock()
			for _, r := range activeRunners {
				r.Stop()
			}
			activeRunnersMu.Unlock()
			// Allow a brief grace period for runners to stop and send final events
			time.Sleep(1 * time.Second)
			os.Exit(0)

		case "oob_trigger":
			var trigger struct {
				RunID string `json:"runId"`
				UUID  string `json:"uuid"`
			}
			if len(wsMsg.Payload) > 0 {
				if err := json.Unmarshal(wsMsg.Payload, &trigger); err != nil {
					logError("Failed to unmarshal oob_trigger payload: %v", err)
					continue
				}
			}
			if trigger.RunID == "" {
				trigger.RunID = wsMsg.RunID
			}
			if trigger.UUID == "" {
				trigger.UUID = wsMsg.UUID
			}
			if trigger.RunID == "" || trigger.UUID == "" {
				logError("Failed to unmarshal oob_trigger: missing runId or uuid")
				continue
			}
			activeRunnersMu.Lock()
			r, exists := activeRunners[trigger.RunID]
			activeRunnersMu.Unlock()
			if exists {
				logInfo("Received OOB trigger for runID %s, UUID %s", trigger.RunID, trigger.UUID)
				r.HandleOOBTrigger(trigger.UUID)
			} else {
				logWarn("OOB trigger received but active runner not found for runID %s", trigger.RunID)
			}

		case "job_dispatch":
			var dispatch JobDispatchPayload
			if err := json.Unmarshal(wsMsg.Payload, &dispatch); err != nil {
				logError("Failed to unmarshal JobDispatchPayload: %v", err)
				continue
			}

			logInfo("Received job dispatch for runID: %s", dispatch.RunID)

			if dispatch.Config.LicenseKey != "" {
				jobLic, licErr := license.LoadAndVerify(dispatch.Config.LicenseKey)
				if licErr != nil {
					logWarn("[%s] License verification failed for job: %v", dispatch.RunID, licErr)
				} else if jobLic != nil {
					logInfo("[%s] Job license active: %s (expires %s)", dispatch.RunID, jobLic.Company, jobLic.ExpiresAt.Format("2006-01-02"))
					if jobLic.IsExpiringSoon(3) {
						logWarn("[%s] ⚠️  Job license expires soon: %d day(s) remaining (expires %s)", dispatch.RunID, jobLic.DaysRemaining(), jobLic.ExpiresAt.Format("2006-01-02"))
					}
				}
			}

			runCfg, err := BuildRunnerConfig(&dispatch.Config)
			if err != nil {
				logError("Failed to build runner config: %v", err)
				errMsg := fmt.Sprintf("[Runner] Cannot start scan: %v. Please import an OpenAPI/Swagger schema, capture endpoints, or set a target URL with spec.", err)
				sendWSEvent(dispatch.RunID, "runner_log", map[string]interface{}{
					"level":     "ERROR",
					"message":   errMsg,
					"timestamp": time.Now().Format(time.RFC3339),
				})
				sendWSError(dispatch.RunID, err.Error())
				continue
			}
			runCfg.RunID = dispatch.RunID
			if runCfg.Settings.OOBServerURL == "" {
				runCfg.Settings.OOBServerURL = inferOOBServerURL(coordinatorURL)
			}

			var client *http.Client
			if runCfg.Security.AllowPrivateIPs || safenet.AllowLocalNetwork {
				client = &http.Client{Timeout: time.Duration(runCfg.Settings.TimeoutMs) * time.Millisecond}
			} else {
				client = safenet.NewSafeHTTPClient(time.Duration(runCfg.Settings.TimeoutMs) * time.Millisecond)
			}
			r := runner.New(runCfg, client)

			activeRunnersMu.Lock()
			activeRunners[dispatch.RunID] = r
			activeRunnersMu.Unlock()

			// Build a classifier that respects the job's rules config so that
			// live-severity in WebSocket streaming matches the final report.
			liveClsRules := &classifier.RulesConfig{}
			if runCfg.Rules != nil {
				liveClsRules.Ignore = runCfg.Rules.Ignore
				if len(runCfg.Rules.Severity) > 0 {
					liveClsRules.Severity = make(map[string]classifier.Severity, len(runCfg.Rules.Severity))
					for k, v := range runCfg.Rules.Severity {
						liveClsRules.Severity[k] = classifier.Severity(v)
					}
				}
				if len(runCfg.Rules.Defaults) > 0 {
					liveClsRules.Defaults = make(map[string]classifier.Severity, len(runCfg.Rules.Defaults))
					for k, v := range runCfg.Rules.Defaults {
						liveClsRules.Defaults[k] = classifier.Severity(v)
					}
				}
				if len(runCfg.Rules.IgnoreRules) > 0 {
					liveClsRules.IgnoreRules = runCfg.Rules.IgnoreRules
				}
			}
			liveCls := classifier.New(liveClsRules)

			// Sub to events
			sub := r.Subscribe()
			go func(runID string) {
				defer r.Unsubscribe(sub)
				for ev := range sub {
					if ev.Type == "result" {
						var res *swagger.FuzzResult
						if rPtr, ok := ev.Data.(*swagger.FuzzResult); ok {
							res = rPtr
						} else if rVal, ok := ev.Data.(swagger.FuzzResult); ok {
							res = &rVal
						}
						if res != nil {
							severity := "ignore"
							description := fmt.Sprintf("HTTP %d", res.Status)
							if len(res.AnalyzerFindings) > 0 {
								severity = res.AnalyzerFindings[0].Level
								description = res.AnalyzerFindings[0].Message
							} else {
								finding := liveCls.Classify(res)
								if finding != nil {
									severity = string(finding.Level)
									description = fmt.Sprintf("HTTP %d", res.Status)
								}
							}
							logInfo("[Fuzz Result] Run %s: %s %s -> %d (Severity: %s) - %s",
								runID, res.Method, res.ResolvedPath, res.Status, severity, description)
							ev.Data = runner.ToSSE(res)
						} else {
							logError("Received result event but ev.Data is not a recognized FuzzResult type: %T", ev.Data)
						}
					} else if ev.Type == "progress" {
						var msg string
						if stats, ok := ev.Data.(swagger.RunStats); ok {
							msg = fmt.Sprintf("[Fuzz Progress] %d/%d requests (%s, concurrency: %d) | %d endpoints complete",
								stats.TotalRequests, stats.TotalPlanned, stats.Progress.CurrentProfile, stats.Concurrency, stats.Progress.CompletedEndpoints)
							logInfo("Run %s: %s", runID, msg)
						} else {
							statsJSON, _ := json.Marshal(ev.Data)
							msg = string(statsJSON)
							logInfo("[Fuzz Progress] Run %s: %s", runID, msg)
						}
						sendWSEvent(runID, "runner_log", map[string]interface{}{
							"level":     "info",
							"message":   msg,
							"timestamp": time.Now().Format(time.RFC3339),
						})
					} else if ev.Type == "complete" {
						var msg string
						if stats, ok := ev.Data.(swagger.RunStats); ok {
							msg = fmt.Sprintf("[Fuzz Complete] finished with %d requests, duration: %v",
								stats.TotalRequests, time.Duration(stats.TotalDurationMs)*time.Millisecond)
							logInfo("Run %s: %s", runID, msg)
						} else {
							statsJSON, _ := json.Marshal(ev.Data)
							msg = string(statsJSON)
							logInfo("[Fuzz Complete] Run %s: %s", runID, msg)
						}
						sendWSEvent(runID, "runner_log", map[string]interface{}{
							"level":     "warning",
							"message":   msg,
							"timestamp": time.Now().Format(time.RFC3339),
						})
					} else if ev.Type == "error" {
						logError("[Fuzz Error] Run %s: %v", runID, ev.Data)
						sendWSEvent(runID, "runner_log", map[string]interface{}{
							"level":     "error",
							"message":   fmt.Sprintf("%v", ev.Data),
							"timestamp": time.Now().Format(time.RFC3339),
						})
					}
					sendWSEvent(runID, ev.Type, ev.Data)
				}
			}(dispatch.RunID)

		go func(runID string) {
				sendRunnerLog := func(level, msg string) {
					sendWSEvent(runID, "runner_log", map[string]interface{}{
						"level":     level,
						"message":   msg,
						"timestamp": time.Now().Format(time.RFC3339),
					})
				}

				logInfo("Starting fuzz runner for runID: %s", runID)
				sendRunnerLog("warning", fmt.Sprintf("Starting fuzz runner for runID: %s", runID))
				if r.Config() != nil && r.Config().Settings.UseLLMPrepass {
					msg := fmt.Sprintf("[AI] 🤖 Pre-Scan LLM Batching enabled (Gateway: %s)", r.Config().Settings.AIGatewayURL)
					logInfo("%s", msg)
					sendRunnerLog("info", msg)
				} else {
					msg := "[AI] ℹ️ Pre-Scan LLM Batching is disabled in Project Settings"
					logInfo("%s", msg)
					sendRunnerLog("info", msg)
				}
				tURL := deriveTelemetryURL(coordinatorURL)
				incrementGlobalScanTelemetry(tURL, disableTelemetry)
				if err := r.Start(ctx); err != nil {
					logError("Runner failed: %v", err)
					sendWSError(runID, err.Error())
				}

				// Post-scan Smart Triage (LLM False Positive Classifier)
				if r.Config() != nil && r.Config().Settings.EnableSmartTriage && r.Config().Settings.AIGatewayURL != "" {
					msg := fmt.Sprintf("[AI] 🤖 Running Smart Triage (LLM False Positive Classifier) via %s...", r.Config().Settings.AIGatewayURL)
					logInfo("%s", msg)
					sendRunnerLog("info", msg)

					apiKey := os.Getenv("OPENAI_API_KEY")
					if apiKey == "" {
						apiKey = os.Getenv("GEMINI_API_KEY")
					}
					gwClient := ai.NewGatewayClient(r.Config().Settings.AIGatewayURL, r.Config().Settings.CFAigToken, apiKey)
					triager := triage.NewOrchestrator(gwClient, r.Config().Settings.GetMaxTriagePerScan())
					triageResults := triager.Run(ctx, r.Results())

					if len(triageResults) > 0 {
						if patchErr := sendTriageBatchToEdge(coordinatorURL, token, runID, triageResults); patchErr != nil {
							logError("Failed to send triage results to Edge API: %v", patchErr)
							sendRunnerLog("warning", fmt.Sprintf("[AI] ⚠️ Failed to upload triage results: %v", patchErr))
						} else {
							sendRunnerLog("info", fmt.Sprintf("[AI] ✅ Successfully applied Smart Triage to %d defect groups", len(triageResults)))
						}
					}
				}

				r.Close()
				logInfo("Runner for %s finished", runID)

				activeRunnersMu.Lock()
				delete(activeRunners, runID)
				activeRunnersMu.Unlock()
			}(dispatch.RunID)

		case "job_command":
			var cmd JobCommandPayload
			if err := json.Unmarshal(wsMsg.Payload, &cmd); err != nil {
				logError("Failed to unmarshal JobCommandPayload: %v", err)
				continue
			}

			activeRunnersMu.Lock()
			r, exists := activeRunners[cmd.RunID]
			activeRunnersMu.Unlock()

			if !exists {
				logWarn("Runner not found for %s", cmd.RunID)
				continue
			}

			logInfo("Received command '%s' for runID: %s", cmd.Command, cmd.RunID)
			switch cmd.Command {
			case "stop":
				r.Stop()
			case "pause":
				r.Pause()
			case "resume":
				r.Resume()
			}

		case "parse_request":
			var reqPayload struct {
				URL     string            `json:"url"`
				RawSpec string            `json:"rawSpec"`
				Headers map[string]string `json:"headers"`
				Cookies map[string]string `json:"cookies"`
			}
			if err := json.Unmarshal(wsMsg.Payload, &reqPayload); err != nil {
				logError("Failed to unmarshal parse_request payload: %v", err)
				continue
			}
			reqID := wsMsg.ReqID

			logInfo("[Parser] Received parse request. URL: %s, Has RawSpec: %v", reqPayload.URL, reqPayload.RawSpec != "")
			go func() { // #nosec G118 -- parse request handles asynchronous spec fetching
				var result interface{}
				var data []byte
				var err error
				var resp *http.Response
				var parseResult *swagger.ParseResult
				var parseErr error
				var originalErr error

				if reqPayload.URL != "" && swagger.IsWSURL(reqPayload.URL) {
					wsResult, wsErr := ws.SynthesizeWSEndpoint(reqPayload.URL)
					if wsErr != nil {
						err = fmt.Errorf("failed to synthesize ws endpoint: %w", wsErr)
					} else {
						parseResult = wsResult
						parseErr = nil
					}
				} else if reqPayload.URL != "" && swagger.IsGRPCURL(reqPayload.URL) {
					isTLS := strings.HasPrefix(strings.ToLower(reqPayload.URL), "grpcs://")
					grpcCtx, grpcCancel := context.WithTimeout(context.Background(), 10*time.Second)
					defer grpcCancel()
					grpcResult, grpcErr := grpc.DiscoverViaReflection(grpcCtx, reqPayload.URL, isTLS, reqPayload.Headers)
					if grpcErr != nil {
						err = fmt.Errorf("failed to discover gRPC service via reflection: %w", grpcErr)
					} else {
						parseResult = grpcResult
						parseErr = nil
					}
				} else if reqPayload.RawSpec != "" && swagger.IsAsyncAPISpec([]byte(reqPayload.RawSpec)) {
					parseResult, parseErr = ws.ParseAsyncAPISpec([]byte(reqPayload.RawSpec), reqPayload.URL)
				} else if reqPayload.RawSpec != "" && swagger.IsProtoFile([]byte(reqPayload.RawSpec)) {
					parseResult, parseErr = proto.ParseProtoBytes("upload.proto", []byte(reqPayload.RawSpec), "")
				} else if reqPayload.RawSpec != "" {
					// Validate rawSpec to prevent injection attacks.
					// Only reject template-literal style markers (e.g. "{{{")
					// used by SST/Cloudflare template engines. A plain "}}}"
					// legitimately appears in nested JSON/YAML specs.
					if strings.Contains(reqPayload.RawSpec, "{{{") {
						err = fmt.Errorf("rawSpec contains suspicious patterns")
					} else {
						data = []byte(reqPayload.RawSpec)
					}
				} else if reqPayload.URL != "" {
					client := safenet.NewSafeHTTPClient(15 * time.Second)

					req, reqErr := http.NewRequest("GET", reqPayload.URL, nil)
					if reqErr != nil {
						err = reqErr
					} else {
						for k, v := range reqPayload.Headers {
							req.Header.Set(k, v)
						}
						if len(reqPayload.Cookies) > 0 {
							var cookieParts []string
							for k, v := range reqPayload.Cookies {
								cookieParts = append(cookieParts, fmt.Sprintf("%s=%s", k, v))
							}
							req.Header.Set("Cookie", strings.Join(cookieParts, "; "))
						}

						var errFetch error
						resp, errFetch = client.Do(req)
						if errFetch != nil {
							logError("[Parser] Failed to fetch spec: %v", errFetch)
							err = errFetch
						} else {
							defer resp.Body.Close()
							if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
								limitReader := io.LimitReader(resp.Body, 4096)
								bodyBytes, _ := io.ReadAll(limitReader)
								err = fmt.Errorf("authentication required (HTTP %d). Please configure custom headers or cookies in the right panel. %s", resp.StatusCode, string(bytes.TrimSpace(bodyBytes)))
								data = bodyBytes
							} else {
								limitReader := io.LimitReader(resp.Body, 10*1024*1024+1)
								data, err = io.ReadAll(limitReader)
								if err == nil && len(data) > 10*1024*1024 {
									err = fmt.Errorf("specification file exceeds the 10MB limit")
								}
							}
							if err == nil && (resp.StatusCode < 200 || resp.StatusCode >= 300) {
								err = fmt.Errorf("server returned status code: %s", resp.Status)
							}
						}
					}
				} else {
					err = fmt.Errorf("missing url or rawSpec")
				}

				if err != nil {
					errMap := map[string]interface{}{
						"error": err.Error(),
					}
					if resp != nil {
						respHeaders := make(map[string]string)
						for k, v := range resp.Header {
							if len(v) > 0 {
								respHeaders[k] = v[0]
							}
						}
						bodySnippet := ""
						if data != nil {
							if len(data) > 2048 {
								bodySnippet = string(data[:2048]) + "... (truncated)"
							} else {
								bodySnippet = string(data)
							}
						}
						errMap["response"] = map[string]interface{}{
							"status":     resp.StatusCode,
							"statusText": resp.Status,
							"headers":    respHeaders,
							"body":       bodySnippet,
						}
					}
					if reqPayload.URL != "" {
						reqHeadersOut := map[string]string{
							"User-Agent": "Swazz/1.0 (+https://github.com/SecH0us3/swazz)",
						}
						for k, v := range reqPayload.Headers {
							reqHeadersOut[k] = v
						}
						if len(reqPayload.Cookies) > 0 {
							var cookieParts []string
							for k, v := range reqPayload.Cookies {
								cookieParts = append(cookieParts, fmt.Sprintf("%s=%s", k, v))
							}
							reqHeadersOut["Cookie"] = strings.Join(cookieParts, "; ")
						}
						errMap["request"] = map[string]interface{}{
							"url":     reqPayload.URL,
							"method":  "GET",
							"headers": reqHeadersOut,
						}
					} else {
						errMap["request"] = map[string]interface{}{
							"url":    "File Upload",
							"method": "POST",
							"headers": map[string]string{
								"Content-Type": "application/octet-stream",
							},
						}
					}
					result = errMap
				} else {
					if parseResult == nil && parseErr == nil {
						parseResult, parseErr = swagger.ParseRawSpec(data)
						if parseErr != nil {
							originalErr = parseErr
							if swagger.IsHAR(data) {
								parseResult, parseErr = har.ParseHAR(data, "")
							} else if swagger.IsProtoFile(data) {
								parseResult, parseErr = proto.ParseProtoBytes(reqPayload.URL, data, "")
							} else if swagger.IsPostman(data) {
								parseResult, parseErr = postman.ParsePostman(data)
							} else {
								defaultPath := "/graphql"
								if parsedURL, errURL := url.Parse(reqPayload.URL); errURL == nil {
									if parsedURL.Path != "" && parsedURL.Path != "/" {
										defaultPath = parsedURL.Path
									}
								}
								parseResult, parseErr = graphql.ParseGraphQLIntrospection(data, defaultPath)
								if parseErr != nil {
									parseErr = originalErr
								}
							}
						}
					}

					if parseErr != nil {
						logError("[Parser] Failed to parse spec: %v", parseErr)
						errMap := map[string]interface{}{
							"error": parseErr.Error(),
						}
						parserName := "swagger"
						if swagger.IsHAR(data) {
							parserName = "har"
						} else if swagger.IsProtoFile(data) || (reqPayload.URL != "" && swagger.IsGRPCURL(reqPayload.URL)) {
							parserName = "grpc"
						} else if swagger.IsWSURL(reqPayload.URL) || swagger.IsAsyncAPISpec(data) {
							parserName = "asyncapi"
						} else if swagger.IsPostman(data) {
							parserName = "postman"
						} else if originalErr != nil && parseErr == originalErr {
							parserName = "swagger"
						} else {
							parserName = "graphql"
						}
						errMap["parserDetails"] = map[string]interface{}{
							"parser": parserName,
						}
						if reqPayload.URL != "" {
							reqHeadersOut := map[string]string{
								"User-Agent": "Swazz/1.0 (+https://github.com/SecH0us3/swazz)",
							}
							for k, v := range reqPayload.Headers {
								reqHeadersOut[k] = v
							}
							if len(reqPayload.Cookies) > 0 {
								var cookieParts []string
								for k, v := range reqPayload.Cookies {
									cookieParts = append(cookieParts, fmt.Sprintf("%s=%s", k, v))
								}
								reqHeadersOut["Cookie"] = strings.Join(cookieParts, "; ")
							}
							errMap["request"] = map[string]interface{}{
								"url":     reqPayload.URL,
								"method":  "GET",
								"headers": reqHeadersOut,
							}
							if resp != nil {
								respHeaders := make(map[string]string)
								for k, v := range resp.Header {
									if len(v) > 0 {
										respHeaders[k] = v[0]
									}
								}
								errMap["response"] = map[string]interface{}{
									"status":     resp.StatusCode,
									"statusText": resp.Status,
									"headers":    respHeaders,
									"body":       "...(parsed data)...",
								}
							}
						} else {
							errMap["request"] = map[string]interface{}{
								"url":    "File Upload",
								"method": "POST",
								"headers": map[string]string{
									"Content-Type": "application/octet-stream",
								},
							}
						}
						result = errMap
					} else {
						// Prune schemas to avoid sending megabyte-sized JSON over WS (max 32MB WebSocket limit, 1MB in prod CF)
						for i := range parseResult.Endpoints {
							pruneSchema(&parseResult.Endpoints[i].Schema, 0, 3)
							for k := range parseResult.Endpoints[i].PathParams {
								pruneSchema(parseResult.Endpoints[i].PathParams[k], 0, 3)
							}
							for k := range parseResult.Endpoints[i].QueryParams {
								pruneSchema(parseResult.Endpoints[i].QueryParams[k], 0, 3)
							}
							for k := range parseResult.Endpoints[i].HeaderParams {
								pruneSchema(parseResult.Endpoints[i].HeaderParams[k], 0, 3)
							}
						}
						logInfo("[Parser] Parsed spec successfully: %s (%d endpoints)", parseResult.BasePath, len(parseResult.Endpoints))
						result = map[string]interface{}{
							"basePath":  parseResult.BasePath,
							"endpoints": parseResult.Endpoints,
							"rawSpec":   string(data),
						}
					}
				}

				// Trigger MCP probe if we have a URL and there was any kind of error (fetch or parse)
				hasError := err != nil
				if !hasError {
					if resultMap, ok := result.(map[string]interface{}); ok {
						if _, hasErrKey := resultMap["error"]; hasErrKey {
							hasError = true
						}
					}
				}

				if hasError && reqPayload.URL != "" {
					mcpHeaders := make(map[string]string)
					for k, v := range reqPayload.Headers {
						mcpHeaders[k] = v
					}
					if len(reqPayload.Cookies) > 0 {
						var cookieParts []string
						for k, v := range reqPayload.Cookies {
							cookieParts = append(cookieParts, fmt.Sprintf("%s=%s", k, v))
						}
						mcpHeaders["Cookie"] = strings.Join(cookieParts, "; ")
					}

					// fallback to MCP probe (try HTTP first, then SSE)
					var mcpClient mcp.Client
					mcpClient = mcp.NewHTTPClient(reqPayload.URL, false, mcpHeaders)
					mcpCtxHTTP, cancelHTTP := context.WithTimeout(context.Background(), 10*time.Second)
					defer cancelHTTP()

					var mcpErr error
					if mcpErr = mcpClient.Connect(mcpCtxHTTP); mcpErr != nil {
						logWarn("[Parser] MCP HTTP connect failed: %v, falling back to SSE", mcpErr)
						// #nosec G104 -- Ignore close error on fallback
						_ = mcpClient.Close()

						mcpClient = mcp.NewSSEClient(reqPayload.URL, false, mcpHeaders, nil)
						mcpCtxSSE, cancelSSE := context.WithTimeout(context.Background(), 10*time.Second)
						defer cancelSSE()
						mcpErr = mcpClient.Connect(mcpCtxSSE)
					} else {
						// HTTP succeeded
					}

					if mcpErr == nil {
						// It is an MCP server!
						mcpCtxTools, toolsCancel := context.WithTimeout(context.Background(), 10*time.Second)
						tools, _ := mcpClient.ListTools(mcpCtxTools)
						toolsCancel()
						var eps []swagger.EndpointConfig
						for _, t := range tools {
							eps = append(eps, swagger.EndpointConfig{
								Method: "CALL",
								Path:   "mcp://tool/" + t.Name,
								Schema: t.InputSchema,
							})
						}

						for i := range eps {
							pruneSchema(&eps[i].Schema, 0, 3)
						}

						// #nosec G104 -- Ignore close error on successful fetch
						_ = mcpClient.Close()
						logInfo("[Parser] Fallback to MCP successful for %s (%d tools)", reqPayload.URL, len(eps))
						result = map[string]interface{}{
							"basePath":  reqPayload.URL,
							"endpoints": eps,
							"rawSpec":   "",
						}
					} else {
						logWarn("[Parser] MCP fallback failed: %v", mcpErr)
					}
				}

				msgPayload := map[string]interface{}{
					"type":    "parse_result",
					"reqId":   reqID,
					"payload": result,
				}
				if b, err := json.Marshal(msgPayload); err == nil && len(b) > 1*1024*1024 {
					logWarn("[Parser] Parse result size (%d bytes) exceeds 1MB limit. Retrying without rawSpec...", len(b))
					if resultMap, ok := result.(map[string]interface{}); ok {
						resultMap["rawSpec"] = ""
						msgPayload["payload"] = resultMap
						if b2, err2 := json.Marshal(msgPayload); err2 == nil && len(b2) > 1*1024*1024 {
							logError("[Parser] Parse result endpoints schema is still too large (%d bytes). Returning error.", len(b2))
							msgPayload["payload"] = map[string]string{
								"error": "The parsed endpoints schema is too large to transmit over the 1MB WebSocket limit.",
							}
						}
					}
				}
				outChan <- msgPayload
			}()
		}
	}
}

func filterSensitiveData(rawSpec string) string {
	// Filter sensitive data from rawSpec
	// This is a basic example; you may need to extend it based on your requirements
	sensitivePatterns := []string{
		"password",
		"secret",
		"token",
		"api_key",
		"access_key",
		"jwt",
		"bearer",
		"aws",
		"private_key",
	}

	filteredSpec := rawSpec
	for _, pattern := range sensitivePatterns {
		filteredSpec = strings.ReplaceAll(filteredSpec, pattern, "[FILTERED]")
	}

	return filteredSpec
}

func pruneSchema(s *swagger.SchemaProperty, currentDepth, maxDepth int) {
	if s == nil {
		return
	}
	if currentDepth >= maxDepth {
		s.Properties = nil
		s.Items = nil
		return
	}
	for _, prop := range s.Properties {
		pruneSchema(prop, currentDepth+1, maxDepth)
	}
	if s.Items != nil {
		pruneSchema(s.Items, currentDepth+1, maxDepth)
	}
}

type JobCommandPayload struct {
	RunID   string `json:"runId"`
	Command string `json:"command"`
}

type WSMessageIn struct {
	Type    string          `json:"type"`
	ReqID   string          `json:"reqId,omitempty"`
	Payload json.RawMessage `json:"payload"`
	RunID   string          `json:"runId,omitempty"`
	UUID    string          `json:"uuid,omitempty"`
}

type JobDispatchPayload struct {
	RunID  string    `json:"runId"`
	Config CliConfig `json:"config"`
}

type WSEventOut struct {
	Type    string      `json:"type"`
	RunID   string      `json:"runId"`
	Payload interface{} `json:"payload"`
}

type WSEventPayload struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

func loadPrivateKey(keyArg string) (ed25519.PrivateKey, error) {
	var hexStr string
	if _, err := os.Stat(keyArg); err == nil { // #nosec G304 G703
		data, err := os.ReadFile(keyArg) // #nosec G304 G703
		if err != nil {
			return nil, fmt.Errorf("failed to read key file %s: %w", keyArg, err)
		}
		hexStr = strings.TrimSpace(string(data))
	} else {
		hexStr = strings.TrimSpace(keyArg)
	}

	keyBytes, err := hex.DecodeString(hexStr)
	if err != nil {
		return nil, fmt.Errorf("failed to decode private key hex: %w", err)
	}

	if len(keyBytes) == ed25519.SeedSize {
		return ed25519.NewKeyFromSeed(keyBytes), nil
	}

	if len(keyBytes) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("invalid private key size: expected %d (seed) or %d (private key) bytes, got %d", ed25519.SeedSize, ed25519.PrivateKeySize, len(keyBytes))
	}

	return ed25519.PrivateKey(keyBytes), nil
}

func logDebug(format string, v ...interface{}) {
	logger.Debug(format, v...)
}

func logInfo(format string, v ...interface{}) {
	logger.Info(format, v...)
}

func logWarn(format string, v ...interface{}) {
	logger.Warn(format, v...)
}

func logError(format string, v ...interface{}) {
	logger.Error(format, v...)
}

func inferOOBServerURL(coordinatorURL string) string {
	return deriveHTTPBaseURL(coordinatorURL)
}

func deriveHTTPBaseURL(coordinatorURL string) string {
	if coordinatorURL == "" {
		return ""
	}
	u, err := url.Parse(coordinatorURL)
	if err != nil || u.Host == "" {
		return ""
	}
	if u.Scheme == "ws" {
		u.Scheme = "http"
	} else if u.Scheme == "wss" {
		u.Scheme = "https"
	}

	// Strip known router endpoints if they were passed
	if idx := strings.Index(u.Path, "/api/runners/connect"); idx > -1 {
		u.Path = u.Path[:idx]
	} else if idx := strings.Index(u.Path, "/api/"); idx > -1 {
		u.Path = u.Path[:idx]
	}
	u.Path = strings.TrimSuffix(u.Path, "/")
	u.RawQuery = ""
	return u.String()
}

func deriveTelemetryURL(coordURL string) string {
	if coordURL == "" {
		return "https://swazz.secmy.app/api/telemetry/scans/increment"
	}
	u, err := url.Parse(coordURL)
	if err != nil || u.Host == "" {
		return "https://swazz.secmy.app/api/telemetry/scans/increment"
	}
	if u.Scheme == "ws" {
		u.Scheme = "http"
	} else if u.Scheme == "wss" {
		u.Scheme = "https"
	}
	u.Path = "/api/telemetry/scans/increment"
	u.RawQuery = ""
	return u.String()
}

func incrementGlobalScanTelemetry(telemetryURL string, disableTelemetry bool) {
	if disableTelemetry {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		defer cancel()

		req, err := http.NewRequestWithContext(ctx, "POST", telemetryURL, strings.NewReader("{}")) // #nosec G704
		if err != nil {
			logWarn("Warning: Failed to report telemetry scan count: %v. You can disable telemetry using --disable-telemetry or SWAZZ_DISABLE_TELEMETRY=true.", err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "Swazz/1.0 (+https://github.com/SecH0us3/swazz)")

		resp, err := http.DefaultClient.Do(req) // #nosec G704
		if err != nil {
			logWarn("Warning: Failed to report telemetry scan count: %v. You can disable telemetry using --disable-telemetry or SWAZZ_DISABLE_TELEMETRY=true.", err)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			logWarn("Warning: Failed to report telemetry scan count: HTTP status %d. You can disable telemetry using --disable-telemetry or SWAZZ_DISABLE_TELEMETRY=true.", resp.StatusCode)
		}
	}()
}

func sendTriageBatchToEdge(coordinatorURL, token, scanID string, results []*triage.TriageResult) error {
	if len(results) == 0 {
		return nil
	}

	baseURL := deriveHTTPBaseURL(coordinatorURL)
	if baseURL == "" {
		return fmt.Errorf("invalid coordinator URL")
	}

	u, err := url.Parse(baseURL)
	if err != nil {
		return fmt.Errorf("invalid coordinator URL: %w", err)
	}
	joinedPath, _ := url.JoinPath("/api/scans", url.PathEscape(scanID), "findings", "ai-triage")
	u.Path = joinedPath
	apiURL := u.String()

	var updates []map[string]interface{}
	for _, tr := range results {
		for _, fid := range tr.FindingIDs {
			updates = append(updates, map[string]interface{}{
				"finding_id":     fid,
				"ai_status":      tr.AIStatus,
				"ai_relevance":   tr.AIRelevance,
				"ai_explanation": tr.AIExplanation,
				"ai_confidence":  tr.AIConfidence,
			})
		}
	}

	payloadBytes, err := json.Marshal(map[string]interface{}{
		"updates": updates,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequest("PATCH", apiURL, bytes.NewReader(payloadBytes)) // #nosec G704
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req) // #nosec G704
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Edge API batch triage error (status %d): %s", resp.StatusCode, string(respBody))
	}

	return nil
}
