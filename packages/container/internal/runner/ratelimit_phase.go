package runner

import (
	"context"
	"fmt"
	"swazz-engine/internal/generator"
	"swazz-engine/internal/ratelimit"
	"swazz-engine/internal/swagger"
	"time"

	"github.com/google/uuid"
)

func (r *Runner) rateLimitPhase(ctx context.Context) {
	r.configMu.RLock()
	checkEnabled := r.config.Settings.RateLimitCheck
	burstSize := r.config.Settings.RateLimitBurstSize
	timeoutMs := r.config.Settings.TimeoutMs
	r.configMu.RUnlock()

	if !checkEnabled {
		return
	}

	r.progress.currentProfile.Store("RATE-LIMIT")

	for _, endpoint := range r.config.Endpoints {
		if r.stopped() {
			break
		}

		epKey := fmt.Sprintf("%s %s", endpoint.Method, endpoint.Path)
		r.progress.currentEndpoint.Store(epKey)
		r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})

		safeGen := generator.New(r.config.Dictionaries, swagger.ProfileRandom, r.config.Settings)
		safeGen.Endpoint = endpoint.Method + " " + endpoint.Path

		var payload any
		var queryParams map[string]any
		var generatedHeaders map[string]string

		if hasFields(&endpoint) {
			generated := safeGen.BuildObject(&endpoint.Schema)
			isBody := !isNoBodyMethod(endpoint.Method)
			if isBody {
				payload = generated
			} else {
				queryParams = generated
			}
			if len(endpoint.HeaderParams) > 0 {
				generatedHeaders = make(map[string]string)
				headerSchema := &swagger.SchemaProperty{
					Type:       "object",
					Properties: endpoint.HeaderParams,
				}
				headerObj := safeGen.BuildObject(headerSchema)
				for k, v := range headerObj {
					generatedHeaders[k] = fmt.Sprintf("%v", v)
				}
			}
		}

		resolvedPath := fillPathParams(endpoint.Path, endpoint.PathParams, safeGen)

		// Merge headers: generatedHeaders < global headers
		mergedHeaders := make(map[string]string)
		for k, v := range generatedHeaders {
			mergedHeaders[k] = v
		}
		r.configMu.RLock()
		for k, v := range r.config.GlobalHeaders {
			mergedHeaders[k] = r.subVarsLocked(v)
		}
		r.configMu.RUnlock()

		finding, statusCodes := ratelimit.Check(
			ctx,
			r.client,
			r.config.BaseURL,
			resolvedPath,
			endpoint.Path,
			endpoint.Method,
			mergedHeaders,
			payload,
			queryParams,
			endpoint.ContentType,
			burstSize,
			timeoutMs,
		)

		// Record the burst results in stats
		for i, status := range statusCodes {
			msg := statsMsg{
				result: &swagger.FuzzResult{
					ID:           uuid.New().String(),
					Endpoint:     endpoint.Path,
					ResolvedPath: resolvedPath,
					Method:       endpoint.Method,
					Profile:      swagger.FuzzingProfile("RATE-LIMIT"),
					Status:       status,
					Timestamp:    time.Now().UnixMilli(),
				},
				currentIteration: i + 1,
				totalIterations:  len(statusCodes),
			}

			select {
			case r.statsChan <- msg:
			case <-ctx.Done():
				return
			}
		}

		if finding != nil {
			evidenceStr := fmt.Sprintf("%v", finding.ResponseBody)
			result := &swagger.FuzzResult{
				ID:           uuid.New().String(),
				Endpoint:     endpoint.Path,
				ResolvedPath: resolvedPath,
				Method:       endpoint.Method,
				Profile:      swagger.FuzzingProfile("RATE-LIMIT"),
				Status:       finding.Status,
				Duration:     finding.Duration,
				Payload:      nil,
				Timestamp:    finding.Timestamp,
				ResponseBody: evidenceStr,
				AnalyzerFindings: []swagger.AnalysisFinding{
					{
						RuleID:   finding.RuleID,
						Level:    string(finding.Level),
						Message:  evidenceStr,
						Evidence: evidenceStr,
					},
				},
			}
			r.Broadcast(Event{Type: EventResult, Data: result})
		}

		r.progress.completedEndpoints.Add(1)
		r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})
	}
}
