// bola.go: Access Control & BOLA/IDOR testing phase.
//
// # Phase Overview
//
// The bolaPhase runs after the main fuzz loop and executes four sub-steps:
//
//  1. authenticateIdentities — runs auth sequences for each configured identity.
//  2. identifyCandidates     — picks 2xx results as replay candidates.
//  3. generateMissingCandidates — fires one safe request per endpoint that
//     never returned 2xx, so every endpoint gets at least one candidate.
//  4. replayCandidates       — replays each candidate under alternate identities
//     and anonymously, flagging responses with high body-similarity to the
//     User A baseline (BOLA/IDOR or Unauthorized Access findings).
//
// # ID Harvesting
//
// harvestFromResponse is called after every successful fuzz request.  It
// extracts IDs from JSON response bodies using two strategies:
//
//   - Explicit mapping: endpoint.ExtractVariables (jsonpath → variable name).
//   - Heuristic: any field whose lowercase name is "id", "uuid", or ends in
//     "id" is collected into harvestedIDs keyed by path prefix.
//
// Harvested IDs are later injected into path parameters and payloads during the
// BOLA replay to probe cross-user data leakage.

package runner

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"

	"swazz-engine/internal/bola"
	"swazz-engine/internal/generator"
	"swazz-engine/internal/swagger"
)

// ─── Constants ────────────────────────────────────────────────────────────────

const (
	// maxHarvestedIDsToTest caps how many harvested IDs are tried per endpoint
	// during candidate generation and path expansion.  Keeps the phase bounded.
	maxHarvestedIDsToTest = 25

	// defaultBOLAThreshold is the minimum body-similarity score required to
	// classify a response as a confirmed BOLA/IDOR or unauthorised-access hit.
	defaultBOLAThreshold = 0.85
)

// ─── Small pure helpers ───────────────────────────────────────────────────────

// isIDParam reports whether a struct-field name looks like an identifier
// parameter (id, uuid, anything ending in "id").
// This predicate used to be repeated 6+ times inline; giving it a name makes
// the intent visible at each call site.
func isIDParam(name string) bool {
	lower := strings.ToLower(name)
	return lower == "id" || lower == "uuid" || strings.HasSuffix(lower, "id")
}

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

// firstPathParam returns the name of the first {param} segment in a URL
// template, or "" if none exists.
func firstPathParam(templatePath string) string {
	for _, part := range strings.Split(strings.Trim(templatePath, "/"), "/") {
		if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
			return part[1 : len(part)-1]
		}
	}
	return ""
}

// bolaThreshold returns the configured BOLA similarity threshold, falling back
// to the package default when the setting is unset or zero.
func bolaThreshold(settings swagger.Settings) float64 {
	if settings.BOLASimilarityThreshold > 0 {
		return settings.BOLASimilarityThreshold
	}
	return defaultBOLAThreshold
}

// formatIdentityName returns a display-friendly identity name.
func formatIdentityName(name string) string {
	if strings.EqualFold(name, "userb") {
		return "User B"
	}
	return name
}

// getPathPrefix returns the static prefix of a URL template up to the first
// path parameter, e.g. "/api/goods/{id}" → "/api/goods".
func getPathPrefix(originalPath string) string {
	idx := strings.IndexByte(originalPath, '{')
	if idx != -1 {
		return strings.TrimRight(originalPath[:idx], "/")
	}
	return originalPath
}

// arePrefixesRelated reports whether two path prefixes share at least the first
// two segments, used to identify "sibling" endpoints in the same resource group.
func arePrefixesRelated(p1, p2 string) bool {
	p1Trim := strings.Trim(p1, "/")
	p2Trim := strings.Trim(p2, "/")
	if p1Trim == "" || p2Trim == "" {
		return false
	}
	p1Parts := strings.Split(p1Trim, "/")
	p2Parts := strings.Split(p2Trim, "/")

	matchLen := min(2, min(len(p1Parts), len(p2Parts)))
	if matchLen == 0 {
		return false
	}
	for i := range matchLen {
		if p1Parts[i] != p2Parts[i] {
			return false
		}
	}
	return true
}

