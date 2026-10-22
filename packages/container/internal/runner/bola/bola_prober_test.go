// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package bola

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/swagger"
)

// Harvested IDs are expanded by one candidate per endpoint: a run has a candidate for every 2xx
// result, and expanding each of them multiplied the phase's requests by the number of IDs. The
// pick skips candidates that are not replayed (no auth) or whose path does not line up, and
// prefers one not from the malicious profile. All HTTP verbs (GET, POST, PUT, PATCH, DELETE) expand
// harvested IDs.
func TestPickIDExpansionCandidates(t *testing.T) {
	d := NewDetector(NewMock(&swagger.Config{}, nil))
	auth := map[string]string{"Authorization": "Bearer a"}
	mk := func(method, resolved string, profile swagger.FuzzingProfile, headers map[string]string) *swagger.FuzzResult {
		return &swagger.FuzzResult{Endpoint: "/api/test/{id}", ResolvedPath: resolved, Method: method, Profile: profile, RequestHeaders: headers}
	}
	noAuth := mk("GET", "/api/test/a", swagger.ProfileRandom, nil)
	misaligned := mk("GET", "/api/test/", swagger.ProfileRandom, auth)
	malicious := mk("GET", "/api/test/m", swagger.ProfileMalicious, auth)
	random := mk("GET", "/api/test/r", swagger.ProfileRandom, auth)
	random2 := mk("GET", "/api/test/r2", swagger.ProfileRandom, auth)
	onlyMalicious := mk("HEAD", "/api/test/x", swagger.ProfileMalicious, auth)
	putCand := mk("PUT", "/api/test/p", swagger.ProfileRandom, auth)
	deleteCand := mk("DELETE", "/api/test/d", swagger.ProfileRandom, auth)
	noIDParam := &swagger.FuzzResult{Endpoint: "/search", ResolvedPath: "/search", Method: "POST", RequestHeaders: auth, Payload: map[string]any{"q": "x"}}
	bodyID := &swagger.FuzzResult{Endpoint: "/search", ResolvedPath: "/search", Method: "POST", RequestHeaders: auth, Payload: map[string]any{"userId": "u"}}

	picked := d.pickIDExpansionCandidates([]*swagger.FuzzResult{noAuth, misaligned, malicious, random, random2, onlyMalicious, putCand, deleteCand, noIDParam, bodyID})
	assert.Equal(t, map[*swagger.FuzzResult]bool{
		random:        true,
		onlyMalicious: true,
		putCand:       true,
		deleteCand:    true,
		bodyID:        true,
	}, picked, "expands one candidate per method+endpoint across GET, HEAD, PUT, DELETE, and POST with body ID")

	d.harvestedIDs.Store("/api/test", []string{"harvest1", "harvest2"})
	withIDs, _ := d.buildPathsToTest(random, picked[random])
	assert.Len(t, withIDs, 3)
	ownOnly, paramName := d.buildPathsToTest(random2, picked[random2])
	assert.Equal(t, []replayTarget{{path: "/api/test/r2"}}, ownOnly, "only the candidate's own path")
	assert.Equal(t, "id", paramName)
}

