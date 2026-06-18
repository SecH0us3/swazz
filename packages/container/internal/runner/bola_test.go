package runner

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"swazz-engine/internal/swagger"
	"testing"
)

func TestBOLA_HeuristicIDHarvesting(t *testing.T) {
	cfg := &swagger.Config{
		Endpoints: []swagger.EndpointConfig{
			{
				Path:   "/api/goods",
				Method: "GET",
			},
		},
	}
	r := New(cfg, nil)

	// Test GET response with ids
	respBody := map[string]any{
		"goods": []any{
			map[string]any{
				"id":   "goods-101",
				"name": "Widget A",
			},
			map[string]any{
				"uuid": "uuid-999",
				"name": "Widget B",
			},
		},
	}

	r.harvestFromResponse("/api/goods", "GET", 200, respBody)

	// Verify that IDs are harvested under prefix "/api/goods"
	val, ok := r.harvestedIDs.Load("/api/goods")
	if !ok {
		t.Fatalf("Expected harvested IDs for /api/goods to exist")
	}

	ids := val.([]string)
	if len(ids) != 2 {
		t.Errorf("Expected 2 harvested IDs, got %d", len(ids))
	}

	hasGood := false
	hasUuid := false
	for _, id := range ids {
		if id == "goods-101" {
			hasGood = true
		}
		if id == "uuid-999" {
			hasUuid = true
		}
	}

	if !hasGood || !hasUuid {
		t.Errorf("Harvested IDs missing expected values: %v", ids)
	}
}

func TestBOLA_ExplicitMapping(t *testing.T) {
	cfg := &swagger.Config{
		Endpoints: []swagger.EndpointConfig{
			{
				Path:   "/api/goods",
				Method: "GET",
				ExtractVariables: map[string]string{
					"goods[0].id": "target_id",
				},
			},
		},
	}
	r := New(cfg, nil)

	respBody := map[string]any{
		"goods": []any{
			map[string]any{
				"id":   "goods-505",
				"name": "Widget",
			},
		},
	}

	r.harvestFromResponse("/api/goods", "GET", 200, respBody)

	// Verify target_id variable is extracted
	val := r.config.Variables["target_id"]
	if val != "goods-505" {
		t.Errorf("Expected extracted target_id to be 'goods-505', got '%v'", val)
	}
}