// responseBodyToBytes normalises a response body ([]byte, string, or arbitrary
// JSON value) into a byte slice for similarity comparison.
func responseBodyToBytes(body any) []byte {
	if body == nil {
		return nil
	}
	switch v := body.(type) {
	case []byte:
		return v
	case string:
		return []byte(v)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return nil
		}
		return b
	}
}

// ─── ID harvesting ────────────────────────────────────────────────────────────

// harvestIDs recursively collects ID-like values from a JSON response body.
func harvestIDs(data any, ids map[string]bool) {
	switch val := data.(type) {
	case map[string]any:
		for k, v := range val {
			if isIDParam(k) {
				switch typed := v.(type) {
				case string:
					if typed != "" {
						ids[typed] = true
					}
				case float64:
					ids[strconv.FormatFloat(typed, 'f', -1, 64)] = true
				case int:
					ids[strconv.Itoa(typed)] = true
				case int64:
					ids[strconv.FormatInt(typed, 10)] = true
				}
			}
			harvestIDs(v, ids)
		}
	case []any:
		for _, item := range val {
			harvestIDs(item, ids)
		}
	}
}

// harvestFromResponse extracts IDs and explicit variables from a successful
// response body and records them for the BOLA replay phase.
func (r *Runner) harvestFromResponse(originalPath, method string, respStatus int, respBody any) {
	if respStatus < 200 || respStatus >= 300 || respBody == nil {
		return
	}

	ep, found := r.findEndpointConfig(originalPath, method)
	if !found {
		return
	}

	// 1. Explicit JSONPath → variable mapping.
	if len(ep.ExtractVariables) > 0 {
		r.configMu.Lock()
		if r.config.Variables == nil {
			r.config.Variables = map[string]any{}
		}
		varsUpdated := false
		for jsonPath, varName := range ep.ExtractVariables {
			if val := extractJSONPathExtended(respBody, jsonPath); val != nil {
				r.config.Variables[varName] = val
				varsUpdated = true
				r.logDebug("[BOLA] Extracted variable %s = %v from response of %s %s",
					varName, val, method, originalPath)
			}
		}
		r.configMu.Unlock()
		if varsUpdated {
			r.updateReplacer()
		}
	}

	// 2. Heuristic ID harvesting.
	prefix := getPathPrefix(originalPath)
	harvested := make(map[string]bool)
	harvestIDs(respBody, harvested)
	if len(harvested) == 0 {
		return
	}

	newIDs := make([]string, 0, len(harvested))
	for id := range harvested {
		newIDs = append(newIDs, id)
		r.idSources.Store(id, fmt.Sprintf("%s %s", method, originalPath))
	}

	r.resultsMu.Lock()
	if val, ok := r.harvestedIDs.Load(prefix); ok {
		existing := val.([]string)
		merged := mergeUniqueStrings(existing, newIDs)
		r.harvestedIDs.Store(prefix, merged)
	} else {
		r.harvestedIDs.Store(prefix, newIDs)
	}
	r.resultsMu.Unlock()

	r.logDebug("[BOLA] Harvested IDs for prefix %s: %v", prefix, newIDs)
}

// mergeUniqueStrings returns the union of two string slices without duplicates.
func mergeUniqueStrings(a, b []string) []string {
	seen := make(map[string]bool, len(a)+len(b))
	for _, s := range a {
		seen[s] = true
	}
	for _, s := range b {
		seen[s] = true
	}
	out := make([]string, 0, len(seen))
	for s := range seen {
		out = append(out, s)
	}
	return out
}

// collectAllHarvestedIDs returns a deduplicated slice of every ID harvested
// across all endpoint prefixes.
func (r *Runner) collectAllHarvestedIDs() []string {
	unique := make(map[string]bool)
	r.harvestedIDs.Range(func(_, value any) bool {
		for _, id := range value.([]string) {
			unique[id] = true
		}
		return true
	})
	out := make([]string, 0, len(unique))
	for id := range unique {
		out = append(out, id)
	}
	return out
}

