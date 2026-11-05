// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package classifier

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"swazz-engine/internal/swagger"
)

func collectorResults() []*swagger.FuzzResult {
	var rs []*swagger.FuzzResult
	for i := range 12 {
		rs = append(rs, &swagger.FuzzResult{
			ID: fmt.Sprintf("r%d", i), Method: "POST", Endpoint: "/a", Status: 500,
			ResponseBody: "boom",
			AnalyzerFindings: []swagger.AnalysisFinding{
				{RuleID: "swazz/sql-error-leak", Level: "error", Evidence: "syntax error"},
			},
		})
		rs = append(rs, &swagger.FuzzResult{ID: fmt.Sprintf("ok%d", i), Method: "GET", Endpoint: "/b", Status: 200})
	}
	rs = append(rs, &swagger.FuzzResult{ID: "big", Method: "PUT", Endpoint: "/c", Status: 502,
		ResponseBody: strings.Repeat("x", maxFindingBodyBytes+10)})
	return rs
}

// ClassifyAll keeps the same findings as adding the results one by one.
func TestClassifyAll_UsesCollector(t *testing.T) {
	col := New(nil).NewCollector()
	for _, r := range collectorResults() {
		col.Add(r)
	}
	if got, want := len(New(nil).ClassifyAll(collectorResults())), len(col.Findings()); got != want {
		t.Fatalf("ClassifyAll gave %d findings, the collector %d", got, want)
	}
}

// Ignored findings do not use up a defect's slots.
func TestCollector_IgnoredDoNotCount(t *testing.T) {
	cls := New(&RulesConfig{IgnoreRules: []IgnoreRule{{RuleID: "swazz/status-500", Endpoint: "/a", Payload: "skip"}}})
	col := cls.NewCollector()
	for i := range 8 {
		col.Add(&swagger.FuzzResult{ID: fmt.Sprintf("s%d", i), Method: "POST", Endpoint: "/a", Status: 500, Payload: "skip"})
	}
	for i := range 3 {
		col.Add(&swagger.FuzzResult{ID: fmt.Sprintf("k%d", i), Method: "POST", Endpoint: "/a", Status: 500, Payload: "keep"})
	}
	if n := len(col.Findings()); n != 3 {
		t.Fatalf("%d findings, want 3", n)
	}
}

// One rule on one endpoint keeps at most maxFindingsPerDefect findings, the first ones added,
// and a huge body is cut.
func TestCollector_BoundsFindingsPerDefect(t *testing.T) {
	col := New(nil).NewCollector()
	for _, r := range collectorResults() {
		col.Add(r)
	}
	counts := map[string]int{}
	for _, f := range col.Findings() {
		counts[f.RuleID+" "+f.Endpoint]++
		if f.RuleID == "swazz/status-502" {
			body, _ := f.ResponseBody.(string)
			if !strings.HasSuffix(body, "[TRUNCATED BY SWAZZ]") || len(body) > maxFindingBodyBytes+64 {
				t.Errorf("body of %d bytes was not truncated", len(body))
			}
		}
	}
	for _, k := range []string{"swazz/status-500 /a", "swazz/sql-error-leak /a"} {
		if counts[k] != maxFindingsPerDefect {
			t.Errorf("%s: %d findings, want %d", k, counts[k], maxFindingsPerDefect)
		}
	}
	var kept []string
	for _, f := range col.Findings() {
		if f.RuleID == "swazz/status-500" {
			kept = append(kept, f.ID)
		}
	}
	if want := []string{"r0", "r1", "r2", "r3", "r4"}; !reflect.DeepEqual(kept, want) {
		t.Errorf("kept %v, want the first ones %v", kept, want)
	}
}
