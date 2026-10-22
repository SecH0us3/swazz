// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package bola

import (
	"context"
	"net/url"
	"slices"
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
func (d *Detector) globalHeadersWithGenerated(extra map[string]string) map[string]string {
	d.ctx.RLockConfig()
	out := make(map[string]string, len(d.ctx.Config().GlobalHeaders)+len(extra))
	for k, v := range d.ctx.Config().GlobalHeaders {
		out[k] = v
	}
	d.ctx.RUnlockConfig()
	for k, v := range extra {
		out[k] = v
	}
	return out
}

// replayCandidates dispatches one goroutine per candidate and collects BOLA
// findings from all identity + anonymous probes. Non-DELETE candidates run
// first and wait to finish before DELETE candidates run, so destructive
// probes never delete a target object while read/update probes are still
// testing it.
func (d *Detector) replayCandidates(
	ctx context.Context,
	candidates []*swagger.FuzzResult,
	identityHeaders, identityCookies map[string]map[string]string,
) []*swagger.FuzzResult {
	var (
		bolaResults []*swagger.FuzzResult
		bolaMu      sync.Mutex
	)

	expandIDs := d.pickIDExpansionCandidates(candidates)

	var nonDelete, deleteCands []*swagger.FuzzResult
	for _, cand := range candidates {
		if strings.EqualFold(cand.Method, "DELETE") {
			deleteCands = append(deleteCands, cand)
		} else {
			nonDelete = append(nonDelete, cand)
		}
	}

	runBatch := func(batch []*swagger.FuzzResult) {
		var bolaWg sync.WaitGroup
		for _, cand := range batch {
			if err := d.ctx.LimiterAcquire(ctx); err != nil {
				break
			}
			bolaWg.Add(1)

			go func(cand *swagger.FuzzResult) {
				defer d.ctx.LimiterRelease()
				defer bolaWg.Done()

				d.ctx.UpdateProgressEndpoint(cand.Method + " " + cand.Endpoint)
				d.ctx.BroadcastProgress()

				ep, found := d.findEndpointConfig(cand.Endpoint, cand.Method)
				if !found {
					d.ctx.AddCompletedEndpoints(1)
					d.ctx.BroadcastProgress()
					return
				}

				d.replayCandidate(ctx, cand, ep, expandIDs[cand], identityHeaders, identityCookies, &bolaMu, &bolaResults)

				d.ctx.AddCompletedEndpoints(1)
				d.ctx.BroadcastProgress()
			}(cand)
		}
		bolaWg.Wait()
	}

	runBatch(nonDelete)
	runBatch(deleteCands)

	return bolaResults
}

// pickIDExpansionCandidates picks, for each endpoint, the one candidate whose replay also tries
// the harvested IDs: a run has a candidate for every 2xx result, and each ID target is probed
// under every identity, so expanding all of them multiplied the phase's requests. The pick is
// the first candidate in order that is replayed at all (its baseline carried auth) and has
// somewhere to put an ID (an ID param, a path that lines up with its template), preferring one
// not from an echo-prone profile (malicious, boundary), whose payload and response make a poor
// baseline.
func (d *Detector) pickIDExpansionCandidates(candidates []*swagger.FuzzResult) map[*swagger.FuzzResult]bool {
	picked := make(map[*swagger.FuzzResult]bool)
	done := make(map[string]bool)
	for _, allowEchoProne := range []bool{false, true} {
		for _, cand := range candidates {
			key := strings.ToUpper(cand.Method) + " " + cand.Endpoint
			if done[key] || (!allowEchoProne && isEchoProneProfile(cand.Profile)) ||
				replayParamName(cand) == "" {
				continue
			}
			if strings.Contains(cand.Endpoint, "{") {
				if _, _, aligned := alignedSegments(cand); !aligned || !templateHasIDParam(cand.Endpoint) {
					continue
				}
			}
			if d.baselineHasAuth(cand) {
				picked[cand] = true
				done[key] = true
			}
		}
	}
	return picked
}

// isEchoProneProfile reports whether the profile sends payloads a target tends to echo or choke
// on, so its 2xx responses make a poor replay baseline.
func isEchoProneProfile(p swagger.FuzzingProfile) bool {
	return p == swagger.ProfileMalicious || p == swagger.ProfileBoundary
}

// replayParamName is the parameter a replay puts an ID in: the first path parameter, or an
// ID-like key of the candidate's payload.
func replayParamName(cand *swagger.FuzzResult) string {
	if strings.Contains(cand.Endpoint, "{") {
		return firstPathParam(cand.Endpoint)
	}
	if m, ok := cand.Payload.(map[string]any); ok {
		for k := range m {
			if isIDParam(k) {
				return k
			}
		}
	}
	return ""
}

// alignedSegments splits the candidate's template and resolved path into segments; ok is false
// when their counts differ, so no ID can be placed by position.
func alignedSegments(cand *swagger.FuzzResult) (template, resolved []string, ok bool) {
	template = strings.Split(strings.Trim(cand.Endpoint, "/"), "/")
	resolved = strings.Split(strings.Trim(cand.ResolvedPath, "/"), "/")
	return template, resolved, len(template) == len(resolved)
}

// buildPathsToTest returns the set of concrete paths to probe for a given candidate: its own
// path and, when expandIDs (pickIDExpansionCandidates), harvested IDs placed in its ID
// parameter, up to the cap.
func (d *Detector) buildPathsToTest(cand *swagger.FuzzResult, expandIDs bool) ([]replayTarget, string) {
	targets := []replayTarget{{path: cand.ResolvedPath, id: ""}}

	hasPathParams := strings.Contains(cand.Endpoint, "{")
	paramName := replayParamName(cand)
	if paramName == "" || !expandIDs {
		return targets, paramName
	}

	origParts, resolParts, aligned := alignedSegments(cand)
	if hasPathParams && !aligned {
		return targets, paramName
	}

	for _, id := range d.harvestedIDsFor(getPathPrefix(cand.Endpoint), maxHarvestedIDsToTest) {
		newPath := cand.ResolvedPath
		if hasPathParams {
			newPath = "/" + strings.Join(placeIDInSegments(origParts, resolParts, id), "/")
		}
		// The candidate's own path already is the first target (a generated candidate already
		// carries a harvested ID), and the same path + ID is probed once.
		if templateHasIDParam(cand.Endpoint) {
			if unescaped, err := url.PathUnescape(newPath); newPath == cand.ResolvedPath || (err == nil && unescaped == cand.ResolvedPath) {
				continue
			}
		} else if m, ok := cand.Payload.(map[string]any); ok {
			if own, ok := formatIDScalar(m[paramName]); ok && own == id {
				continue
			}
		}
		if !slices.Contains(targets, replayTarget{path: newPath, id: id}) {
			targets = append(targets, replayTarget{path: newPath, id: id})
		}
	}

	return targets, paramName
}

var (
	defaultAuthHeaders = swagger.DefaultSettings().AuthHeaders
	defaultAuthCookies = swagger.DefaultSettings().AuthCookies
)

// authHeaderNames are the headers that carry credentials: the configured ones, or the defaults.
func authHeaderNames(s swagger.Settings) []string {
	if len(s.AuthHeaders) > 0 {
		return s.AuthHeaders
	}
	return defaultAuthHeaders
}

// authCookieNames are the cookies that carry credentials: the configured ones, or the defaults.
func authCookieNames(s swagger.Settings) []string {
	if len(s.AuthCookies) > 0 {
		return s.AuthCookies
	}
	return defaultAuthCookies
}

// baselineHasAuth reports whether the candidate's request carried authentication credentials: a
// configured (or default) auth header or auth cookie.
func (d *Detector) baselineHasAuth(cand *swagger.FuzzResult) bool {
	settings := d.ctx.Config().Settings
	headerNames := authHeaderNames(settings)
	for k := range cand.RequestHeaders {
		if containsFold(headerNames, k) {
			return true
		}
	}
	dropCookies := authCookieNames(settings)
	cookieHeader, ok := cand.RequestHeaders["Cookie"]
	if !ok {
		return false
	}
	for _, part := range strings.Split(cookieHeader, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		cookieName := strings.TrimSpace(strings.SplitN(part, "=", 2)[0])
		if containsFold(dropCookies, cookieName) {
			return true
		}
	}
	return false
}

// replayCandidate probes all paths for one candidate under each identity and
// anonymously, appending confirmed findings to bolaResults.
func (d *Detector) replayCandidate(
	ctx context.Context,
	cand *swagger.FuzzResult,
	ep swagger.EndpointConfig,
	expandIDs bool,
	identityHeaders, identityCookies map[string]map[string]string,
	bolaMu *sync.Mutex,
	bolaResults *[]*swagger.FuzzResult,
) {
	// Skip BOLA/IDOR replay if the baseline request did not use any authentication credentials.
	// Replaying unauthenticated endpoints anonymously or under other identities
	// is guaranteed to succeed and only generates false positives.
	if !d.baselineHasAuth(cand) {
		d.ctx.LogDebug("[BOLA] Skipping %s %s — no auth credentials in baseline request",
			cand.Method, cand.Endpoint)
		return
	}

	targets, paramName := d.buildPathsToTest(cand, expandIDs)

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
			d.probeIdentity(ctx, cand, ep, target.path, target.id, paramName,
				idName, headers, identityCookies[idName],
				payload, queryParams,
				confirmed, bolaMu, bolaResults,
			)
		}

		// Probe anonymous (no auth credentials).
		if !confirmed["Anonymous"] {
			d.probeAnonymous(ctx, cand, ep, target.path, target.id,
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

// probeSimilarity computes the similarity score between the baseline User A
// candidate and the probe response. If the baseline candidate itself did not
// succeed with 2xx (e.g. a DELETE candidate generated with a dummy UUID to
// avoid deleting User A's resource beforehand) and the probe succeeded with
// 2xx on a harvested ID (targetID != ""), the probe is treated as a confirmed
// match (similarity 1.0).
func probeSimilarity(cand, res *swagger.FuzzResult, targetID string) float64 {
	if (cand.Status < 200 || cand.Status >= 300) && targetID != "" {
		return 1.0
	}
	return bola.CheckSimilarity(responseBodyToBytes(cand.ResponseBody), responseBodyToBytes(res.ResponseBody))
}

// probeIdentity fires one request under a named identity's credentials and
// records a BOLA/IDOR or tenant-isolation finding if the response body is
// sufficiently similar to the User A candidate.
func (d *Detector) probeIdentity(
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
	d.ctx.AddTotalPlanned(1)

	res := d.ctx.ExecuteRequest(
		ctx,
		d.ctx.Config().BaseURL, resolvedPath, cand.Endpoint, cand.Method,
		headers, cookies,
		payload,
		swagger.FuzzingProfile("BOLA"),
		queryParams, nil,
		ep.ContentType,
	)

	d.ctx.SendStat(res, 1, 1)

	if res.Status >= 200 && res.Status < 300 {
		sim := probeSimilarity(cand, res, targetID)
		if sim >= bolaThreshold(d.ctx.Config().Settings) {
			displayName := formatIdentityName(idName)
			res.Identity = displayName
			confirmed[idName] = true

			finding := buildIDORFinding(displayName, cand, resolvedPath, res.Status, targetID, paramName, d.idSourceFor(targetID), sim)
			res.AnalyzerFindings = append(res.AnalyzerFindings, finding)

			bolaMu.Lock()
			*bolaResults = append(*bolaResults, res)
			bolaMu.Unlock()
		}
	}

	d.ctx.BroadcastResult(res)
}

// probeAnonymous fires one request with auth credentials stripped and records
// an unauthorized-access finding when the response is suspiciously similar.
func (d *Detector) probeAnonymous(
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
	anonHeaders, anonCookies := d.stripAuthCredentials()
	d.ctx.AddTotalPlanned(1)

	res := d.ctx.ExecuteRequest(
		ctx,
		d.ctx.Config().BaseURL, resolvedPath, cand.Endpoint, cand.Method,
		anonHeaders, anonCookies,
		payload,
		swagger.FuzzingProfile("BOLA"),
		queryParams, nil,
		ep.ContentType,
	)

	d.ctx.SendStat(res, 1, 1)

	if res.Status >= 200 && res.Status < 300 {
		sim := probeSimilarity(cand, res, targetID)
		if sim >= bolaThreshold(d.ctx.Config().Settings) {
			res.Identity = "Anonymous"
			confirmed["Anonymous"] = true

			finding := buildUnauthorizedFinding(cand, resolvedPath, res.Status, targetID, d.idSourceFor(targetID), sim)
			res.AnalyzerFindings = append(res.AnalyzerFindings, finding)

			bolaMu.Lock()
			*bolaResults = append(*bolaResults, res)
			bolaMu.Unlock()
		}
	}

	d.ctx.BroadcastResult(res)
}

// stripAuthCredentials returns copies of global headers and cookies with
// known auth fields removed, simulating an anonymous request.
func (d *Detector) stripAuthCredentials() (headers, cookies map[string]string) {
	dropHeaders := authHeaderNames(d.ctx.Config().Settings)
	dropCookies := authCookieNames(d.ctx.Config().Settings)

	d.ctx.RLockConfig()
	headers = make(map[string]string, len(d.ctx.Config().GlobalHeaders))
	for k, v := range d.ctx.Config().GlobalHeaders {
		if !containsFold(dropHeaders, k) {
			headers[k] = v
		}
	}
	cookies = make(map[string]string, len(d.ctx.Config().Cookies))
	for k, v := range d.ctx.Config().Cookies {
		if !containsFold(dropCookies, k) {
			cookies[k] = v
		}
	}
	d.ctx.RUnlockConfig()
	return headers, cookies
}