// ─── Payload / path helpers ───────────────────────────────────────────────────

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

// extractParamsFromPath extracts path parameter values by comparing the URL
// template with a concrete resolved path.
// e.g. template="/api/goods/{id}", resolved="/api/goods/42" → {"id": "42"}.
func extractParamsFromPath(originalPath, resolvedPath string) map[string]string {
	params := map[string]string{}
	origParts := strings.Split(strings.Trim(originalPath, "/"), "/")
	resolParts := strings.Split(strings.Trim(resolvedPath, "/"), "/")
	if len(origParts) != len(resolParts) {
		return params
	}
	for i, part := range origParts {
		if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
			params[part[1:len(part)-1]] = resolParts[i]
		}
	}
	return params
}

// extractJSONPathExtended traverses a parsed JSON value using a simple
// dot-separated path with optional array indexing (e.g. "data.items[0].id").
func extractJSONPathExtended(data any, path string) any {
	path = strings.TrimPrefix(strings.TrimPrefix(path, "$"), ".")
	if path == "" {
		return data
	}

	current := data
	for i, part := range strings.Split(path, ".") {
		if current == nil {
			return nil
		}
		key := part
		arrIdx := -1

		if start := strings.IndexByte(part, '['); start >= 0 {
			if end := strings.IndexByte(part, ']'); end > start {
				if idx, err := strconv.Atoi(part[start+1 : end]); err == nil {
					arrIdx = idx
					key = part[:start]
				}
			}
		}

		if key != "" {
			m, ok := current.(map[string]any)
			if !ok {
				return nil
			}
			current = m[key]
		}

		if current != nil && arrIdx >= 0 {
			arr, ok := current.([]any)
			if !ok || arrIdx >= len(arr) {
				return nil
			}
			current = arr[arrIdx]
		}

		if current == nil {
			return nil
		}
		if i == len(strings.Split(path, "."))-1 {
			return current
		}
	}
	return nil
}

// ─── Runner helpers ───────────────────────────────────────────────────────────

// findEndpointConfig looks up an endpoint configuration by path and method.
func (r *Runner) findEndpointConfig(path, method string) (swagger.EndpointConfig, bool) {
	r.configMu.RLock()
	defer r.configMu.RUnlock()
	for _, ep := range r.config.Endpoints {
		if ep.Path == path && strings.EqualFold(ep.Method, method) {
			return ep, true
		}
	}
	return swagger.EndpointConfig{}, false
}

// ─── bolaPhase ────────────────────────────────────────────────────────────────

// bolaPhase is the top-level entry point for the Access Control / BOLA testing.
func (r *Runner) bolaPhase(ctx context.Context, results []*swagger.FuzzResult) []*swagger.FuzzResult {
	if !r.config.Settings.BOLATesting {
		return nil
	}

	concurrency := r.config.Settings.Concurrency
	switch {
	case concurrency <= 0:
		concurrency = 5
	case concurrency > 1000:
		r.logWarn("BOLA: Concurrency limit exceeded (max 1000)")
		return nil
	}
	r.limiter.SetTarget(concurrency)

	r.progress.currentProfile.Store("BOLA")
	r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})
	r.logInfo("Running Access Control & BOLA/IDOR testing phase...")

	identityHeaders, identityCookies := r.authenticateIdentities(ctx)

	candidates, hasSuccessCandidate := r.identifyCandidates(results)
	candidates = append(candidates, r.generateMissingCandidates(ctx, hasSuccessCandidate)...)

	r.progress.totalEndpoints.Add(int32(len(candidates))) // #nosec G115
	r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})

	bolaResults := r.replayCandidates(ctx, candidates, identityHeaders, identityCookies)
	r.logInfo("Access Control phase complete. Found %d findings.", len(bolaResults))
	return bolaResults
}