func TestBOLA_BOLAIDORCheck(t *testing.T) {
	// Setup mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		auth := req.Header.Get("Authorization")
		cookie, _ := req.Cookie("session")

		// Endpoints behavior
		if req.URL.Path == "/api/goods/goods-101" {
			// This endpoint is vulnerable: accepts User B's token "user2-token" but rejects Anonymous
			if auth == "Bearer user2-token" || (cookie != nil && cookie.Value == "user2-session") {
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{"id": "goods-101", "secret": "user1-private-data"}`))
				return
			}
			if auth == "" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if req.URL.Path == "/api/login-b" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{"token": "Bearer user2-token"})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	cfg := &swagger.Config{
		BaseURL: server.URL,
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
		Settings: swagger.Settings{
			BOLATesting:         true,
			AnalyzeResponseBody: true,
		},
		AuthIdentities: map[string]swagger.AuthIdentity{
			"userB": {
				AuthSequence: []swagger.AuthStep{
					{
						Method: "POST",
						URL:    "/api/login-b",
						ExtractJSON: map[string]string{
							"token": "Authorization",
						},
					},
				},
				Headers: map[string]string{
					"Authorization": "Bearer placeholder",
				},
			},
		},
		Endpoints: []swagger.EndpointConfig{
			{
				Path:   "/api/goods/{id}",
				Method: "GET",
			},
		},
	}

	r := New(cfg, nil)

	// Simulate successful result for User A (Authorization is missing in this test structure, but we pretend it was successful)
	results := []*swagger.FuzzResult{
		{
			ID:           "test-id",
			Endpoint:     "/api/goods/{id}",
			ResolvedPath: "/api/goods/goods-101",
			Method:       "GET",
			Status:       200,
			Payload:      nil,
			ResponseBody: `{"id": "goods-101", "secret": "user1-private-data"}`,
		},
	}

	bolaResults := r.bolaPhase(context.Background(), results)

	if len(bolaResults) != 1 {
		t.Fatalf("Expected 1 BOLA vulnerability finding, got %d", len(bolaResults))
	}

	res := bolaResults[0]
	if len(res.AnalyzerFindings) != 1 {
		t.Fatalf("Expected 1 analyzer finding, got %d", len(res.AnalyzerFindings))
	}

	finding := res.AnalyzerFindings[0]
	if finding.RuleID != "swazz/bola-idor" {
		t.Errorf("Expected rule ID 'swazz/bola-idor', got '%s'", finding.RuleID)
	}

	if finding.Level != "error" {
		t.Errorf("Expected finding level 'error', got '%s'", finding.Level)
	}

	if !strings.Contains(finding.Evidence, "Identity: User B") {
		t.Errorf("Expected evidence to contain identity User B, got '%s'", finding.Evidence)
	}
}

func TestBOLA_AnonymousAccessCheck(t *testing.T) {
	// Setup mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		auth := req.Header.Get("Authorization")

		if req.URL.Path == "/api/public-goods/goods-999" {
			// Vulnerable to unauthenticated access
			if auth == "" {
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{"id": "goods-999", "public": "visible-to-everyone-even-anonymous"}`))
				return
			}
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	cfg := &swagger.Config{
		BaseURL: server.URL,
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
		Settings: swagger.Settings{
			BOLATesting:         true,
			AuthHeaders:         []string{"Authorization"},
			AnalyzeResponseBody: true,
		},
		GlobalHeaders: map[string]string{
			"Authorization": "Bearer user1-token",
		},
		Endpoints: []swagger.EndpointConfig{
			{
				Path:   "/api/public-goods/{id}",
				Method: "GET",
			},
		},
	}

	r := New(cfg, nil)

	results := []*swagger.FuzzResult{
		{
			ID:           "test-id-anon",
			Endpoint:     "/api/public-goods/{id}",
			ResolvedPath: "/api/public-goods/goods-999",
			Method:       "GET",
			Status:       200,
			Payload:      nil,
			ResponseBody: `{"id": "goods-999", "public": "visible-to-everyone-even-anonymous"}`,
		},
	}

	bolaResults := r.bolaPhase(context.Background(), results)

	if len(bolaResults) != 1 {
		t.Fatalf("Expected 1 anonymous vulnerability finding, got %d", len(bolaResults))
	}

	res := bolaResults[0]
	if len(res.AnalyzerFindings) != 1 {
		t.Fatalf("Expected 1 analyzer finding, got %d", len(res.AnalyzerFindings))
	}

	finding := res.AnalyzerFindings[0]
	if finding.RuleID != "swazz/unauthorized-access" {
		t.Errorf("Expected rule ID 'swazz/unauthorized-access', got '%s'", finding.RuleID)
	}
}

