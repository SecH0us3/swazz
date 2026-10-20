// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"runtime/debug"
	"sort"
	"strings"
	"swazz-engine/internal/config"
	"sync"
	"sync/atomic"
	"time"

	"swazz-engine/internal/ai"
	"swazz-engine/internal/classifier"
	"swazz-engine/internal/graphql"
	"swazz-engine/internal/grpc"
	"swazz-engine/internal/har"
	"swazz-engine/internal/license"
	"swazz-engine/internal/mcp"
	"swazz-engine/internal/postman"
	"swazz-engine/internal/proto"
	"swazz-engine/internal/runner"
	"swazz-engine/internal/safenet"
	"swazz-engine/internal/swagger"
	"swazz-engine/internal/triage"
	"swazz-engine/internal/wafcheck"
	"swazz-engine/internal/ws"
)

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
	Seq     uint64          `json:"seq,omitempty"`
	Exec    string          `json:"exec,omitempty"`
}

type JobDispatchPayload struct {
	RunID  string           `json:"runId"`
	Config config.CliConfig `json:"config"`
}

type WSEventOut struct {
	Type    string      `json:"type"`
	RunID   string      `json:"runId"`
	Payload interface{} `json:"payload"`
	// Seq and Exec number a run's events for acknowledged delivery (see agent_delivery.go).
	Seq  uint64 `json:"seq,omitempty"`
	Exec string `json:"exec,omitempty"`
}

type WSEventPayload struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// AgentDispatcher manages active scan runners and dispatches coordinator commands.
type AgentDispatcher struct {
	coordinatorURL   string
	token            string
	disableTelemetry bool
	outChan          chan<- interface{}
	activeRunners    map[string]*runner.Runner
	activeRunnersMu  sync.Mutex
	parseReqSem      chan struct{}
	delivery         *deliveryLog
	sendMu           sync.Mutex
}

// NewAgentDispatcher creates a new dispatcher instance.
func NewAgentDispatcher(coordinatorURL, token string, disableTelemetry bool, outChan chan<- interface{}) *AgentDispatcher {
	return &AgentDispatcher{
		coordinatorURL:   coordinatorURL,
		token:            token,
		disableTelemetry: disableTelemetry,
		outChan:          outChan,
		activeRunners:    make(map[string]*runner.Runner),
		parseReqSem:      make(chan struct{}, 10),
		delivery:         newDeliveryLog(),
	}
}

// StopAllRunners stops all running jobs cleanly.
func (d *AgentDispatcher) StopAllRunners() {
	d.activeRunnersMu.Lock()
	defer d.activeRunnersMu.Unlock()
	for _, r := range d.activeRunners {
		r.Stop()
	}
}