// authenticateIdentities runs the auth sequence for every configured identity
// and returns two maps: identity-name → headers, identity-name → cookies.
func (r *Runner) authenticateIdentities(ctx context.Context) (map[string]map[string]string, map[string]map[string]string) {
	headers := make(map[string]map[string]string, len(r.config.AuthIdentities))
	cookies := make(map[string]map[string]string, len(r.config.AuthIdentities))
	for name, identity := range r.config.AuthIdentities {
		h, c, err := r.ExecuteAuthSequence(ctx, identity.AuthSequence, identity.Headers, identity.Cookies)
		if err != nil {
			r.logError("BOLA: Failed to authenticate identity %s: %v", name, err)
			continue
		}
		headers[name] = h
		cookies[name] = c
	}
	return headers, cookies
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
		candidates         []*swagger.FuzzResult
		candMu             sync.Mutex
		candWg             sync.WaitGroup
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

// globalHeadersWithGenerated returns a merged header map of global config
// headers plus any additional generated headers.
func (r *Runner) globalHeadersWithGenerated(extra map[string]string) map[string]string {
	r.configMu.RLock()
	out := make(map[string]string, len(r.config.GlobalHeaders)+len(extra))
	for k, v := range r.config.GlobalHeaders {
		out[k] = v
	}
	r.configMu.RUnlock()
	for k, v := range extra {
		out[k] = v
	}
	return out
}

// copyMapAny performs a shallow copy of a map[string]any.
func copyMapAny(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// ─── Candidate replay ─────────────────────────────────────────────────────────

// replayCandidates dispatches one goroutine per candidate and collects BOLA
// findings from all identity + anonymous probes.
func (r *Runner) replayCandidates(
	ctx context.Context,
	candidates []*swagger.FuzzResult,
	identityHeaders, identityCookies map[string]map[string]string,
) []*swagger.FuzzResult {
	var (
		bolaResults []*swagger.FuzzResult
		bolaMu      sync.Mutex
		bolaWg      sync.WaitGroup
	)

	for _, cand := range candidates {
		if err := r.limiter.Acquire(ctx); err != nil {
			break
		}
		bolaWg.Add(1)

		go func(cand *swagger.FuzzResult) {
			defer r.limiter.Release()
			defer bolaWg.Done()

			r.progress.currentEndpoint.Store(cand.Method + " " + cand.Endpoint)
			r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})

			ep, found := r.findEndpointConfig(cand.Endpoint, cand.Method)
			if !found {
				r.progress.completedEndpoints.Add(1)
				r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})
				return
			}

			r.replayCandidate(ctx, cand, ep, identityHeaders, identityCookies, &bolaMu, &bolaResults)

			r.progress.completedEndpoints.Add(1)
			r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})
		}(cand)
	}
	bolaWg.Wait()
	return bolaResults
}

type replayTarget struct {
	path string
	id   string
}

// buildPathsToTest returns the set of concrete paths to probe for a given
// candidate, expanding harvested IDs into path parameters up to the cap.
func (r *Runner) buildPathsToTest(cand *swagger.FuzzResult) ([]replayTarget, string) {
	targets := []replayTarget{{path: cand.ResolvedPath, id: ""}}

	hasPathParams := strings.Contains(cand.Endpoint, "{")
	paramName := ""
	if hasPathParams {
		paramName = firstPathParam(cand.Endpoint)
	} else if m, ok := cand.Payload.(map[string]any); ok {
		for k := range m {
			if isIDParam(k) {
				paramName = k
				break
			}
		}
	}

	if paramName == "" {
		return targets, paramName
	}

	harvested := r.collectAllHarvestedIDs()
	limit := min(len(harvested), maxHarvestedIDsToTest)

	for i := range limit {
		var newPath string
		if hasPathParams {
			origParts := strings.Split(strings.Trim(cand.Endpoint, "/"), "/")
			resolParts := strings.Split(strings.Trim(cand.ResolvedPath, "/"), "/")
			if len(origParts) == len(resolParts) {
				for idx, part := range origParts {
					if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
						if isIDParam(part[1 : len(part)-1]) {
							resolParts[idx] = harvested[i]
						}
					}
				}
				newPath = "/" + strings.Join(resolParts, "/")
			}
		}
		if newPath == "" {
			newPath = cand.ResolvedPath
		}

		// Skip duplicates (same path + same injected ID).
		isDup := false
		for _, t := range targets {
			if t.path == newPath && t.id == harvested[i] {
				isDup = true
				break
			}
		}
		if !isDup {
			targets = append(targets, replayTarget{path: newPath, id: harvested[i]})
		}
	}

	return targets, paramName
}

