package runner

import (
	"fmt"
	"time"

	"swazz-engine/internal/logger"
	"swazz-engine/internal/oob"
	"swazz-engine/internal/swagger"
)

// HandleOOBTrigger is called when an Out-of-Band trigger message is received from the coordinator.
func (r *Runner) HandleOOBTrigger(uuid string) {
	ctx, ok := oob.GlobalStore.GetAndRemoveUUID(uuid)
	if !ok {
		logger.Debug("OOB UUID not found or already processed: %s", uuid)
		return
	}

	logger.Warn("Out-of-Band (OOB) Interaction detected for endpoint: %s", ctx.Endpoint)

	// Build a simulated FuzzResult with a high-severity finding!
	res := &swagger.FuzzResult{
		ID:           "oob-" + uuid,
		Endpoint:     ctx.Endpoint,
		ResolvedPath: ctx.Endpoint, // Fallback if resolved path isn't known
		Method:       "FUZZ",       // Fallback
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
