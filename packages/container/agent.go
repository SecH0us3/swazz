package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
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
	safenet.AssertRunningInContainer()

	var coordinatorURL, token, name string

	// Simple arg parsing
	for i := 0; i < len(args); i++ {
		switch args[i] {
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

	if coordinatorURL == "" || token == "" {
		fmt.Println("Error: --coordinator and --token are required for run-agent.")
		fmt.Println()
		printHelp()
		os.Exit(1)
	}

	if name == "" {
		hostname, _ := os.Hostname()
		name = "runner-" + hostname
	}

	log.Printf("Starting agent '%s', connecting to %s", name, coordinatorURL) // #nosec G706

	ctx := context.Background()

	opts := &websocket.DialOptions{
		Subprotocols: []string{"swazz-agent"},
	}

	urlWithAuth := coordinatorURL
	if !strings.Contains(urlWithAuth, "?") {
		urlWithAuth += fmt.Sprintf("?token=%s&name=%s", token, name)
	} else {
		urlWithAuth += fmt.Sprintf("&token=%s&name=%s", token, name)
	}

	c, _, err := websocket.Dial(ctx, urlWithAuth, opts)
	if err != nil {
		log.Fatalf("Failed to connect to coordinator: %v", err)
	}
	defer c.Close(websocket.StatusInternalError, "internal error")

	log.Printf("Successfully connected to coordinator. Awaiting jobs...")

	// Write loop
	outChan := make(chan interface{}, 1000)
	go func() {
		for msg := range outChan {
			if err := wsjson.Write(ctx, c, msg); err != nil {
				log.Printf("Failed to write to WS: %v", err)
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
				log.Printf("Failed to unmarshal JobDispatchPayload: %v", err)
				continue
			}

			log.Printf("Received job dispatch for runID: %s", dispatch.RunID)

			runCfg, err := BuildRunnerConfig(&dispatch.Config)
			if err != nil {
				log.Printf("Failed to build runner config: %v", err)
				sendWSError(dispatch.RunID, err.Error())
				continue
			}

			client := safenet.NewSafeHTTPClient(time.Duration(runCfg.Settings.TimeoutMs) * time.Millisecond)
			r := runner.New(runCfg, client)

			activeRunnersMu.Lock()
			activeRunners[dispatch.RunID] = r
			activeRunnersMu.Unlock()

			// Sub to events
			sub := r.Subscribe()
			go func(runID string) {
				defer r.Unsubscribe(sub)
				for ev := range sub {
					if ev.Type == "result" {
						if res, ok := ev.Data.(*swagger.FuzzResult); ok {
							ev.Data = runner.ToSSE(res)
						}
					}
					sendWSEvent(runID, ev.Type, ev.Data)
				}
			}(dispatch.RunID)

			go func(runID string) {
				if err := r.Start(ctx); err != nil {
					log.Printf("Runner failed: %v", err)
					sendWSError(runID, err.Error())
				}
				r.Close()
				log.Printf("Runner for %s finished", runID)

				activeRunnersMu.Lock()
				delete(activeRunners, runID)
				activeRunnersMu.Unlock()
			}(dispatch.RunID)

		case "job_command":
			var cmd JobCommandPayload
			if err := json.Unmarshal(wsMsg.Payload, &cmd); err != nil {
				log.Printf("Failed to unmarshal JobCommandPayload: %v", err)
				continue
			}

			activeRunnersMu.Lock()
			r, exists := activeRunners[cmd.RunID]
			activeRunnersMu.Unlock()

			if !exists {
				log.Printf("Runner not found for %s", cmd.RunID)
				continue
			}

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
				log.Printf("Failed to unmarshal parse_request payload: %v", err)
				continue
			}
			reqID := wsMsg.ReqID

			go func() {
				// Parse swagger
				var result interface{}
				
				client := safenet.NewSafeHTTPClient(30 * time.Second)
				resp, err := client.Get(reqPayload.URL)
				if err != nil {
					result = map[string]string{"error": err.Error()}
				} else {
					defer resp.Body.Close()
					data, err := io.ReadAll(resp.Body)
					if err != nil {
						result = map[string]string{"error": err.Error()}
					} else {
						parseResult, err := swagger.ParseRawSpec(data)
						if err != nil {
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