// replayCandidate probes all paths for one candidate under each identity and
// anonymously, appending confirmed findings to bolaResults.
func (r *Runner) replayCandidate(
	ctx context.Context,
	cand *swagger.FuzzResult,
	ep swagger.EndpointConfig,
	identityHeaders, identityCookies map[string]map[string]string,
	bolaMu *sync.Mutex,
	bolaResults *[]*swagger.FuzzResult,
) {
	targets, paramName := r.buildPathsToTest(cand)

	// Skip BOLA/IDOR replay if the baseline request did not use any authentication credentials.
	// Replaying unauthenticated endpoints anonymously or under other identities
	// is guaranteed to succeed and only generates false positives.
	hasAuth := false
	dropHeaders := r.config.Settings.AuthHeaders
	if len(dropHeaders) == 0 {
		dropHeaders = []string{"Authorization", "X-API-Key"}
	}
	for k := range cand.RequestHeaders {
		if containsFold(dropHeaders, k) {
			hasAuth = true
			break
		}
	}
	if !hasAuth {
		dropCookies := r.config.Settings.AuthCookies
		if len(dropCookies) == 0 {
			dropCookies = []string{"session", "token", "jwt", "sid", "JSESSIONID", "PHPSESSID"}
		}
		if cookieHeader, ok := cand.RequestHeaders["Cookie"]; ok {
			for _, part := range strings.Split(cookieHeader, ";") {
				part = strings.TrimSpace(part)
				if part == "" {
					continue
				}
				nameVal := strings.SplitN(part, "=", 2)
				cookieName := strings.TrimSpace(nameVal[0])
				for _, dropCookie := range dropCookies {
					if strings.EqualFold(cookieName, dropCookie) {
						hasAuth = true
						break
					}
				}
				if hasAuth {
					break
				}
			}
		}
	}
	if !hasAuth {
		r.logDebug("[BOLA] Skipping %s %s — no auth credentials in baseline request",
			cand.Method, cand.Endpoint)
		return
	}

	confirmed := make(map[string]bool)

	for _, target := range targets {
		if allIdentitiesConfirmed(confirmed, identityHeaders) {
			break
		}

		payload, queryParams := resolveReplayPayload(cand, isNoBodyMethod(cand.Method), paramName, target.id)

		// Probe each named identity.
		for idName, headers := range identityHeaders {
			if confirmed[idName] {
				continue
			}
			r.probeIdentity(ctx, cand, ep, target.path, target.id, paramName,
				idName, headers, identityCookies[idName],
				payload, queryParams,
				confirmed, bolaMu, bolaResults,
			)
		}

		// Probe anonymous (no auth credentials).
		if !confirmed["Anonymous"] {
			r.probeAnonymous(ctx, cand, ep, target.path, target.id,
				payload, queryParams,
				confirmed, bolaMu, bolaResults,
			)
		}
	}
}

// allIdentitiesConfirmed reports whether every named identity and anonymous has
// already been confirmed as a bypass, allowing early exit from the path loop.
func allIdentitiesConfirmed(confirmed map[string]bool, identityHeaders map[string]map[string]string) bool {
	for idName := range identityHeaders {
		if !confirmed[idName] {
			return false
		}
	}
	return confirmed["Anonymous"]
}