// DELETE candidates are replayed in a final batch after all non-DELETE candidates complete, so a
// vulnerable DELETE under User B does not remove User A's object before GET/PUT/PATCH probes test it.
func TestReplayCandidates_DeleteRunsLastAndDetectsBOLA(t *testing.T) {
	var mu sync.Mutex
	var order []string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		order = append(order, r.Method+" "+r.URL.Path)
		mu.Unlock()
		if r.URL.Path == "/items/real-1" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":"real-1","status":"ok"}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"not found"}`))
	}))
	defer ts.Close()

	cfg := &swagger.Config{
		BaseURL:  ts.URL,
		Settings: swagger.DefaultSettings(),
		Endpoints: []swagger.EndpointConfig{
			{Path: "/items/{id}", Method: "DELETE"},
			{Path: "/items/{id}", Method: "GET"},
			{Path: "/items/{id}", Method: "PUT"},
		},
	}
	d := NewDetector(NewMock(cfg, ts.Client()))
	d.harvestedIDs.Store("/items", []string{"real-1"})

	authA := map[string]string{"Authorization": "Bearer userA"}
	candidates := []*swagger.FuzzResult{
		// Place DELETE first in the slice to verify replayCandidates moves it to the last batch.
		// Its User A baseline status is 404 (generated with placeholder UUID so User A did not delete real-1).
		{
			Endpoint:       "/items/{id}",
			ResolvedPath:   "/items/00000000-0000-4000-8000-000000000000",
			Method:         "DELETE",
			Profile:        swagger.FuzzingProfile("BOLA"),
			Status:         404,
			ResponseBody:   `{"error":"not found"}`,
			RequestHeaders: authA,
		},
		{
			Endpoint:       "/items/{id}",
			ResolvedPath:   "/items/real-1",
			Method:         "GET",
			Profile:        swagger.ProfileRandom,
			Status:         200,
			ResponseBody:   `{"id":"real-1","status":"ok"}`,
			RequestHeaders: authA,
		},
		{
			Endpoint:       "/items/{id}",
			ResolvedPath:   "/items/real-1",
			Method:         "PUT",
			Profile:        swagger.ProfileRandom,
			Status:         200,
			ResponseBody:   `{"id":"real-1","status":"ok"}`,
			RequestHeaders: authA,
		},
	}

	idHeaders := map[string]map[string]string{"userB": {"Authorization": "Bearer userB"}}
	results := d.replayCandidates(context.Background(), candidates, idHeaders, nil)

	mu.Lock()
	defer mu.Unlock()
	require.NotEmpty(t, order)

	// Every GET and PUT request must happen before the first DELETE request.
	firstDeleteIdx := -1
	lastNonDeleteIdx := -1
	for i, req := range order {
		if len(req) >= 6 && req[:6] == "DELETE" {
			if firstDeleteIdx == -1 {
				firstDeleteIdx = i
			}
		} else {
			lastNonDeleteIdx = i
		}
	}
	require.NotEqual(t, -1, firstDeleteIdx, "DELETE should have been probed")
	require.NotEqual(t, -1, lastNonDeleteIdx, "GET/PUT should have been probed")
	assert.Greater(t, firstDeleteIdx, lastNonDeleteIdx, "all non-DELETE probes must finish before DELETE probes start: %v", order)

	// Verify BOLA findings were recorded for GET, PUT, and DELETE (even though DELETE had a 404 baseline).
	methodsFound := make(map[string]bool)
	for _, r := range results {
		methodsFound[r.Method] = true
	}
	assert.True(t, methodsFound["GET"], "expected BOLA finding for GET")
	assert.True(t, methodsFound["PUT"], "expected BOLA finding for PUT")
	assert.True(t, methodsFound["DELETE"], "expected BOLA finding for DELETE with harvested ID")
}

// A candidate that already carries a harvested ID (a generated one) is not probed twice with it.
func TestBuildPathsToTest_SkipsOwnID(t *testing.T) {
	d := &Detector{}
	d.harvestedIDs.Store("/api/test", []string{"harvest1", "harvest2"})
	targets, _ := d.buildPathsToTest(&swagger.FuzzResult{Endpoint: "/api/test/{id}", ResolvedPath: "/api/test/harvest1", Method: "GET"}, true)
	assert.Equal(t, []replayTarget{{path: "/api/test/harvest1"}, {path: "/api/test/harvest2", id: "harvest2"}}, targets)

	// The same for an ID carried in the payload rather than the path.
	targets, _ = d.buildPathsToTest(&swagger.FuzzResult{Endpoint: "/search", ResolvedPath: "/search", Method: "GET",
		Payload: map[string]any{"userId": "harvest1"}}, true)
	assert.Equal(t, []replayTarget{{path: "/search"}, {path: "/search", id: "harvest2"}}, targets)
}

// A harvested ID is chosen by the target, so it is escaped into one path segment: it can never
// move the request up the path or add a query or fragment.
func TestBuildPathsToTest_EscapesHarvestedID(t *testing.T) {
	d := &Detector{}
	d.harvestedIDs.Store("/api/test", []string{"../admin?x=1#"})
	targets, _ := d.buildPathsToTest(&swagger.FuzzResult{Endpoint: "/api/test/{id}", ResolvedPath: "/api/test/a", Method: "GET"}, true)
	require.Len(t, targets, 2)
	assert.Equal(t, "/api/test/..%2Fadmin%3Fx=1%23", targets[1].path)
}