// ActiveRunIDs lists the runs this agent is executing right now.
func (d *AgentDispatcher) ActiveRunIDs() []string {
	d.activeRunnersMu.Lock()
	defer d.activeRunnersMu.Unlock()
	ids := make([]string, 0, len(d.activeRunners))
	for id := range d.activeRunners {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// ResumeRunIDs lists the runs a new connection claims: those still executing, then those whose
// events are not all acknowledged yet (a run may have finished while its last events, possibly
// "complete", were lost with the previous connection), the most recently active first. The
// coordinator honours only so many claims; executing runs must not lose their place to finished ones.
func (d *AgentDispatcher) ResumeRunIDs() []string {
	ids := d.ActiveRunIDs()
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		seen[id] = true
	}
	for _, id := range d.delivery.unackedRuns() {
		if !seen[id] {
			ids = append(ids, id)
		}
	}
	return ids
}

func (d *AgentDispatcher) isActive(runID string) bool {
	d.activeRunnersMu.Lock()
	defer d.activeRunnersMu.Unlock()
	_, ok := d.activeRunners[runID]
	return ok
}

// queueEvent numbers a run event and queues it for sending. sendMu makes the two one step: runs
// send events from several goroutines, and a higher seq queued before a lower one would be lost.
func (d *AgentDispatcher) queueEvent(msg WSEventOut) {
	d.sendMu.Lock()
	defer d.sendMu.Unlock()
	stamped, ok := d.delivery.stamp(msg)
	if !ok {
		logWarn("Dropping a late %s event of an earlier execution of run %s", msg.Type, msg.RunID)
		return
	}
	d.outChan <- stamped
}

func eventOut(runID, exec, typ string, payload interface{}) WSEventOut {
	return WSEventOut{
		Type:    "event",
		RunID:   runID,
		Payload: WSEventPayload{Type: typ, Data: payload},
		Exec:    exec,
	}
}

func errorOut(runID, exec, errStr string) WSEventOut {
	return WSEventOut{
		Type:    "error",
		RunID:   runID,
		Payload: map[string]string{"error": errStr},
		Exec:    exec,
	}
}

// SendWSEvent sends an event payload to the coordinator, as part of the run's current execution.
func (d *AgentDispatcher) SendWSEvent(runID, typ string, payload interface{}) {
	d.queueEvent(eventOut(runID, "", typ, payload))
}

// SendWSError sends an error event to the coordinator, as part of the run's current execution.
func (d *AgentDispatcher) SendWSError(runID, errStr string) {
	d.queueEvent(errorOut(runID, "", errStr))
}

// sendEventOf sends an event of one execution of the run; dropped once a newer execution started.
func (d *AgentDispatcher) sendEventOf(runID, exec, typ string, payload interface{}) {
	d.queueEvent(eventOut(runID, exec, typ, payload))
}

// sendErrorOf sends an error of one execution of the run; dropped once a newer execution started.
func (d *AgentDispatcher) sendErrorOf(runID, exec, errStr string) {
	d.queueEvent(errorOut(runID, exec, errStr))
}

// finishExecution makes sure the coordinator and the dashboard learn that an execution ended. A
// run that ended without its terminal event reaching them would otherwise look like it was still
// running, forever. It waits until the run's events have all been forwarded (behind a backlog
// queued while the coordinator connection was down, say: a terminal event of its own could not
// get out sooner either), then:
//   - the run's own terminal event went out (a panic in the run is reported as an error by the
//     runner itself): nothing more;
//   - it did not (dropped by a forwarder that fell behind): a run that returned normally is
//     reported complete, with the runner's final stats; a panic outside the run, as an error.
//
// Messages are for the user: no stack traces or internal detail, which stay in the agent's log.
func (d *AgentDispatcher) finishExecution(runID string, panicked bool, terminal func() bool, subDone <-chan struct{}, finalStats func() interface{}, sendEvent func(string, interface{}), sendError func(string)) {
	<-subDone
	if terminal() {
		return
	}
	if !panicked {
		logWarn("Run %s ended without its completion being forwarded; reporting it now", runID)
		sendEvent("complete", finalStats())
		return
	}
	sendEvent("runner_log", map[string]interface{}{
		"level":     "error",
		"message":   "[Runner] ❌ " + runner.RunPanicMessage,
		"timestamp": time.Now().Format(time.RFC3339),
	})
	sendError(runner.RunPanicMessage)
}

// Dispatch routes an incoming message from the coordinator to the appropriate handler.
func (d *AgentDispatcher) Dispatch(ctx context.Context, wsMsg WSMessageIn) {
	switch wsMsg.Type {
	case "agent_restart":
		d.handleRestart()
	case "oob_trigger":
		d.handleOOBTrigger(wsMsg)
	case "job_dispatch":
		d.handleJobDispatch(ctx, wsMsg)
	case "job_command":
		d.handleJobCommand(wsMsg)
	case "parse_request":
		d.handleParseRequest(wsMsg)
	case "ack":
		d.delivery.ack(wsMsg.RunID, wsMsg.Exec, wsMsg.Seq)
	default:
		logWarn("Unknown message type received: %s", wsMsg.Type)
	}
}

func (d *AgentDispatcher) handleRestart() {
	logInfo("Received remote restart request. Stopping active jobs...")
	d.StopAllRunners()
	// Allow a brief grace period for runners to stop and send final events
	time.Sleep(1 * time.Second)
	os.Exit(0)
}

func (d *AgentDispatcher) handleOOBTrigger(wsMsg WSMessageIn) {
	var trigger struct {
		RunID string `json:"runId"`
		UUID  string `json:"uuid"`
	}
	if len(wsMsg.Payload) > 0 {
		if err := json.Unmarshal(wsMsg.Payload, &trigger); err != nil {
			logError("Failed to unmarshal oob_trigger payload: %v", err)
			return
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
		return
	}
	d.activeRunnersMu.Lock()
	r, exists := d.activeRunners[trigger.RunID]
	d.activeRunnersMu.Unlock()
	if exists {
		logInfo("Received OOB trigger for runID %s, UUID %s", trigger.RunID, trigger.UUID)
		r.HandleOOBTrigger(trigger.UUID)
	} else {
		logWarn("OOB trigger received but active runner not found for runID %s", trigger.RunID)
	}
}

func (d *AgentDispatcher) handleJobCommand(wsMsg WSMessageIn) {
	var cmd JobCommandPayload
	if err := json.Unmarshal(wsMsg.Payload, &cmd); err != nil {
		logError("Failed to unmarshal JobCommandPayload: %v", err)
		return
	}

	d.activeRunnersMu.Lock()
	r, exists := d.activeRunners[cmd.RunID]
	d.activeRunnersMu.Unlock()

	if !exists {
		logWarn("Runner not found for %s", cmd.RunID)
		return
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
}

func (d *AgentDispatcher) handleJobDispatch(ctx context.Context, wsMsg WSMessageIn) {
	var dispatch JobDispatchPayload
	if err := json.Unmarshal(wsMsg.Payload, &dispatch); err != nil {
		logError("Failed to unmarshal JobDispatchPayload: %v", err)
		return
	}

	logInfo("Received job dispatch for runID: %s", dispatch.RunID)

	// After a reconnect the coordinator may hand back a run this agent is still executing;
	// starting it again would run the scan twice and orphan the first runner.
	d.activeRunnersMu.Lock()
	_, running := d.activeRunners[dispatch.RunID]
	d.activeRunnersMu.Unlock()
	if running {
		logWarn("Ignoring job dispatch for run %s: it is already running on this agent", dispatch.RunID)
		return
	}
	// A new execution of the run, numbered from 1 under its own exec id. Its events carry that id
	// from here on, so late events of an earlier execution still draining cannot pass as this one's.
	exec := d.delivery.reset(dispatch.RunID)
	// Every execution ends in a terminal event (complete or error) that the coordinator and the
	// dashboard can see, however it ends; see finishExecution.
	var terminal atomic.Bool
	sendEvent := func(typ string, payload interface{}) {
		if typ == "complete" || typ == "error" {
			terminal.Store(true)
		}
		d.sendEventOf(dispatch.RunID, exec, typ, payload)
	}
	sendError := func(errStr string) {
		terminal.Store(true)
		d.sendErrorOf(dispatch.RunID, exec, errStr)
	}

	if dispatch.Config.LicenseKey != "" {
		jobLic, licErr := license.LoadAndVerify(dispatch.Config.LicenseKey)
		if licErr != nil {
			logWarn("[%s] License verification failed for job: %v", dispatch.RunID, licErr)
		} else if jobLic != nil {
			logInfo("[%s] %s license active: %s (expires %s)", dispatch.RunID, jobLic.TierLabel(), jobLic.Company, jobLic.ExpiresAt.Format("2006-01-02"))
			if jobLic.IsExpiringSoon(3) {
				logWarn("[%s] ⚠️  Job license expires soon: %d day(s) remaining (expires %s)", dispatch.RunID, jobLic.DaysRemaining(), jobLic.ExpiresAt.Format("2006-01-02"))
			}
		}
	}

	runCfg, err := config.BuildRunnerConfig(&dispatch.Config)
	if err != nil {
		logError("Failed to build runner config: %v", err)
		errMsg := fmt.Sprintf("[Runner] Cannot start scan: %v. Please import an OpenAPI/Swagger schema, capture endpoints, or set a target URL with spec.", err)
		sendEvent("runner_log", map[string]interface{}{
			"level":     "ERROR",
			"message":   errMsg,
			"timestamp": time.Now().Format(time.RFC3339),
		})
		sendError(err.Error())
		return
	}
	runCfg.RunID = dispatch.RunID
	if runCfg.Settings.OOBServerURL == "" {
		runCfg.Settings.OOBServerURL = inferOOBServerURL(d.coordinatorURL)
	}

	var client *http.Client
	if runCfg.Security.AllowPrivateIPs || safenet.AllowLocalNetwork {
		client = &http.Client{Timeout: time.Duration(runCfg.Settings.TimeoutMs) * time.Millisecond}
	} else {
		client = safenet.NewSafeHTTPClient(time.Duration(runCfg.Settings.TimeoutMs) * time.Millisecond)
	}
	r := runner.New(runCfg, client)

	d.activeRunnersMu.Lock()
	d.activeRunners[dispatch.RunID] = r
	d.activeRunnersMu.Unlock()

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
	subDone := make(chan struct{})
	go func(runID string) {
		defer close(subDone)
		defer r.Unsubscribe(sub)
		defer func() {
			// A broken event must not take the agent (and every other run on it) down; the run
			// still ends with a terminal event (finishExecution).
			if p := recover(); p != nil {
				logError("Event forwarding for run %s panicked: %v\n%s", runID, p, debug.Stack())
			}
		}()
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
				sendEvent("runner_log", map[string]interface{}{
					"level":     "info",
					"message":   msg,
					"timestamp": time.Now().Format(time.RFC3339),
				})
			} else if ev.Type == "complete" {
				var msg string
				if stats, ok := ev.Data.(swagger.RunStats); ok {
					dur := time.Duration(stats.TotalDurationMs) * time.Millisecond
					msg = fmt.Sprintf("[Fuzz Complete] finished with %d requests, total scan time: %v (Avg RPS: %.1f)",
						stats.TotalRequests, dur, stats.RequestsPerSec)
					logInfo("Run %s: %s", runID, msg)
				} else {
					statsJSON, _ := json.Marshal(ev.Data)
					msg = string(statsJSON)
					logInfo("[Fuzz Complete] Run %s: %s", runID, msg)
				}
				sendEvent("runner_log", map[string]interface{}{
					"level":     "info",
					"message":   msg,
					"timestamp": time.Now().Format(time.RFC3339),
				})
			} else if ev.Type == "error" {
				logError("[Fuzz Error] Run %s: %v", runID, ev.Data)
				sendEvent("runner_log", map[string]interface{}{
					"level":     "error",
					"message":   fmt.Sprintf("%v", ev.Data),
					"timestamp": time.Now().Format(time.RFC3339),
				})
			}
			sendEvent(ev.Type, ev.Data)
		}
	}(dispatch.RunID)

	go func(runID string) {
		defer func() {
			panicked := recover()
			if panicked != nil {
				logError("Runner for %s panicked: %v\n%s", runID, panicked, debug.Stack())
				r.Close()
			}
			// It no longer runs here, even while its last events are still being forwarded: a
			// new dispatch of the run must not be ignored as "already running".
			d.activeRunnersMu.Lock()
			delete(d.activeRunners, runID)
			d.activeRunnersMu.Unlock()
			d.finishExecution(runID, panicked != nil, terminal.Load, subDone, func() interface{} { return r.GetStats() }, sendEvent, sendError)
		}()
		sendRunnerLog := func(level, msg string) {
			sendEvent("runner_log", map[string]interface{}{
				"level":     level,
				"message":   msg,
				"timestamp": time.Now().Format(time.RFC3339),
			})
		}

		logInfo("Starting fuzz runner for runID: %s", runID)
		sendRunnerLog("info", fmt.Sprintf("Starting fuzz runner for runID: %s", runID))
		if r.Config() != nil && r.Config().Settings.UseLLMPrepass {
			msg := fmt.Sprintf("[AI] 🤖 Pre-Scan LLM Batching enabled (Gateway: %s)", r.Config().Settings.AIGatewayURL)
			logInfo("%s", msg)
			sendRunnerLog("info", msg)
		} else {
			msg := "[AI] ℹ️ Pre-Scan LLM Batching is disabled in Project Settings"
			logInfo("%s", msg)
			sendRunnerLog("info", msg)
		}
		tURL := deriveTelemetryURL(d.coordinatorURL)
		IncrementGlobalScanTelemetry(tURL, d.disableTelemetry)
		if err := r.Start(ctx); err != nil {
			logError("Runner failed: %v", err)
			sendError(err.Error())
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
				if patchErr := sendTriageBatchToEdge(d.coordinatorURL, d.token, runID, triageResults); patchErr != nil {
					logError("Failed to send triage results to Edge API: %v", patchErr)
					sendRunnerLog("warning", fmt.Sprintf("[AI] ⚠️ Failed to upload triage results: %v", patchErr))
				} else {
					sendRunnerLog("info", fmt.Sprintf("[AI] ✅ Successfully applied Smart Triage to %d defect groups", len(triageResults)))
				}
			}
		}

		// Post-scan WAF Mitigation (Virtual Patch Generation)
		if wafResult := r.GetWAFCheckResult(); wafResult != nil && wafResult.Detection.Detected {
			findings := liveCls.ClassifyAll(r.Results())
			items := classifier.ToAuditResultItems(findings)
			if len(items) > 0 {
				client := wafcheck.NewClient(r.Config().Settings.WAFCheckEndpoint)
				patchCtx, patchCancel := context.WithTimeout(ctx, 20*time.Second)
				report, err := client.GeneratePatches(patchCtx, items, wafcheck.PatchOptions{
					Vendor: "all", TargetURL: r.Config().BaseURL, IncludeTerraform: true,
				})
				patchCancel()
				if err != nil {
					logWarn("[WAF] ⚠️ Patch generation failed: %v", err)
				} else if err := sendWAFPatchToEdge(d.coordinatorURL, d.token, runID, report); err != nil {
					logError("Failed to send WAF patch report to Edge API: %v", err)
					sendRunnerLog("warning", fmt.Sprintf("[WAF] ⚠️ Failed to upload WAF patch report: %v", err))
				} else {
					sendRunnerLog("info", fmt.Sprintf("[WAF] ✅ Generated WAF mitigation rules (%d bypasses)", report.TotalBypasses))
				}
			}
		}

		r.Close()
		logInfo("Runner for %s finished", runID)
	}(dispatch.RunID)
}

func (d *AgentDispatcher) handleParseRequest(wsMsg WSMessageIn) {
	var reqPayload struct {
		URL     string            `json:"url"`
		RawSpec string            `json:"rawSpec"`
		Headers map[string]string `json:"headers"`
		Cookies map[string]string `json:"cookies"`
	}
	if err := json.Unmarshal(wsMsg.Payload, &reqPayload); err != nil {
		logError("Failed to unmarshal parse_request payload: %v", err)
		return
	}
	reqID := wsMsg.ReqID

	logInfo("[Parser] Received parse request. URL: %s, Has RawSpec: %v", reqPayload.URL, reqPayload.RawSpec != "")

	select {
	case d.parseReqSem <- struct{}{}:
	default:
		logWarn("[Parser] Dropping parse request %s due to high concurrency", reqID)
		return
	}

	go func() { // #nosec G118 -- parse request handles asynchronous spec fetching
		defer func() { <-d.parseReqSem }()
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
		d.outChan <- msgPayload
	}()
}
