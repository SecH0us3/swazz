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
	"strings"
	"swazz-engine/internal/classifier"
	"swazz-engine/internal/logger"
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
	logLevelStr = "info"
	logger.SetLevel(logger.LevelInfo)

	// Simple arg parsing
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--dangerous-no-container":
			dangerousNoContainer = true
		case "--log-level":
			if i+1 < len(args) {
				logLevelStr = args[i+1]
				logger.SetLevelByName(logLevelStr)
				i++
			}
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

	ctx := context.Background()

	headers := make(http.Header)
	urlWithParams := coordinatorURL
	encodedName := url.QueryEscape(name)
	
	if !strings.Contains(urlWithParams, "?") {
		urlWithParams += fmt.Sprintf("?name=%s", encodedName)
	} else {
		urlWithParams += fmt.Sprintf("&name=%s", encodedName)
	}

	if useSignatureAuth {
		headers.Set("X-Runner-Public-Key", pubKeyHex)
	} else {
		headers.Set("Authorization", "Bearer "+token)
	}

	opts := &websocket.DialOptions{
		Subprotocols: []string{"swazz-agent"},
		HTTPHeader:   headers,
	}

	c, _, err := websocket.Dial(ctx, urlWithParams, opts)
	if err != nil {
		log.Fatalf("Failed to connect to coordinator: %v", err)
	}
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
			log.Fatalf("✗ Authentication failed: %s", authResult.Error)
		}
	}

	logInfo("Successfully connected to coordinator. Awaiting jobs...")

	// Write loop
	outChan := make(chan interface{}, 50000)
	go func() {
		for msg := range outChan {
			time.Sleep(200 * time.Microsecond)
			b, err := json.Marshal(msg)
			if err != nil {
				logError("Failed to marshal WS message: %v", err)
				continue
			}
			if len(b) > 30*1024*1024 {
				logError("WS message is too large: %d bytes. Dropping message to prevent WebSocket close.", len(b))
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

	var (
		activeRunners   = make(map[string]*runner.Runner)
		activeRunnersMu sync.Mutex
	)

	// Agent loop
	for {
		var wsMsg WSMessageIn
		if err := wsjson.Read(ctx, c, &wsMsg); err != nil {
			log.Fatalf("Connection read error: %v", err)
		}

		switch wsMsg.Type {
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
			}
			liveCls := classifier.New(liveClsRules)

			// Sub to events
			sub := r.Subscribe()
			go func(runID string) {
				defer r.Unsubscribe(sub)
				for ev := range sub {
					if ev.Type == "result" {
						if res, ok := ev.Data.(*swagger.FuzzResult); ok {
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
						}
					} else if ev.Type == "progress" {
						if stats, ok := ev.Data.(swagger.RunStats); ok {
							logInfo("[Fuzz Progress] Run %s: %d/%d requests (%s, concurrency: %d) | %d endpoints complete",
								runID, stats.TotalRequests, stats.TotalPlanned, stats.Progress.CurrentProfile, stats.Concurrency, stats.Progress.CompletedEndpoints)
						} else {
							statsJSON, _ := json.Marshal(ev.Data)
							logInfo("[Fuzz Progress] Run %s: %s", runID, string(statsJSON))
						}
					} else if ev.Type == "complete" {
						if stats, ok := ev.Data.(swagger.RunStats); ok {
							logInfo("[Fuzz Complete] Run %s: finished with %d requests, duration: %v",
								runID, stats.TotalRequests, time.Duration(stats.TotalDurationMs)*time.Millisecond)
						} else {
							statsJSON, _ := json.Marshal(ev.Data)
							logInfo("[Fuzz Complete] Run %s: %s", runID, string(statsJSON))
						}
					} else if ev.Type == "error" {
						logError("[Fuzz Error] Run %s: %v", runID, ev.Data)
					}
					sendWSEvent(runID, ev.Type, ev.Data)
				}
			}(dispatch.RunID)

			go func(runID string) {
				logInfo("Starting fuzz runner for runID: %s", runID)
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
				URL string `json:"url"`
			}
			if err := json.Unmarshal(wsMsg.Payload, &reqPayload); err != nil {
				logError("Failed to unmarshal parse_request payload: %v", err)
				continue
			}
			reqID := wsMsg.ReqID

			logInfo("[Parser] Received parse request for URL: %s", reqPayload.URL)
			go func() {
				// Parse swagger
				var result interface{}
				
				client := safenet.NewSafeHTTPClient(30 * time.Second)
				resp, err := client.Get(reqPayload.URL)
				if err != nil {
					logError("[Parser] Failed to fetch spec: %v", err)
					result = map[string]string{"error": err.Error()}
				} else {
					defer resp.Body.Close()
					// Limit spec reading to 10MB + 1 byte to detect truncation
					limitReader := io.LimitReader(resp.Body, 10*1024*1024+1)
					data, err := io.ReadAll(limitReader)
					if err != nil {
						logError("[Parser] Failed to read spec body: %v", err)
						result = map[string]string{"error": err.Error()}
					} else if len(data) > 10*1024*1024 {
						logError("[Parser] Spec exceeds 10MB limit")
						result = map[string]string{"error": "specification file exceeds the 10MB limit"}
					} else {
						parseResult, err := swagger.ParseRawSpec(data)
						if err != nil {
							logError("[Parser] Failed to parse spec: %v", err)
							result = map[string]string{"error": err.Error()}
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
				}

				outChan <- map[string]interface{}{
					"type":    "parse_result",
					"reqId":   reqID,
					"payload": result,
				}
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
