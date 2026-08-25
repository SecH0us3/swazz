// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"strconv"
	"strings"
	"sync"

	"swazz-engine/internal/generator"
	"swazz-engine/internal/swagger"
)

const (
	// maxHarvestedIDsToTest caps how many harvested IDs are tried per endpoint
	// during candidate generation and path expansion.  Keeps the phase bounded.
	maxHarvestedIDsToTest = 25
)

// substituteIDInPath replaces every path segment that matches {<idParam>} with
// the supplied id string and returns the resulting concrete path.
// e.g. substituteIDInPath("/api/goods/{id}", "42") → "/api/goods/42".
func substituteIDInPath(templatePath, id string) string {
	parts := strings.Split(strings.Trim(templatePath, "/"), "/")
	out := make([]string, len(parts))
	copy(out, parts)
	for i, part := range parts {
		if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
			paramName := part[1 : len(part)-1]
			if isIDParam(paramName) {
				out[i] = id
			}
		}
	}
	return "/" + strings.Join(out, "/")
}

// substituteIDsInPayload replaces ID-like field values in a JSON structure
// with harvestedID, preserving the original value type.
func substituteIDsInPayload(data any, paramName string, harvestedID string) any {
	switch val := data.(type) {
	case map[string]any:
		newMap := make(map[string]any, len(val))
		for k, v := range val {
			if strings.EqualFold(k, paramName) || isIDParam(k) {
				newMap[k] = coerceID(v, harvestedID)
			} else {
				newMap[k] = substituteIDsInPayload(v, paramName, harvestedID)
			}
		}
		return newMap
	case []any:
		newArr := make([]any, len(val))
		for i, v := range val {
			newArr[i] = substituteIDsInPayload(v, paramName, harvestedID)
		}
		return newArr
	default:
		return data
	}
}

// coerceID converts harvestedID (always a string) into the same Go type as
// orig so that payload serialisation round-trips cleanly.
func coerceID(orig any, harvestedID string) any {
	switch orig.(type) {
	case float64:
		if v, err := strconv.ParseFloat(harvestedID, 64); err == nil {
			return v
		}
	case int:
		if v, err := strconv.Atoi(harvestedID); err == nil {
			return v
		}
	case int64:
		if v, err := strconv.ParseInt(harvestedID, 10, 64); err == nil {
			return v
		}
	}
	return harvestedID
}

// copyMapAny performs a shallow copy of a map[string]any.
func copyMapAny(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// identifyCandidates selects all 2xx results as replay candidates and records
// which endpoint×method combinations already have a successful result.
func (r *Runner) identifyCandidates(results []*swagger.FuzzResult) ([]*swagger.FuzzResult, map[string]bool) {
	var candidates []*swagger.FuzzResult
	hasSuccess := make(map[string]bool, len(results))
	for _, res := range results {
		if res.Status >= 200 && res.Status < 300 {
			candidates = append(candidates, res)
			hasSuccess[strings.ToUpper(res.Method)+" "+res.Endpoint] = true
		}
	}
	return candidates, hasSuccess
}

// generateMissingCandidates fires one safe request per endpoint that never
// returned 2xx during the main fuzz run, trying harvested IDs first.
func (r *Runner) generateMissingCandidates(ctx context.Context, hasSuccessCandidate map[string]bool) []*swagger.FuzzResult {
	var (
		candidates          []*swagger.FuzzResult
		candMu              sync.Mutex
		candWg              sync.WaitGroup
		numMissingEndpoints int32
	)

	for _, ep := range r.config.Endpoints {
		if !hasSuccessCandidate[strings.ToUpper(ep.Method)+" "+ep.Path] {
			numMissingEndpoints++
		}
	}
	r.progress.totalEndpoints.Add(numMissingEndpoints)
	r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})

	for _, ep := range r.config.Endpoints {
		if hasSuccessCandidate[strings.ToUpper(ep.Method)+" "+ep.Path] {
			continue
		}

		if err := r.limiter.Acquire(ctx); err != nil {
			break
		}
		candWg.Add(1)

		go func(ep swagger.EndpointConfig) {
			defer r.limiter.Release()
			defer candWg.Done()

			r.progress.currentEndpoint.Store(ep.Method + " " + ep.Path)
			r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})

			epGen := generator.New(r.config.Dictionaries, swagger.ProfileRandom, r.config.Settings)
			epGen.RunID = r.config.RunID
			if res := r.generateCandidateForEndpoint(ctx, ep, epGen); res != nil {
				candMu.Lock()
				candidates = append(candidates, res)
				candMu.Unlock()
			}

			r.progress.completedEndpoints.Add(1)
			r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})
		}(ep)
	}
	candWg.Wait()
	return candidates
}

