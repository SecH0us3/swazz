// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"strings"
	"sync"

	"swazz-engine/internal/bola"
	"swazz-engine/internal/swagger"
)

type replayTarget struct {
	path string
	id   string
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
