// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package classifier

import (
	"strings"

	"swazz-engine/internal/swagger"
)

// maxFindingsPerDefect bounds how many findings one rule on one endpoint keeps.
const maxFindingsPerDefect = 5

// maxFindingBodyBytes bounds a finding's response body.
const maxFindingBodyBytes = 50000

type defectKey struct{ rule, method, endpoint string }

// Collector classifies results one at a time and keeps only the findings, so a caller that
// streams a scan's results need not hold all of them. Adding results in order gives the same
// findings as ClassifyAll over the same slice. It is not safe for concurrent use.
type Collector struct {
	c            *Classifier
	defectCounts map[defectKey]int
	findings     []*Finding
}

// NewCollector makes an empty Collector that classifies with c.
func (c *Classifier) NewCollector() *Collector {
	return &Collector{c: c, defectCounts: make(map[defectKey]int)}
}

// Findings returns the findings of the results added so far.
func (col *Collector) Findings() []*Finding { return col.findings }

// Add classifies one result. The collector does not keep the result itself. A defect that already
// has its findings is skipped before any work, so a scan that repeats one defect stays cheap.
func (col *Collector) Add(r *swagger.FuzzResult) {
	c := col.c
	// 1. Standard status-code finding
	if !col.full(RuleIDForResult(r), r.Method, r.Endpoint) {
		if sf := c.Classify(r); sf != nil && !IsIgnored(sf, c.ignoreRules) {
			col.keep(sf)
		}
	}

	// 2. Response body analyzer findings
	for _, af := range r.AnalyzerFindings {
		if col.full(af.RuleID, r.Method, r.Endpoint) {
			continue
		}
		source := "response_body"
		switch {
		case strings.HasPrefix(af.RuleID, "swazz/crlf-") || strings.HasPrefix(af.RuleID, "swazz/header-") || af.RuleID == "swazz/crlf-injection":
			source = "response_headers"
		case af.RuleID == "swazz/no-rate-limit" || af.RuleID == "swazz/rate-limit-active":
			source = "rate_limiting"
		case af.RuleID == "swazz/bola-idor" || af.RuleID == "swazz/unauthorized-access":
			source = "access_control"
		}
		afOWASP, afOWASPAPI, afCWE := ResolveTaxonomy(&af, r.Method, r.Endpoint)
		f := &Finding{
			ID:               r.ID,
			RuleID:           af.RuleID,
			Level:            Severity(af.Level),
			Endpoint:         r.Endpoint,
			ResolvedPath:     r.ResolvedPath,
			Method:           r.Method,
			Profile:          r.Profile,
			Status:           r.Status,
			Duration:         r.Duration,
			Payload:          r.Payload,
			ResponseBody:     r.ResponseBody,
			Error:            af.Evidence, // Store evidence matched fragment here
			Timestamp:        r.Timestamp,
			Source:           source,
			OWASPCategory:    afOWASP,
			OWASPAPICategory: afOWASPAPI,
			CWEIDs:           afCWE,
		}

		if IsIgnored(f, c.ignoreRules) {
			continue
		}
		col.keep(f)
	}
}

// full reports whether a rule on an endpoint already has maxFindingsPerDefect findings.
func (col *Collector) full(rule, method, endpoint string) bool {
	return col.defectCounts[defectKey{rule, method, endpoint}] >= maxFindingsPerDefect
}

// keep adds f, which must not be full, cutting a huge response body.
func (col *Collector) keep(f *Finding) {
	if body, ok := f.ResponseBody.(string); ok && len(body) > maxFindingBodyBytes {
		f.ResponseBody = body[:maxFindingBodyBytes] + "\n... [TRUNCATED BY SWAZZ]"
	}
	col.findings = append(col.findings, f)
	col.defectCounts[defectKey{f.RuleID, f.Method, f.Endpoint}]++
}
