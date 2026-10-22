// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"

	"swazz-engine/internal/swagger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func okResult(method, endpoint string, profile swagger.FuzzingProfile, rules ...string) *swagger.FuzzResult {
	res := &swagger.FuzzResult{
		Method: method, Endpoint: endpoint, Profile: profile, Status: 200,
		Payload: map[string]string{"q": "x"}, ResponseBody: "body",
		ResponseHeaders: http.Header{"X-A": {"1"}}, RequestHeaders: map[string]string{"X-B": "2"},
	}
	for _, rule := range rules {
		res.AnalyzerFindings = append(res.AnalyzerFindings, swagger.AnalysisFinding{RuleID: rule, Evidence: "ev"})
	}
	return res
}

func TestRetainResult_CapsPlainResultsPerEndpointAndProfile(t *testing.T) {
	r := &Runner{}
	for range maxRetainedPerEndpoint + 10 {
		r.retainResult(okResult("GET", "/a", swagger.ProfileRandom))
		r.retainResult(okResult("GET", "/a", swagger.ProfileBoundary))
		r.retainResult(okResult("POST", "/a", swagger.ProfileRandom))
	}
	count := map[string]int{}
	for _, res := range r.Results() {
		count[fmt.Sprintf("%s %s %s", res.Method, res.Endpoint, res.Profile)]++
	}
	assert.Equal(t, map[string]int{
		"GET /a " + string(swagger.ProfileRandom):   maxRetainedPerEndpoint,
		"GET /a " + string(swagger.ProfileBoundary): maxRetainedPerEndpoint, // later profiles get their share
		"POST /a " + string(swagger.ProfileRandom):  maxRetainedPerEndpoint,
	}, count)
	assert.Equal(t, 30, r.retained.notRetained)
}

func TestRetainResult_CapsThePlainTotal(t *testing.T) {
	r := &Runner{}
	const endpoints = maxRetainedResults / maxRetainedPerEndpoint
	for i := range endpoints {
		for range maxRetainedPerEndpoint {
			r.retainResult(okResult("GET", fmt.Sprintf("/e/%d", i), swagger.ProfileRandom))
		}
	}
	require.Len(t, r.Results(), maxRetainedResults)

	// Past the total, an endpoint already at the cap gets nothing more, and one fuzzed late
	// still gets its first few, so the replay phases have candidates for it.
	for range 10 {
		r.retainResult(okResult("GET", "/e/0", swagger.ProfileRandom))
		r.retainResult(okResult("GET", "/late", swagger.ProfileRandom))
	}
	late := 0
	for _, res := range r.Results() {
		if res.Endpoint == "/late" {
			late++
		}
	}
	assert.Equal(t, minRetainedPerEndpoint, late)
	assert.Len(t, r.Results(), maxRetainedResults+minRetainedPerEndpoint)
	assert.Equal(t, 20-minRetainedPerEndpoint, r.retained.notRetained)

	// Plain results filling the cap do not crowd out findings.
	r.retainResult(okResult("GET", "/e/0", swagger.ProfileRandom, "swazz/stack-trace-leak"))
	assert.Len(t, r.Results(), maxRetainedResults+minRetainedPerEndpoint+1)
}

// Every finding is kept, so triage sees all of a defect's findings; past maxFullPerDefect of one
// defect, only without the large parts.
func TestRetainResult_KeepsEveryFindingSlimPastTheDefectCap(t *testing.T) {
	r := &Runner{}
	const n = maxFullPerDefect + 15
	for range n {
		r.retainResult(okResult("GET", "/a", swagger.ProfileRandom, "swazz/stack-trace-leak"))
	}
	// Another rule on the same endpoint is a separate defect with its own whole results.
	r.retainResult(okResult("GET", "/a", swagger.ProfileRandom, "swazz/sql-error-leak"))
	// A result that is still new for one of its defects is kept whole.
	r.retainResult(okResult("GET", "/a", swagger.ProfileRandom, "swazz/stack-trace-leak", "swazz/cors-misconfig"))

	results := r.Results()
	require.Len(t, results, n+2)
	assert.Zero(t, r.retained.notRetained)
	whole, slim := 0, 0
	for _, res := range results[:n] {
		require.Len(t, res.AnalyzerFindings, 1)
		assert.Equal(t, "ev", res.AnalyzerFindings[0].Evidence)
		if res.Slim {
			assert.Nil(t, res.ResponseBody)
			assert.Nil(t, res.Payload)
			assert.Nil(t, res.ResponseHeaders)
			assert.Nil(t, res.RequestHeaders)
			slim++
		} else {
			whole++
		}
	}
	assert.Equal(t, maxFullPerDefect, whole)
	assert.Equal(t, 15, slim)
	assert.False(t, results[n].Slim)
	assert.False(t, results[n+1].Slim)

	// The replay phases only get results that still carry their request and response.
	candidates := replayCandidates(results)
	assert.Len(t, candidates, maxFullPerDefect+2)
	for _, res := range candidates {
		assert.False(t, res.Slim)
	}
}

// A rule reported twice in one result takes one of the defect's whole slots, not two.
func TestRetainResult_CountsADefectOncePerResult(t *testing.T) {
	r := &Runner{}
	for range maxFullPerDefect {
		r.retainResult(okResult("GET", "/a", swagger.ProfileRandom, "swazz/stack-trace-leak", "swazz/stack-trace-leak"))
	}
	for _, res := range r.Results() {
		assert.False(t, res.Slim)
	}
}

