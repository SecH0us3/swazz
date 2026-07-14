package main

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"swazz-engine/internal/classifier"
	"swazz-engine/internal/graphql"
	"swazz-engine/internal/har"
	"swazz-engine/internal/logger"
	"swazz-engine/internal/postman"
	"swazz-engine/internal/runner"
	"swazz-engine/internal/safenet"
	"swazz-engine/internal/swagger"
	"sync"
	"time"

	"nhooyr.io/websocket"
	"nhooyr.io/websocket/wsjson"
)

// startAgent parses the arguments and connects to the coordinator
func startAgent(args []string) {
	var coordinatorURL, token, name, keyPathOrHex, logLevelStr, logFilterStr string
	var dangerousNoContainer bool
	var hasQuiet, hasLogLevel bool

	// Simple arg parsing
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--dangerous-no-container":
			dangerousNoContainer = true
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

	var (
		activeRunners   = make(map[string]*runner.Runner)
		activeRunnersMu sync.Mutex
	)

	ctx := context.Background()

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
		headers.Set("Authorization", "Bearer "+token)
	}

	opts := &websocket.DialOptions{
		Subprotocols: []string{"swazz-agent"},
		HTTPHeader:   headers,
	}

	c, resp, err := websocket.Dial(ctx, urlWithParams, opts)
	if err != nil {
		if resp != nil && (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) {
			logError("Critical Authentication Error: Unauthorized/Forbidden (Status Code: %d). Revoked or invalid credentials. Terminating agent process.", resp.StatusCode)
			os.Exit(1)
		}
		log.Fatalf("Failed to connect to coordinator: %v", err)
	}

	// Add graceful shutdown handler to prevent abrupt WebSocket closures
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigCh
		logInfo("Received termination signal, shutting down agent gracefully...")
		activeRunnersMu.Lock()
		for _, r := range activeRunners {
			r.Stop()
		}
		activeRunnersMu.Unlock()
		time.Sleep(500 * time.Millisecond)
		_ = c.Close(websocket.StatusNormalClosure, "agent shutting down")
		os.Exit(0)
	}()

	defer c.Close(websocket.StatusInternalError, "internal error")

	if useSignatureAuth {
		logInfo("Performing challenge-response authentication handshake...")
		var challengeMsg struct {
			Type  string `json:"type"`
			Nonce string `json:"nonce"`
		}
		if err := wsjson.Read(ctx, c, &challengeMsg); err != nil {
			log.Fatalf("Failed to read challenge message from coordinator: %v", err)
		}

		if challengeMsg.Type != "challenge" {
			log.Fatalf("Expected challenge message, got: %s", challengeMsg.Type)
		}

		if challengeMsg.Nonce == "" {
			log.Fatalf("Challenge message missing nonce")
		}

		// Sign the raw nonce bytes directly as a string
		signatureBytes := ed25519.Sign(privKey, []byte(challengeMsg.Nonce))
		signatureHex := hex.EncodeToString(signatureBytes)

		responseMsg := map[string]interface{}{
			"type":      "challenge_response",
			"signature": signatureHex,
		}
		if err := wsjson.Write(ctx, c, responseMsg); err != nil {
			log.Fatalf("Failed to send challenge response: %v", err)
		}

		var authResult struct {
			Type  string `json:"type"`
			Error string `json:"error"`
		}
		if err := wsjson.Read(ctx, c, &authResult); err != nil {
			log.Fatalf("Failed to read authentication result: %v", err)
		}

		if authResult.Type == "auth_ok" {
			logInfo("✓ Authentication successful!")
		} else {
			logError("Critical Authentication Error: Handshake authentication failed: %s", authResult.Error)
			os.Exit(1)
		}
	}

	logInfo("Successfully connected to coordinator. Awaiting jobs...")

	// Write loop
	outChan := make(chan interface{}, 50000)
	go func() {
		for msg := range outChan {
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
			if err := c.Write(ctx, websocket.MessageText, b); err != nil {
				logError("Failed to write to WS: %v", err)
				_ = c.Close(websocket.StatusInternalError, "write error")
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
			log.Fatalf("Connection read error: %v", err)
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

		case "job_dispatch":
			var dispatch JobDispatchPayload
			if err := json.Unmarshal(wsMsg.Payload, &dispatch); err != nil {
				logError("Failed to unmarshal JobDispatchPayload: %v", err)
				continue
			}

			logInfo("Received job dispatch for runID: %s", dispatch.RunID)

			runCfg, err := BuildRunnerConfig(&dispatch.Config)
			if err != nil {
				logError("Failed to build runner config: %v", err)
				sendWSError(dispatch.RunID, err.Error())
				continue
			}

			client := safenet.NewSafeHTTPClient(time.Duration(runCfg.Settings.TimeoutMs) * time.Millisecond)
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
				logInfo("Starting fuzz runner for runID: %s", runID)
				sendWSEvent(runID, "runner_log", map[string]interface{}{
					"level":     "warning",
					"message":   fmt.Sprintf("Starting fuzz runner for runID: %s", runID),
					"timestamp": time.Now().Format(time.RFC3339),
				})
				if err := r.Start(ctx); err != nil {
					logError("Runner failed: %v", err)
					sendWSError(runID, err.Error())
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
				URL     string `json:"url"`
				RawSpec string `json:"rawSpec"`
			}
			if err := json.Unmarshal(wsMsg.Payload, &reqPayload); err != nil {
				logError("Failed to unmarshal parse_request payload: %v", err)
				continue
			}
			reqID := wsMsg.ReqID

			logInfo("[Parser] Received parse request. URL: %s, Has RawSpec: %v", reqPayload.URL, reqPayload.RawSpec != "")
			go func() {
				var result interface{}
				var data []byte
				var err error

				if reqPayload.RawSpec != "" {
					data = []byte(reqPayload.RawSpec)
				} else if reqPayload.URL != "" {
					client := safenet.NewSafeHTTPClient(15 * time.Second)
					resp, errFetch := client.Get(reqPayload.URL)
					if errFetch != nil {
						logError("[Parser] Failed to fetch spec: %v", errFetch)
						err = errFetch
					} else {
						defer resp.Body.Close()
						limitReader := io.LimitReader(resp.Body, 10*1024*1024+1)
						data, err = io.ReadAll(limitReader)
						if err == nil && len(data) > 10*1024*1024 {
							err = fmt.Errorf("specification file exceeds the 10MB limit")
						}
					}
				} else {
					err = fmt.Errorf("missing url or rawSpec")
				}

				if err != nil {
					result = map[string]string{"error": err.Error()}
				} else {
					var parseResult *swagger.ParseResult
					var parseErr error
					parseResult, parseErr = swagger.ParseRawSpec(data)
						if parseErr != nil {
							originalErr := parseErr
							if swagger.IsHAR(data) {
								parseResult, parseErr = har.ParseHAR(data, "")
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

						if parseErr != nil {
							logError("[Parser] Failed to parse spec: %v", parseErr)
							result = map[string]string{"error": parseErr.Error()}
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