// resolveReplayPayload prepares the replay payload for a given candidate,
// optionally substituting the target ID into body / query fields.
func resolveReplayPayload(
	cand *swagger.FuzzResult,
	isGetLike bool,
	paramName, targetID string,
) (payload any, queryParams map[string]any) {
	if isGetLike {
		if m, ok := cand.Payload.(map[string]any); ok {
			if targetID != "" && paramName != "" {
				if sub, ok := substituteIDsInPayload(m, paramName, targetID).(map[string]any); ok {
					return nil, sub
				}
			}
			return nil, m
		}
		return nil, nil
	}
	if targetID != "" && paramName != "" && cand.Payload != nil {
		return substituteIDsInPayload(cand.Payload, paramName, targetID), nil
	}
	return cand.Payload, nil
}

// ─── Identity / anonymous probes ─────────────────────────────────────────────

// probeIdentity fires one request under a named identity's credentials and
// records a BOLA/IDOR or tenant-isolation finding if the response body is
// sufficiently similar to the User A candidate.
func (r *Runner) probeIdentity(
	ctx context.Context,
	cand *swagger.FuzzResult,
	ep swagger.EndpointConfig,
	resolvedPath, targetID, paramName string,
	idName string,
	headers map[string]string,
	cookies map[string]string,
	payload any,
	queryParams map[string]any,
	confirmed map[string]bool,
	bolaMu *sync.Mutex,
	bolaResults *[]*swagger.FuzzResult,
) {
	r.progress.totalPlanned.Add(1)

	res := r.executeRequest(
		ctx,
		r.config.BaseURL, resolvedPath, cand.Endpoint, cand.Method,
		headers, cookies,
		payload,
		swagger.FuzzingProfile("BOLA"),
		queryParams, nil,
		ep.ContentType,
	)

	r.statsChan <- statsMsg{result: res, currentIteration: 1, totalIterations: 1}

	if res.Status >= 200 && res.Status < 300 {
		sim := bola.CheckSimilarity(responseBodyToBytes(cand.ResponseBody), responseBodyToBytes(res.ResponseBody))
		if sim >= bolaThreshold(r.config.Settings) {
			displayName := formatIdentityName(idName)
			res.Identity = displayName
			confirmed[idName] = true

			finding := buildIDORFinding(displayName, cand, resolvedPath, res.Status, targetID, paramName, r.idSourceFor(targetID), sim)
			res.AnalyzerFindings = append(res.AnalyzerFindings, finding)

			bolaMu.Lock()
			*bolaResults = append(*bolaResults, res)
			bolaMu.Unlock()
		}
	}

	r.Broadcast(Event{Type: EventResult, Data: res})
}

// probeAnonymous fires one request with auth credentials stripped and records
// an unauthorized-access finding when the response is suspiciously similar.
func (r *Runner) probeAnonymous(
	ctx context.Context,
	cand *swagger.FuzzResult,
	ep swagger.EndpointConfig,
	resolvedPath, targetID string,
	payload any,
	queryParams map[string]any,
	confirmed map[string]bool,
	bolaMu *sync.Mutex,
	bolaResults *[]*swagger.FuzzResult,
) {
	anonHeaders, anonCookies := r.stripAuthCredentials()
	r.progress.totalPlanned.Add(1)

	res := r.executeRequest(
		ctx,
		r.config.BaseURL, resolvedPath, cand.Endpoint, cand.Method,
		anonHeaders, anonCookies,
		payload,
		swagger.FuzzingProfile("BOLA"),
		queryParams, nil,
		ep.ContentType,
	)

	r.statsChan <- statsMsg{result: res, currentIteration: 1, totalIterations: 1}

	if res.Status >= 200 && res.Status < 300 {
		sim := bola.CheckSimilarity(responseBodyToBytes(cand.ResponseBody), responseBodyToBytes(res.ResponseBody))
		if sim >= bolaThreshold(r.config.Settings) {
			res.Identity = "Anonymous"
			confirmed["Anonymous"] = true

			finding := buildUnauthorizedFinding(cand, resolvedPath, res.Status, targetID, r.idSourceFor(targetID), sim)
			res.AnalyzerFindings = append(res.AnalyzerFindings, finding)

			bolaMu.Lock()
			*bolaResults = append(*bolaResults, res)
			bolaMu.Unlock()
		}
	}

	r.Broadcast(Event{Type: EventResult, Data: res})
}

