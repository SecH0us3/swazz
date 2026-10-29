// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"fmt"
	"strings"
	"time"

	"swazz-engine/internal/logger"
	"swazz-engine/internal/oob"
	"swazz-engine/internal/swagger"
)

// maxHandedOverOOBTokens bounds the tokens a run hands to the coordinator when it ends (the most
// recently sent are kept), and oobPendingBatchSize how many go in one event, which keeps each
// event well under the coordinator's 128 KB message limit.
const (
	maxHandedOverOOBTokens = 2000
	oobPendingBatchSize    = 25
)

// OOBPendingBatch is the data of an EventOOBPending event.
type OOBPendingBatch struct {
	Tokens []oob.PendingToken `json:"tokens"`
}

// handOverPendingOOB sends the run's unanswered OOB tokens, in batches, before the run's end
// event: the coordinator accepts a run's events only until it ends. A callback that arrives
// later is then reported by the coordinator instead of being lost with the run's store.
// Only a run whose OOB server is the coordinator hands its tokens over (HandOverOOBTokens): with
// another server, or in CLI mode, nothing could report a later callback.
func (r *Runner) handOverPendingOOB() {
	if !r.handOverOOB.Load() {
		return
	}
	waiting := r.oobStore.Size()
	tokens := r.oobStore.TakePending(maxHandedOverOOBTokens)
	if len(tokens) == 0 {
		return
	}
	if waiting > len(tokens) {
		r.logWarn("[OOB] %d OOB tokens were still waiting when the run ended; only the %d most recent can be reported if their callback comes later", waiting, len(tokens))
	}
	for start := 0; start < len(tokens); start += oobPendingBatchSize {
		end := min(start+oobPendingBatchSize, len(tokens))
		r.Broadcast(Event{Type: EventOOBPending, Data: OOBPendingBatch{Tokens: tokens[start:end]}})
	}
}

// announceOOBHandOver tells the coordinator, with an empty batch, that the run will hand its
// tokens over when it ends. It is sent at the start of the grace period, well before the tokens
// leave the store, so a callback that comes as they move is looked up again rather than lost.
func (r *Runner) announceOOBHandOver() {
	if r.handOverOOB.Load() {
		r.Broadcast(Event{Type: EventOOBPending, Data: OOBPendingBatch{Tokens: []oob.PendingToken{}}})
	}
}

// HandOverOOBTokens makes the run hand its unanswered OOB tokens to the coordinator when it ends.
// The agent calls it for a run whose OOB callbacks go to the coordinator.
func (r *Runner) HandOverOOBTokens() { r.handOverOOB.Store(true) }

// HandleOOBTrigger is called when an Out-of-Band trigger message is received from the coordinator.
func (r *Runner) HandleOOBTrigger(uuid string) {
	ctx, ok := r.oobStore.GetAndRemoveUUID(uuid)
	if !ok {
		logger.Debug("OOB UUID not found or already processed: %s", uuid)
		return
	}

	logger.Warn("Out-of-Band (OOB) Interaction detected for endpoint: %s", ctx.Endpoint)

	// Parse method and path template from ctx.Endpoint (which has format "METHOD PATH")
	method := "FUZZ"
	endpointPath := ctx.Endpoint
	if parts := strings.Split(ctx.Endpoint, " "); len(parts) >= 2 {
		method = parts[0]
		endpointPath = parts[1]
	}

	// Build a simulated FuzzResult with a high-severity finding!
	res := &swagger.FuzzResult{
		ID:           "oob-" + uuid,
		Endpoint:     endpointPath,
		ResolvedPath: endpointPath, // Fallback if resolved path isn't known
		Method:       method,
		Profile:      swagger.ProfileMalicious,
		Status:       0, // Indicates OOB callback triggered independently
		Timestamp:    time.Now().UnixMilli(),
		Payload:      ctx.Payload,
	}

	if ctx.Request != nil {
		res.Method = ctx.Request.Method
		res.ResolvedPath = ctx.Request.ResolvedPath
		res.RequestHeaders = ctx.Request.Headers
	}

	// Create the OOB finding
	finding := swagger.AnalysisFinding{
		RuleID:        "swazz/oob-interaction",
		Level:         "error",
		Message:       fmt.Sprintf("Out-of-Band (OOB) Interaction detected: the target application initiated an external connection in response to the payload: %v", ctx.Payload),
		Evidence:      fmt.Sprintf("Callback triggered with token/UUID: %s", uuid),
		OWASPCategory: []string{"A08:2025 Software or Data Integrity Failures"}, // SSRF / Integrity failures
	}

	res.AnalyzerFindings = []swagger.AnalysisFinding{finding}
	res.OWASPCategory = finding.OWASPCategory

	// Broadcast this result to notify the coordinator/UI immediately
	r.Broadcast(Event{
		Type: EventResult,
		Data: ToSSE(res),
	})
}
