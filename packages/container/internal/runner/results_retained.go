// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import "swazz-engine/internal/swagger"

// The post-scan phases work from the run's successful results, which stay in memory until the run
// ends: BOLA replay and differential analysis use plain ones as candidates, Smart Triage and WAF
// patches use the ones with analyzer findings. A long scan produces far more than those phases
// use, each holding its payload and up to 50 KB of response body, so:
//
//   - plain results: the first maxRetainedPerEndpoint of each endpoint and profile while the run
//     has kept fewer than maxRetainedResults in all; past that, only the first
//     minRetainedPerEndpoint, so that endpoints fuzzed late still have candidates;
//   - results with findings: whole, the first maxFullPerDefect of each defect (rule and endpoint);
//     past that slim (slimResult, without payload, body and headers) so that triage verdicts
//     cover all of a defect's findings, up to maxSlimFindings slim ones in all.
//
// Every result is still streamed to subscribers as it arrives.
const (
	maxRetainedPerEndpoint = 25
	minRetainedPerEndpoint = 3
	maxRetainedResults     = 10000
	maxFullPerDefect       = 20
	maxSlimFindings        = 100000
)

// retainKey counts kept results: plain ones by endpoint and profile (rule empty), whole ones with
// findings by defect (profile empty).
type retainKey struct {
	rule, method, endpoint string
	profile                swagger.FuzzingProfile
}

// retainResult keeps a successful result for the post-scan phases, within the bounds above.
func (r *Runner) retainResult(result *swagger.FuzzResult) {
	r.resultsMu.Lock()
	defer r.resultsMu.Unlock()
	if r.retainedPer == nil {
		r.retainedPer = make(map[retainKey]int)
	}
	if len(result.AnalyzerFindings) == 0 {
		key := retainKey{method: result.Method, endpoint: result.Endpoint, profile: result.Profile}
		limit := maxRetainedPerEndpoint
		if r.retainedPlain >= maxRetainedResults {
			limit = minRetainedPerEndpoint
		}
		if r.retainedPer[key] >= limit {
			r.notRetained++
			return
		}
		r.retainedPer[key]++
		r.retainedPlain++
		r.allResults = append(r.allResults, result)
		return
	}
	whole := false
	for i, f := range result.AnalyzerFindings {
		if f.RuleID == "" || seenRuleBefore(result.AnalyzerFindings[:i], f.RuleID) {
			continue
		}
		key := retainKey{rule: f.RuleID, method: result.Method, endpoint: result.Endpoint}
		if r.retainedPer[key] < maxFullPerDefect {
			r.retainedPer[key]++
			whole = true
		}
	}
	if !whole {
		if r.retainedSlim >= maxSlimFindings {
			r.notRetained++
			return
		}
		r.retainedSlim++
		result = slimResult(result)
	}
	r.allResults = append(r.allResults, result)
}

func seenRuleBefore(findings []swagger.AnalysisFinding, rule string) bool {
	for _, f := range findings {
		if f.RuleID == rule {
			return true
		}
	}
	return false
}

// slimResult is a copy of res without what makes a result large: its payload, response body and
// headers. Its findings, with their evidence, stay.
func slimResult(res *swagger.FuzzResult) *swagger.FuzzResult {
	c := *res
	c.Payload, c.ResponseBody = nil, nil
	c.ResponseHeaders, c.RequestHeaders = nil, nil
	c.Slim = true
	return &c
}

// replayCandidates are the retained results that still carry their request and response, for
// the phases that replay requests or harvest response bodies.
func replayCandidates(results []*swagger.FuzzResult) []*swagger.FuzzResult {
	out := make([]*swagger.FuzzResult, 0, len(results))
	for _, res := range results {
		if !res.Slim {
			out = append(out, res)
		}
	}
	return out
}
