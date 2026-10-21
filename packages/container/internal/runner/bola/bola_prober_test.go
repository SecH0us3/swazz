// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package bola

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/swagger"
)

// Harvested IDs are expanded by one candidate per endpoint: a run has a candidate for every 2xx
// result, and expanding each of them multiplied the phase's requests by the number of IDs. The
// pick skips candidates that are not replayed (no auth) or whose path does not line up, and
// prefers one not from the malicious profile.
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
	destructive := mk("DELETE", "/api/test/d", swagger.ProfileRandom, auth)
	noIDParam := &swagger.FuzzResult{Endpoint: "/search", ResolvedPath: "/search", Method: "GET", RequestHeaders: auth, Payload: map[string]any{"q": "x"}}
	bodyID := &swagger.FuzzResult{Endpoint: "/search", ResolvedPath: "/search", Method: "GET", RequestHeaders: auth, Payload: map[string]any{"userId": "u"}}

	picked := d.pickIDExpansionCandidates([]*swagger.FuzzResult{noAuth, misaligned, malicious, random, random2, onlyMalicious, destructive, noIDParam, bodyID})
	assert.Equal(t, map[*swagger.FuzzResult]bool{random: true, onlyMalicious: true, bodyID: true}, picked,
		"never a DELETE; a body-ID endpoint picks the candidate that has the ID field")

	d.harvestedIDs.Store("/api/test", []string{"harvest1", "harvest2"})
	withIDs, _ := d.buildPathsToTest(random, picked[random])
	assert.Len(t, withIDs, 3)
	ownOnly, paramName := d.buildPathsToTest(random2, picked[random2])
	assert.Equal(t, []replayTarget{{path: "/api/test/r2"}}, ownOnly, "only the candidate's own path")
	assert.Equal(t, "id", paramName)
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