// stripAuthCredentials returns copies of global headers and cookies with
// known auth fields removed, simulating an anonymous request.
func (r *Runner) stripAuthCredentials() (headers, cookies map[string]string) {
	dropHeaders := r.config.Settings.AuthHeaders
	if len(dropHeaders) == 0 {
		dropHeaders = []string{"Authorization", "X-API-Key"}
	}
	dropCookies := r.config.Settings.AuthCookies
	if len(dropCookies) == 0 {
		dropCookies = []string{"session", "token", "jwt", "sid", "JSESSIONID", "PHPSESSID"}
	}

	r.configMu.RLock()
	headers = make(map[string]string, len(r.config.GlobalHeaders))
	for k, v := range r.config.GlobalHeaders {
		if !containsFold(dropHeaders, k) {
			headers[k] = v
		}
	}
	cookies = make(map[string]string, len(r.config.Cookies))
	for k, v := range r.config.Cookies {
		if !containsFold(dropCookies, k) {
			cookies[k] = v
		}
	}
	r.configMu.RUnlock()
	return headers, cookies
}

// containsFold reports whether any element of list equals s
// (case-insensitive).
func containsFold(list []string, s string) bool {
	for _, item := range list {
		if strings.EqualFold(item, s) {
			return true
		}
	}
	return false
}

// idSourceFor returns the recorded source endpoint for a harvested ID.
func (r *Runner) idSourceFor(id string) string {
	if id == "" {
		return "Unknown"
	}
	if src, ok := r.idSources.Load(id); ok {
		return src.(string)
	}
	return "Unknown"
}

// ─── Finding builders ─────────────────────────────────────────────────────────

// buildIDORFinding creates a BOLA/IDOR or tenant-isolation-bypass finding
// depending on whether a concrete resource ID was involved in the probe.
func buildIDORFinding(
	displayName string,
	cand *swagger.FuzzResult,
	resolvedPath string,
	status int,
	targetID, paramName, minedFrom string,
	sim float64,
) swagger.AnalysisFinding {
	if targetID != "" || paramName != "" {
		return swagger.AnalysisFinding{
			RuleID:   "swazz/bola-idor",
			Level:    "error",
			Message:  fmt.Sprintf("BOLA / IDOR vulnerability confirmed. Identity %s succeeded to access resource of Identity A.", displayName),
			Evidence: fmt.Sprintf("Identity: %s, Endpoint: %s %s, Status: %d, ID %s mined from: %s (Similarity: %.2f)", displayName, cand.Method, resolvedPath, status, targetID, minedFrom, sim),
		}
	}
	return swagger.AnalysisFinding{
		RuleID:   "swazz/tenant-isolation-bypass",
		Level:    "warning",
		Message:  fmt.Sprintf("Tenant Isolation Bypass candidate. Identity %s successfully accessed endpoint normally used by Identity A.", displayName),
		Evidence: fmt.Sprintf("Identity: %s, Endpoint: %s %s, Status: %d (Similarity: %.2f)", displayName, cand.Method, resolvedPath, status, sim),
	}
}

// buildUnauthorizedFinding creates an unauthorized-access finding for an
// anonymous probe that returned a suspiciously similar response.
func buildUnauthorizedFinding(
	cand *swagger.FuzzResult,
	resolvedPath string,
	status int,
	targetID, minedFrom string,
	sim float64,
) swagger.AnalysisFinding {
	evidence := fmt.Sprintf("Endpoint: %s %s, Status: %d (Similarity: %.2f)", cand.Method, resolvedPath, status, sim)
	if targetID != "" {
		evidence = fmt.Sprintf("Endpoint: %s %s, Status: %d, ID %s mined from: %s (Similarity: %.2f)", cand.Method, resolvedPath, status, targetID, minedFrom, sim)
	}
	return swagger.AnalysisFinding{
		RuleID:   "swazz/unauthorized-access",
		Level:    "error",
		Message:  "Unauthenticated access bypass vulnerability confirmed. Endpoint accepts requests without authentication credentials.",
		Evidence: evidence,
	}
}
