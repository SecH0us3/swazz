// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"swazz-engine/internal/generator"
	"swazz-engine/internal/swagger"
)

func testLoginEndpoint() swagger.EndpointConfig {
	return swagger.EndpointConfig{
		Method:      "POST",
		Path:        "/login",
		ContentType: "application/x-www-form-urlencoded",
		Schema: swagger.SchemaProperty{
			Type: "object",
			Properties: map[string]*swagger.SchemaProperty{
				"csrf":     {Type: "string"},
				"username": {Type: "string"},
				"password": {Type: "string"},
			},
		},
		Example: map[string]any{
			"csrf":     "tok_from_example",
			"username": "wiener",
			"password": "peter",
		},
	}
}

func TestRequiredParamTracker_Tier1StructuredJSON(t *testing.T) {
	ep := testLoginEndpoint()

	cases := []struct {
		name string
		body string
		want []string
	}{
		{
			name: "FastAPI / Pydantic",
			body: `{"detail":[{"type":"missing","loc":["body","csrf"],"msg":"Field required"}]}`,
			want: []string{"csrf"},
		},
		{
			name: "Zod issues",
			body: `{"issues":[{"path":["csrf"],"message":"Required"}]}`,
			want: []string{"csrf"},
		},
		{
			name: "Django REST / Laravel map",
			body: `{"errors":{"csrf":["This field is required."],"password":["This field may not be blank."]}}`,
			want: []string{"csrf", "password"},
		},
		{
			name: "Spring Boot field errors",
			body: `{"errors":[{"field":"csrf","defaultMessage":"must not be blank"}]}`,
			want: []string{"csrf"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tracker := newRequiredParamTracker()
			learned := tracker.ObserveResponse(ep, map[string]any{"username": "1 OR 1=1"}, nil, 422, tc.body)
			assert.Equal(t, tc.want, learned)
		})
	}
}

func TestRequiredParamTracker_Tier2PlainTextAndHTML(t *testing.T) {
	ep := testLoginEndpoint()

	cases := []struct {
		name   string
		status int
		body   string
		want   []string
	}{
		{
			name:   "PortSwigger missing parameter",
			status: 400,
			body:   "Missing parameter 'csrf'",
			want:   []string{"csrf"},
		},
		{
			name:   "HTML error page",
			status: 400,
			body:   `<html><body><p class="error"><strong>username</strong> is required</p></body></html>`,
			want:   []string{"username"},
		},
		{
			name:   "Cannot be empty",
			status: 422,
			body:   `password cannot be empty`,
			want:   []string{"password"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tracker := newRequiredParamTracker()
			learned := tracker.ObserveResponse(ep, map[string]any{}, nil, tc.status, tc.body)
			assert.Equal(t, tc.want, learned)
		})
	}
}

func TestRequiredParamTracker_CrossCheckPreventsFalsePositives(t *testing.T) {
	ep := testLoginEndpoint()
	tracker := newRequiredParamTracker()

	// 1. Mentions a word that is not in schema ("session") -> must not learn anything.
	learned := tracker.ObserveResponse(ep, map[string]any{"username": "a"}, nil, 400, "Missing parameter 'session'")
	assert.Empty(t, learned)

	// 2. Mentions a field ("username") that WAS actually sent in the request -> not an omission error.
	learned = tracker.ObserveResponse(ep, map[string]any{"username": "a", "password": "b", "csrf": "c"}, nil, 400, "'username' is required")
	assert.Empty(t, learned)
}

func TestRequiredParamTracker_Tier3BehavioralConfirmation(t *testing.T) {
	ep := testLoginEndpoint()
	tracker := newRequiredParamTracker()

	// Baseline request with all fields returns 200.
	tracker.ObserveResponse(ep, map[string]any{"csrf": "tok", "username": "a", "password": "b"}, nil, 200, "OK")

	// Generic 400 with no field name when only csrf is omitted: 1st hit doesn't trigger yet.
	learned1 := tracker.ObserveResponse(ep, map[string]any{"username": "a", "password": "b"}, nil, 400, "Bad Request")
	assert.Empty(t, learned1)

	// 2nd hit confirms behavioral requirement.
	learned2 := tracker.ObserveResponse(ep, map[string]any{"username": "a", "password": "b"}, nil, 400, "Bad Request")
	assert.Equal(t, []string{"csrf"}, learned2)
}