func TestBOLA_SimilarityFiltering(t *testing.T) {
	// 1. Test case: Low similarity (should NOT be flagged)
	t.Run("Low similarity response should be filtered out", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			// Return completely different structure (e.g. error page or login redirect)
			w.Write([]byte(`{"error": "Unauthorized Access", "code": 401, "success": false}`))
		}))
		defer server.Close()

		cfg := &swagger.Config{
			BaseURL: server.URL,
			Security: swagger.SecurityConfig{
				AllowPrivateIPs: true,
			},
			Settings: swagger.Settings{
				BOLATesting:             true,
				AnalyzeResponseBody:     true,
				BOLASimilarityThreshold: 0.85,
			},
			Endpoints: []swagger.EndpointConfig{
				{
					Path:   "/api/items/{id}",
					Method: "GET",
				},
			},
		}

		r := New(cfg, nil)

		// Candidate with baseline body
		results := []*swagger.FuzzResult{
			{
				ID:           "test-id",
				Endpoint:     "/api/items/{id}",
				ResolvedPath: "/api/items/item-123",
				Method:       "GET",
				Status:       200,
				ResponseBody: map[string]any{
					"id":          "item-123",
					"name":        "Golden Ring",
					"description": "A very expensive item",
					"owner":       "User A",
				},
			},
		}

		bolaResults := r.bolaPhase(context.Background(), results)

		// Anonymous check runs, replayed GET returns the unauthorized JSON.
		// Since it has low similarity to candidate, it should NOT be flagged.
		if len(bolaResults) != 0 {
			t.Fatalf("Expected 0 BOLA findings due to low similarity, got %d: %+v", len(bolaResults), bolaResults[0])
		}
	})

	// 2. Test case: High similarity (should BE flagged)
	t.Run("High similarity response should be flagged", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			// Return structurally identical JSON, just different values (BOLA!)
			w.Write([]byte(`{"id": "item-123", "name": "Golden Ring", "description": "A very expensive item", "owner": "User B"}`))
		}))
		defer server.Close()

		cfg := &swagger.Config{
			BaseURL: server.URL,
			Security: swagger.SecurityConfig{
				AllowPrivateIPs: true,
			},
			Settings: swagger.Settings{
				BOLATesting:             true,
				AnalyzeResponseBody:     true,
				BOLASimilarityThreshold: 0.85,
			},
			Endpoints: []swagger.EndpointConfig{
				{
					Path:   "/api/items/{id}",
					Method: "GET",
				},
			},
		}

		r := New(cfg, nil)

		results := []*swagger.FuzzResult{
			{
				ID:           "test-id",
				Endpoint:     "/api/items/{id}",
				ResolvedPath: "/api/items/item-123",
				Method:       "GET",
				Status:       200,
				ResponseBody: map[string]any{
					"id":          "item-123",
					"name":        "Golden Ring",
					"description": "A very expensive item",
					"owner":       "User A",
				},
			},
		}

		bolaResults := r.bolaPhase(context.Background(), results)

		// Anonymous check runs, replayed GET returns high-similarity JSON.
		// It should be flagged.
		if len(bolaResults) != 1 {
			t.Fatalf("Expected 1 BOLA finding due to high similarity, got %d", len(bolaResults))
		}
	})
}

func Test_arePrefixesRelated(t *testing.T) {
	tests := []struct {
		name string
		p1   string
		p2   string
		want bool
	}{
		{
			name: "related paths, 3 segments",
			p1:   "/api/v1/users",
			p2:   "/api/v1/posts",
			want: true,
		},
		{
			name: "unrelated paths, different version",
			p1:   "/api/v1/users",
			p2:   "/api/v2/users",
			want: false,
		},
		{
			name: "single segment match",
			p1:   "/api",
			p2:   "/api/v1",
			want: true,
		},
		{
			name: "empty first path",
			p1:   "",
			p2:   "/api",
			want: false,
		},
		{
			name: "both empty",
			p1:   "",
			p2:   "",
			want: false,
		},
		{
			name: "different root segment",
			p1:   "/v1/users",
			p2:   "/api/v1/users",
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := arePrefixesRelated(tt.p1, tt.p2)
			if got != tt.want {
				t.Errorf("arePrefixesRelated(%q, %q) = %v, want %v", tt.p1, tt.p2, got, tt.want)
			}
		})
	}
}

func TestIdentifyCandidates(t *testing.T) {
	r := &Runner{}
	results := []*swagger.FuzzResult{
		{Status: 200, Method: "GET", Endpoint: "/api/test", ResolvedPath: "/api/test"},
		{Status: 404, Method: "POST", Endpoint: "/api/test", ResolvedPath: "/api/test"},
		{Status: 204, Method: "DELETE", Endpoint: "/api/test/{id}", ResolvedPath: "/api/test/1"},
	}

	candidates, hasSuccess := r.identifyCandidates(results)

	if len(candidates) != 2 {
		t.Fatalf("Expected 2 candidates, got %d", len(candidates))
	}

	if !hasSuccess["GET /api/test"] {
		t.Errorf("Expected hasSuccess to contain GET /api/test")
	}
	if !hasSuccess["DELETE /api/test/{id}"] {
		t.Errorf("Expected hasSuccess to contain DELETE /api/test/{id}")
	}
	if hasSuccess["POST /api/test"] {
		t.Errorf("Expected hasSuccess to NOT contain POST /api/test")
	}
}

