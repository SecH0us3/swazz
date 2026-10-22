// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"slices"
	"unicode/utf8"

	"swazz-engine/internal/swagger"
)

// The post-scan phases work from the run's successful results, which stay in memory until the run
// ends: BOLA replay and differential analysis use plain ones as candidates, Smart Triage and WAF
// patches use the ones with analyzer findings. A long scan produces far more than those phases
// use, each holding its payload and up to 50 KB of response body, so:
//
//   - plain results: the first maxRetainedPerEndpoint of each endpoint and profile (active
//     parameter fuzzing counted apart from the main loop) while the run has kept fewer than
//     maxRetainedResults in all; past that, only the first minRetainedPerEndpoint, so that
//     endpoints fuzzed late still have candidates;
//   - results with findings: whole, the first maxFullPerDefect of each defect (rule and endpoint)
//     while the run has kept fewer than maxFullResults whole; otherwise slim (slimResult, without
//     payload, body and headers, and with its texts cut to maxSlimTextBytes) so that triage
//     verdicts cover all of a defect's findings, up to maxSlimFindings slim ones in all.
//
// Every result is still streamed to subscribers as it arrives. Worst case kept: about
// maxRetainedResults + maxFullResults results with bodies and maxSlimFindings small ones.
const (
	maxRetainedPerEndpoint = 25
	minRetainedPerEndpoint = 3
	maxRetainedResults     = 10000
	maxFullPerDefect       = 20
	maxFullResults         = 2000
	maxSlimFindings        = 100000
	maxSlimTextBytes       = 1000
)

// retainedResults counts what retainResult kept.
type retainedResults struct {
	plainPer  map[plainKey]int
	defectPer map[defectKey]int
	plain     int // plain results kept
	full      int // whole results with findings kept
	slim      int // slim results kept
	// notRetained counts the successful results not kept, droppedFindings the findings on them.
	notRetained, droppedFindings int
}

type plainKey struct {
	method, endpoint string
	profile          swagger.FuzzingProfile
	active           bool // from active parameter fuzzing
}

type defectKey struct{ rule, method, endpoint string }

// retainResult keeps a successful result of the main fuzz loop for the post-scan phases, within
// the bounds above.
func (r *Runner) retainResult(result *swagger.FuzzResult) { r.retain(result, false) }

// retainActiveResult is retainResult for a result of active parameter fuzzing.
func (r *Runner) retainActiveResult(result *swagger.FuzzResult) { r.retain(result, true) }

func (r *Runner) retain(result *swagger.FuzzResult, active bool) {
	r.resultsMu.Lock()
	defer r.resultsMu.Unlock()
	k := &r.retained
	if len(result.AnalyzerFindings) == 0 {
		if k.plainPer == nil {
			k.plainPer = make(map[plainKey]int)
		}
		key := plainKey{method: result.Method, endpoint: result.Endpoint, profile: result.Profile, active: active}
		limit := maxRetainedPerEndpoint
		if k.plain >= maxRetainedResults {
			limit = minRetainedPerEndpoint
		}
		if k.plainPer[key] >= limit {
			k.notRetained++
			return
		}
		k.plainPer[key]++
		k.plain++
		r.allResults = append(r.allResults, result)
		return
	}
	if k.defectPer == nil {
		k.defectPer = make(map[defectKey]int)
	}
	whole := false
	if k.full < maxFullResults {
		for i, f := range result.AnalyzerFindings {
			if slices.ContainsFunc(result.AnalyzerFindings[:i], func(g swagger.AnalysisFinding) bool { return g.RuleID == f.RuleID }) {
				continue
			}
			key := defectKey{rule: f.RuleID, method: result.Method, endpoint: result.Endpoint}
			if k.defectPer[key] < maxFullPerDefect {
				k.defectPer[key]++
				whole = true
			}
		}
	}
	if whole {
		k.full++
	} else {
		if k.slim >= maxSlimFindings {
			k.notRetained++
			k.droppedFindings += len(result.AnalyzerFindings)
			return
		}
		k.slim++
		result = slimResult(result)
	}
	r.allResults = append(r.allResults, result)
}

// slimResult is a copy of res without what makes a result large: its payload, response body and
// headers go, and the texts that may carry the payload or a response fragment (the request URI,
// the error, each finding's evidence and message) are cut to maxSlimTextBytes. The streamed
// result is left as it is.
func slimResult(res *swagger.FuzzResult) *swagger.FuzzResult {
	c := *res
	c.Payload, c.ResponseBody = nil, nil
	c.ResponseHeaders, c.RequestHeaders = nil, nil
	c.RequestURI = cutText(c.RequestURI, maxSlimTextBytes)
	c.ResolvedPath = cutText(c.ResolvedPath, maxSlimTextBytes)
	c.Error = cutText(c.Error, maxSlimTextBytes)
	c.AnalyzerFindings = make([]swagger.AnalysisFinding, len(res.AnalyzerFindings))
	for i, f := range res.AnalyzerFindings {
		f.Evidence = cutText(f.Evidence, maxSlimTextBytes)
		f.Message = cutText(f.Message, maxSlimTextBytes)
		c.AnalyzerFindings[i] = f
	}
	c.Slim = true
	return &c
}

// cutText cuts s to at most n bytes without splitting a UTF-8 character.
func cutText(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for i := 0; i < utf8.UTFMax-1 && n > 0 && !utf8.RuneStart(s[n]); i++ {
		n--
	}
	return s[:n]
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
