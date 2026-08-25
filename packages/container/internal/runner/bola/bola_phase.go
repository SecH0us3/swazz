// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// bola_phase.go: Access Control & BOLA/IDOR testing phase.
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

package bola

import (
	"context"
	"strings"

	"swazz-engine/internal/swagger"
)

// findEndpointConfig looks up an endpoint configuration by path and method.
func (d *Detector) findEndpointConfig(path, method string) (swagger.EndpointConfig, bool) {
	d.ctx.RLockConfig()
	defer d.ctx.RUnlockConfig()
	for _, ep := range d.ctx.Config().Endpoints {
		if ep.Path == path && strings.EqualFold(ep.Method, method) {
			return ep, true
		}
	}
	return swagger.EndpointConfig{}, false
}

// bolaPhase is the top-level entry point for the Access Control / BOLA testing.
func (d *Detector) BolaPhase(ctx context.Context, results []*swagger.FuzzResult) []*swagger.FuzzResult {
	if !d.ctx.Config().Settings.BOLATesting {
		return nil
	}

	concurrency := d.ctx.Config().Settings.Concurrency
	switch {
	case concurrency <= 0:
		concurrency = 5
	case concurrency > 1000:
		d.ctx.LogWarn("BOLA: Concurrency limit exceeded (max 1000)")
		return nil
	}
	d.ctx.SetLimiterTarget(concurrency)

	d.ctx.UpdateProgressProfile("BOLA")
	d.ctx.BroadcastProgress()
	d.ctx.LogInfo("Running Access Control & BOLA/IDOR testing phase...")

	identityHeaders, identityCookies := d.authenticateIdentities(ctx)

	candidates, hasSuccessCandidate := d.identifyCandidates(results)
	candidates = append(candidates, d.generateMissingCandidates(ctx, hasSuccessCandidate)...)

	d.ctx.AddTotalEndpoints(int32(len(candidates))) // #nosec G115
	bolaResults := d.replayCandidates(ctx, candidates, identityHeaders, identityCookies)

	d.ctx.BroadcastProgress()

	d.ctx.LogInfo("Access Control phase complete. Found %d findings.", len(bolaResults))
	return bolaResults
}

// authenticateIdentities runs the auth sequence for every configured identity
// and returns two maps: identity-name → headers, identity-name → cookies.
func (d *Detector) authenticateIdentities(ctx context.Context) (map[string]map[string]string, map[string]map[string]string) {
	headers := make(map[string]map[string]string, len(d.ctx.Config().AuthIdentities))
	cookies := make(map[string]map[string]string, len(d.ctx.Config().AuthIdentities))
	for name, identity := range d.ctx.Config().AuthIdentities {
		h, c, err := d.ctx.ExecuteAuthSequence(ctx, identity.AuthSequence, identity.Headers, identity.Cookies)
		if err != nil {
			d.ctx.LogError("BOLA: Failed to authenticate identity %s: %v", name, err)
			continue
		}
		headers[name] = h
		cookies[name] = c
	}
	return headers, cookies
}