func TestBuildPathsToTest(t *testing.T) {
	r := &Runner{}
	// Mock harvested IDs
	r.harvestedIDs.Store("/api/test", []string{"harvest1", "harvest2"})

	cand := &swagger.FuzzResult{
		Endpoint:     "/api/test/{id}",
		ResolvedPath: "/api/test/originalID",
		Method:       "GET",
	}

	targets, paramName := r.buildPathsToTest(cand)

	if paramName != "id" {
		t.Errorf("Expected paramName 'id', got '%s'", paramName)
	}

	if len(targets) != 3 { // original + 2 harvested
		t.Fatalf("Expected 3 targets, got %d", len(targets))
	}

	expectedTargets := map[string]string{
		"/api/test/originalID": "",
		"/api/test/harvest1":   "harvest1",
		"/api/test/harvest2":   "harvest2",
	}

	for _, target := range targets {
		expID, exists := expectedTargets[target.path]
		if !exists {
			t.Errorf("Unexpected path in targets: %s", target.path)
		} else if target.id != expID {
			t.Errorf("Expected ID %q for path %s, got %q", expID, target.path, target.id)
		}
	}
}

// TestBOLA_SkipNoResourceIdentifier verifies that replayCandidate skips
// endpoints that have no resource identifier (path param or body ID field)
// to substitute between identities, which would make BOLA testing meaningless.
func TestBOLA_SkipNoResourceIdentifier(t *testing.T) {
	t.Run("endpoint with path param is not skipped", func(t *testing.T) {
		// A candidate with a path parameter like {id} should proceed to BOLA replay.
		// buildPathsToTest returns a non-empty paramName for /api/goods/{id}.
		r := &Runner{}
		cand := &swagger.FuzzResult{
			Endpoint:     "/api/goods/{id}",
			ResolvedPath: "/api/goods/123",
			Method:       "GET",
		}
		_, paramName := r.buildPathsToTest(cand)
		if paramName == "" {
			t.Errorf("Expected non-empty paramName for endpoint with path param, got empty")
		}
	})

	t.Run("health endpoint with no params is skipped", func(t *testing.T) {
		// A candidate with no path params and empty payload should be skipped.
		// buildPathsToTest returns empty paramName for /api/health.
		r := &Runner{}
		cand := &swagger.FuzzResult{
			Endpoint:     "/api/health",
			ResolvedPath: "/api/health",
			Method:       "GET",
			Payload:      nil,
		}
		_, paramName := r.buildPathsToTest(cand)
		if paramName != "" {
			t.Errorf("Expected empty paramName for health endpoint, got %q", paramName)
		}
	})

	t.Run("no path params but body has id field is not skipped", func(t *testing.T) {
		// A candidate with no path params but an ID field in the body payload
		// should still proceed — the body field is the substituable identifier.
		r := &Runner{}
		cand := &swagger.FuzzResult{
			Endpoint:     "/api/orders",
			ResolvedPath: "/api/orders",
			Method:       "POST",
			Payload: map[string]any{
				"id":    "order-42",
				"total": 99.99,
			},
		}
		_, paramName := r.buildPathsToTest(cand)
		if paramName == "" {
			t.Errorf("Expected non-empty paramName for payload with id field, got empty")
		}
	})

	t.Run("no path params and payload has no id field is skipped", func(t *testing.T) {
		// A candidate with no path params and a payload without any ID-like field
		// should be skipped — there is nothing to substitute between identities.
		r := &Runner{}
		cand := &swagger.FuzzResult{
			Endpoint:     "/api/ping",
			ResolvedPath: "/api/ping",
			Method:       "POST",
			Payload: map[string]any{
				"name": "foo",
			},
		}
		_, paramName := r.buildPathsToTest(cand)
		if paramName != "" {
			t.Errorf("Expected empty paramName for payload with no id field, got %q", paramName)
		}
	})
}