// generateCandidateForEndpoint tries up to maxHarvestedIDsToTest harvested IDs
// to find a 2xx response for an endpoint that was never successfully reached
// during the main fuzz run.  Returns the best result (2xx preferred).
func (r *Runner) generateCandidateForEndpoint(
	ctx context.Context,
	ep swagger.EndpointConfig,
	safeGen *generator.Generator,
) *swagger.FuzzResult {
	harvested := r.collectAllHarvestedIDs()
	hasPathParams := strings.Contains(ep.Path, "{")

	// Build baseline payload once — reused and copied per iteration.
	var baseBody map[string]any
	if len(ep.Schema.Properties) > 0 || ep.Schema.Type == "array" || ep.Schema.Type == "object" {
		baseBody = safeGen.BuildObject(&ep.Schema)
	}

	paramName := candidateParamName(ep, hasPathParams, baseBody)

	limit := min(len(harvested), maxHarvestedIDsToTest)
	if limit == 0 {
		limit = 1 // always try at least once (random / empty ID)
	}

	var best *swagger.FuzzResult

	for i := range limit {
		resolvedPath := buildCandidatePath(ep.Path, hasPathParams, harvested, i)
		payload, queryParams := buildCandidatePayload(ep, baseBody, paramName, harvested, i)

		headers := r.globalHeadersWithGenerated(safeGen.GenerateSecurityHeaders())
		r.progress.totalPlanned.Add(1)

		res := r.executeRequest(
			ctx,
			r.config.BaseURL, resolvedPath, ep.Path, ep.Method,
			headers, r.config.Cookies,
			payload,
			swagger.FuzzingProfile("BOLA"),
			queryParams,
			nil,
			ep.ContentType,
		)
		res.Identity = "User A"

		r.statsChan <- statsMsg{result: res, currentIteration: i + 1, totalIterations: limit}
		r.Broadcast(Event{Type: EventResult, Data: res})

		if res.Status >= 200 && res.Status < 300 {
			return res // first success wins
		}
		if best == nil {
			best = res
		}
	}
	return best
}

// candidateParamName determines the relevant ID parameter name for an endpoint
// — either the first path parameter or a body field that looks like an ID.
func candidateParamName(ep swagger.EndpointConfig, hasPathParams bool, body map[string]any) string {
	if hasPathParams {
		return firstPathParam(ep.Path)
	}
	for k := range body {
		if isIDParam(k) {
			return k
		}
	}
	return ""
}

// buildCandidatePath returns a concrete path for attempt i.
// If harvested IDs are available they are injected into {id}-like segments;
// otherwise the fallback value "1" is used.
func buildCandidatePath(templatePath string, hasPathParams bool, harvested []string, i int) string {
	if !hasPathParams {
		return templatePath
	}
	if len(harvested) > 0 && i < len(harvested) {
		return substituteIDInPath(templatePath, harvested[i])
	}
	// No harvested IDs — use a safe fallback.
	return substituteIDInPath(templatePath, "1")
}

// buildCandidatePayload assembles the body / query params for one candidate
// attempt, substituting the harvested ID when available.
func buildCandidatePayload(
	ep swagger.EndpointConfig,
	baseBody map[string]any,
	paramName string,
	harvested []string,
	i int,
) (payload any, queryParams map[string]any) {
	if baseBody != nil {
		genCopy := copyMapAny(baseBody)
		if paramName != "" && len(harvested) > 0 && i < len(harvested) {
			if sub, ok := substituteIDsInPayload(genCopy, paramName, harvested[i]).(map[string]any); ok {
				genCopy = sub
			}
		}
		if isNoBodyMethod(ep.Method) {
			return nil, genCopy
		}
		return genCopy, nil
	}
	if ep.Example != nil {
		if isNoBodyMethod(ep.Method) {
			qp, _ := ep.Example.(map[string]any)
			return nil, qp
		}
		return ep.Example, nil
	}
	return nil, nil
}