func TestRetainResult_SlimLeavesTheStreamedResultIntact(t *testing.T) {
	orig := okResult("GET", "/a", swagger.ProfileRandom, "swazz/stack-trace-leak")
	slim := slimResult(orig)
	assert.Nil(t, slim.ResponseBody)
	assert.True(t, slim.Slim)
	assert.False(t, orig.Slim)
	assert.Equal(t, "body", orig.ResponseBody)
	assert.NotNil(t, orig.Payload)
}

// Past maxSlimFindings slim results are dropped, but a defect's first results are still kept whole.
func TestRetainResult_CapsTheSlimTotal(t *testing.T) {
	r := &Runner{retained: retainedResults{slim: maxSlimFindings - 2}}
	for range maxFullPerDefect + 5 {
		r.retainResult(okResult("GET", "/a", swagger.ProfileRandom, "swazz/stack-trace-leak"))
	}
	r.retainResult(okResult("GET", "/b", swagger.ProfileRandom, "swazz/stack-trace-leak"))
	results := r.Results()
	assert.Len(t, results, maxFullPerDefect+2+1)
	assert.Equal(t, 3, r.retained.notRetained)
	assert.False(t, results[len(results)-1].Slim, "a new defect is kept whole")
}

// A run keeps no more than the cap for its post-scan phases, but streams every result.
func TestStart_RetainsBoundedResults(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"success":true}`))
	}))
	defer server.Close()

	const iterations = maxRetainedPerEndpoint + 30
	r := New(&swagger.Config{
		BaseURL:  server.URL,
		Security: swagger.SecurityConfig{AllowPrivateIPs: true},
		Endpoints: []swagger.EndpointConfig{{Path: "/api/items", Method: "POST", Schema: swagger.SchemaProperty{
			Type: "object",
			Properties: map[string]*swagger.SchemaProperty{
				"name": {Type: "string"}, "count": {Type: "integer"}, "note": {Type: "string"},
			},
		}}},
		Settings: swagger.Settings{
			IterationsPerProfile: iterations,
			Concurrency:          4,
			Profiles:             []swagger.FuzzingProfile{swagger.ProfileRandom},
		},
	}, nil)
	defer r.Close()

	require.NoError(t, r.Start(context.Background()))
	stats := r.GetStats()
	require.Greater(t, stats.TotalRequests, int64(maxRetainedPerEndpoint), "the run made more successful requests than the cap")
	assert.Len(t, r.Results(), maxRetainedPerEndpoint)
	assert.Positive(t, r.retained.notRetained)
}

// Whole results with findings have a total cap too: past maxFullResults even a new defect is kept
// slim, so a scan with findings on every endpoint stays bounded.
func TestRetainResult_CapsTheWholeTotal(t *testing.T) {
	r := &Runner{}
	for i := range maxFullResults + 10 {
		r.retainResult(okResult("GET", fmt.Sprintf("/e/%d", i), swagger.ProfileRandom, "swazz/stack-trace-leak"))
	}
	results := r.Results()
	require.Len(t, results, maxFullResults+10)
	assert.Len(t, r.WholeResults(), maxFullResults)
	for _, res := range results[maxFullResults:] {
		assert.True(t, res.Slim)
	}
	assert.Zero(t, r.retained.notRetained)
}

// A slim result keeps its findings but cuts the texts that can carry the payload or a large
// response fragment; the streamed result and its findings are left untouched.
func TestSlimResult_CutsLargeTexts(t *testing.T) {
	long := strings.Repeat("я", maxSlimTextBytes)
	orig := okResult("GET", "/a", swagger.ProfileRandom, "swazz/stack-trace-leak")
	orig.RequestURI, orig.Error = "/a?q="+long, long
	orig.AnalyzerFindings[0].Evidence, orig.AnalyzerFindings[0].Message = long, long

	slim := slimResult(orig)
	for _, s := range []string{slim.RequestURI, slim.Error, slim.AnalyzerFindings[0].Evidence, slim.AnalyzerFindings[0].Message} {
		assert.LessOrEqual(t, len(s), maxSlimTextBytes)
		assert.True(t, utf8.ValidString(s))
	}
	assert.Equal(t, long, orig.AnalyzerFindings[0].Evidence, "the streamed result's findings are not changed")
	assert.Equal(t, long, orig.Error)
}

// A finding without a rule id is a defect of its own: its first results are kept whole.
func TestRetainResult_EmptyRuleIsADefect(t *testing.T) {
	r := &Runner{}
	r.retainResult(okResult("GET", "/a", swagger.ProfileRandom, ""))
	require.Len(t, r.Results(), 1)
	assert.False(t, r.Results()[0].Slim)
}

// Active parameter fuzzing has its own share, so the main loop filling an endpoint's slots does
// not leave the post-scan phases without its differently shaped requests.
func TestRetainResult_ActiveFuzzingHasItsOwnShare(t *testing.T) {
	r := &Runner{}
	for range maxRetainedPerEndpoint {
		r.retainResult(okResult("POST", "/items", swagger.ProfileRandom))
	}
	r.retainActiveResult(okResult("POST", "/items", swagger.ProfileRandom))
	assert.Len(t, r.Results(), maxRetainedPerEndpoint+1)
	assert.Zero(t, r.retained.notRetained)
}

// Findings dropped past the slim cap are counted, so the completion summary can say so.
func TestRetainResult_CountsDroppedFindings(t *testing.T) {
	r := &Runner{retained: retainedResults{slim: maxSlimFindings, full: maxFullResults}}
	r.retainResult(okResult("GET", "/a", swagger.ProfileRandom, "swazz/stack-trace-leak", "swazz/cors-misconfig"))
	assert.Empty(t, r.Results())
	assert.Equal(t, 1, r.retained.notRetained)
	assert.Equal(t, 2, r.retained.droppedFindings)
}