func TestRequiredParamTracker_DefaultValuePriority(t *testing.T) {
	ep := testLoginEndpoint()
	tracker := newRequiredParamTracker()
	safeGen := generator.New(nil, swagger.ProfileRandom, swagger.Settings{})
	dicts := map[string][]any{"csrf": {"tok_from_dict"}}

	tracker.ObserveResponse(ep, map[string]any{"username": "a", "password": "b"}, nil, 400, "Missing parameter 'csrf'")

	// 1. ep.Example wins over dictionary and safeGen
	built := generatedPayload{body: map[string]any{"username": "a"}}
	tracker.EnforceRequired(ep, &built, dicts, safeGen, 1.0)
	assert.Equal(t, "tok_from_example", built.body["csrf"])

	// 2. Dictionary wins when ep.Example has no value for csrf
	epNoExample := ep
	epNoExample.Example = nil
	built2 := generatedPayload{body: map[string]any{"username": "a"}}
	tracker.EnforceRequired(epNoExample, &built2, dicts, safeGen, 1.0)
	assert.Equal(t, "tok_from_dict", built2.body["csrf"])

	// 3. safeGen fallback when neither Example nor Dictionary has it
	built3 := generatedPayload{body: map[string]any{"username": "a"}}
	tracker.EnforceRequired(epNoExample, &built3, nil, safeGen, 1.0)
	assert.NotEmpty(t, built3.body["csrf"])
}

func TestRequiredParamTracker_EnforceRequiredNeverOmitsAndAllowsMutation(t *testing.T) {
	ep := testLoginEndpoint()
	tracker := newRequiredParamTracker()
	safeGen := generator.New(nil, swagger.ProfileRandom, swagger.Settings{})

	tracker.ObserveResponse(ep, map[string]any{"username": "a", "password": "b"}, nil, 400, "Missing parameter 'csrf'")

	pinnedCount := 0
	mutatedCount := 0
	for range 200 {
		built := generatedPayload{
			body: map[string]any{
				"csrf":     "' OR 1=1--",
				"username": "admin",
				"password": "123",
			},
		}
		tracker.EnforceRequired(ep, &built, nil, safeGen, defaultRequiredPinProbability)
		val, exists := built.body["csrf"]
		require.True(t, exists, "learned required key must never be omitted")
		if val == "tok_from_example" {
			pinnedCount++
		} else if val == "' OR 1=1--" {
			mutatedCount++
		}
	}

	assert.Greater(t, pinnedCount, 120, "most iterations should pin csrf so other fields reach app logic")
	assert.Greater(t, mutatedCount, 5, "some iterations must still mutate csrf value itself")
}

func TestRunner_AdaptiveRequiredParamIntegration(t *testing.T) {
	var sawMissingCSRF atomic.Int32
	var sawSQLiWithValidCSRF atomic.Int32

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		vals, _ := url.ParseQuery(string(raw))
		csrf := vals.Get("csrf")
		if csrf == "" {
			sawMissingCSRF.Add(1)
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte("Missing parameter 'csrf'"))
			return
		}
		if csrf == "valid_csrf_token" {
			u := vals.Get("username")
			if strings.Contains(u, "'") || strings.Contains(strings.ToUpper(u), "OR") || strings.Contains(u, "UNION") {
				sawSQLiWithValidCSRF.Add(1)
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte("ERROR: syntax error at or near \"'\""))
				return
			}
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("Invalid credentials"))
	}))
	defer srv.Close()

	cfg := &swagger.Config{
		BaseURL: srv.URL,
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
		Settings: swagger.Settings{
			IterationsPerProfile: 20,
			Concurrency:          2,
			TimeoutMs:            5000,
			Profiles:             []swagger.FuzzingProfile{swagger.ProfileMalicious},
		},
		Endpoints: []swagger.EndpointConfig{
			{
				Method:      "POST",
				Path:        "/login",
				ContentType: "application/x-www-form-urlencoded",
				Schema: swagger.SchemaProperty{
					Type: "object",
					Properties: map[string]*swagger.SchemaProperty{
						"csrf":     {Type: "string"},
						"username": {Type: "string"},
						"password": {Type: "string"},
					},
				},
				Example: map[string]any{
					"csrf":     "valid_csrf_token",
					"username": "wiener",
					"password": "peter",
				},
			},
		},
	}

	r := New(cfg, srv.Client())
	require.NotNil(t, r)
	defer r.Close()

	err := r.Start(context.Background())
	require.NoError(t, err)

	assert.Greater(t, sawSQLiWithValidCSRF.Load(), int32(0), "after learning csrf is required, SQLi payloads in username must reach the server with valid csrf")
}
