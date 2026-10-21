// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package triage

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"swazz-engine/internal/ai"
	"swazz-engine/internal/swagger"
)

func TestOrchestrator_GroupFindings_AndPreFilter(t *testing.T) {
	orch := NewOrchestrator(nil, 30)

	results := []*swagger.FuzzResult{
		{
			Method:   "GET",
			Endpoint: "/api/users",
			AnalyzerFindings: []swagger.AnalysisFinding{
				{RuleID: "swazz/500-error", Message: "First 500 error", Evidence: "Short evidence"},
				{RuleID: "swazz/sqli-confirmed", Message: "Confirmed SQLi"}, // should be skipped by pre-filter
			},
		},
		{
			Method:   "GET",
			Endpoint: "/api/users",
			AnalyzerFindings: []swagger.AnalysisFinding{
				{RuleID: "swazz/500-error", Message: "Second 500 error", Evidence: "Very long detailed evidence string"},
			},
		},
	}

	groups := orch.GroupFindings(results)
	if len(groups) != 1 {
		t.Fatalf("expected 1 group (sqli skipped, 500-error collapsed), got %d", len(groups))
	}

	g := groups[0]
	if g.DefectKey != "swazz/500-error::GET /api/users" {
		t.Errorf("unexpected defect key: %s", g.DefectKey)
	}
	if len(g.AffectedFindingIDs) != 2 {
		t.Errorf("expected 2 affected finding IDs, got %d", len(g.AffectedFindingIDs))
	}
	if g.Representative.Evidence != "Very long detailed evidence string" {
		t.Errorf("expected representative to be finding with longer evidence")
	}
}

// The runner keeps a defect's later findings without their response body; the representative
// must stay one the LLM can see the body of.
func TestOrchestrator_GroupFindings_PrefersResultWithBody(t *testing.T) {
	orch := NewOrchestrator(nil, 30)
	finding := func(evidence string) []swagger.AnalysisFinding {
		return []swagger.AnalysisFinding{{RuleID: "swazz/stack-trace-leak", Evidence: evidence}}
	}
	results := []*swagger.FuzzResult{
		{Method: "GET", Endpoint: "/a", ResponseBody: "first body", AnalyzerFindings: finding("short")},
		{Method: "GET", Endpoint: "/a", Slim: true, AnalyzerFindings: finding("much longer evidence, no body")},
		{Method: "GET", Endpoint: "/a", ResponseBody: "third body", AnalyzerFindings: finding("longer evidence")},
	}

	groups := orch.GroupFindings(results)
	if len(groups) != 1 {
		t.Fatalf("expected 1 group, got %d", len(groups))
	}
	if got := groups[0].Result.ResponseBody; got != "third body" {
		t.Errorf("expected the longest evidence among results with a body, got body %v", got)
	}
	if len(groups[0].AffectedFindingIDs) != 3 {
		t.Errorf("expected all 3 findings in the group, got %d", len(groups[0].AffectedFindingIDs))
	}

	// A result that never had a body (headers-only finding) is not slim: longer evidence wins.
	groups = orch.GroupFindings([]*swagger.FuzzResult{
		{Method: "GET", Endpoint: "/a", ResponseBody: "body", AnalyzerFindings: finding("short")},
		{Method: "GET", Endpoint: "/a", AnalyzerFindings: finding("longer")},
	})
	if groups[0].Representative.Evidence != "longer" {
		t.Errorf("expected the longer evidence, got %q", groups[0].Representative.Evidence)
	}
}

func TestOrchestrator_Run(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{
			"choices": [
				{
					"message": {
						"content": "{\"classification\": \"false_positive\", \"confidence\": 85, \"reasoning\": \"Benign input validation failure\"}"
					}
				}
			]
		}`))
	}))
	defer server.Close()

	client := ai.NewGatewayClient(server.URL, "", "")
	orch := NewOrchestrator(client, 10)

	results := []*swagger.FuzzResult{
		{
			Method:   "POST",
			Endpoint: "/api/login",
			AnalyzerFindings: []swagger.AnalysisFinding{
				{RuleID: "swazz/500-error", Message: "Bad login 500"},
			},
		},
	}

	triageResults := orch.Run(context.Background(), results)
	if len(triageResults) != 1 {
		t.Fatalf("expected 1 triage result, got %d", len(triageResults))
	}

	tr := triageResults[0]
	if tr.AIStatus != "completed" {
		t.Errorf("expected status 'completed', got '%s'", tr.AIStatus)
	}
	if tr.AIRelevance == nil || *tr.AIRelevance != false {
		t.Errorf("expected relevance false, got %v", tr.AIRelevance)
	}
	if tr.AIConfidence != 85 {
		t.Errorf("expected confidence 85, got %d", tr.AIConfidence)
	}
}
