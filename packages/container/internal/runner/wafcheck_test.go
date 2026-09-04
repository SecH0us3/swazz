// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"swazz-engine/internal/swagger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRunPreScanWAFCheck_ExplicitlyDisabled(t *testing.T) {
	f := false
	cfg := &swagger.Config{
		BaseURL: "https://example.com",
		Settings: swagger.Settings{
			EnableWAFCheck: &f,
		},
	}
	runner := New(cfg, nil)
	defer runner.Close()

	runner.runPreScanWAFCheck(context.Background())
	stats := runner.GetStats()
	assert.Nil(t, stats.WAFCheck)
}

func TestRunPreScanWAFCheck_EnabledByDefault(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"detection": {"detected": false, "wafType": "", "confidence": 0, "evidence": [], "suggestedBypassTechniques": []},
			"bypassOpportunities": {"httpMethodsBypass": false, "headerBypass": false, "encodingBypass": false, "parameterPollution": false},
			"timestamp": "2026-09-04T12:00:00.000Z"
		}`))
	}))
	defer server.Close()

	cfg := &swagger.Config{
		BaseURL: "https://target.example.com",
		Settings: swagger.Settings{
			// EnableWAFCheck left nil — must behave as enabled.
			WAFCheckEndpoint: server.URL,
		},
	}
	runner := New(cfg, nil)
	defer runner.Close()

	runner.runPreScanWAFCheck(context.Background())
	stats := runner.GetStats()
	require.NotNil(t, stats.WAFCheck)
}

func TestRunPreScanWAFCheck_EmptyBaseURL(t *testing.T) {
	tr := true
	cfg := &swagger.Config{
		BaseURL: "",
		Settings: swagger.Settings{
			EnableWAFCheck: &tr,
		},
	}
	runner := New(cfg, nil)
	defer runner.Close()

	runner.runPreScanWAFCheck(context.Background())
	stats := runner.GetStats()
	assert.Nil(t, stats.WAFCheck)
}

func TestRunPreScanWAFCheck_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/waf-detect", r.URL.Path)
		assert.Equal(t, "https://target.example.com", r.URL.Query().Get("url"))

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"detection": {
				"detected": true,
				"wafType": "Cloudflare",
				"confidence": 0.95,
				"evidence": ["cf-ray header"],
				"suggestedBypassTechniques": ["encoding"]
			},
			"bypassOpportunities": {
				"httpMethodsBypass": false,
				"headerBypass": false,
				"encodingBypass": true,
				"parameterPollution": false
			},
			"timestamp": "2026-09-04T12:00:00.000Z"
		}`))
	}))
	defer server.Close()

	tr := true
	cfg := &swagger.Config{
		BaseURL: "https://target.example.com",
		Settings: swagger.Settings{
			EnableWAFCheck:   &tr,
			WAFCheckEndpoint: server.URL,
		},
	}
	runner := New(cfg, nil)
	defer runner.Close()

	runner.runPreScanWAFCheck(context.Background())
	stats := runner.GetStats()
	require.NotNil(t, stats.WAFCheck)
	assert.True(t, stats.WAFCheck.Detection.Detected)
	assert.Equal(t, "Cloudflare", stats.WAFCheck.Detection.WAFType)
	assert.Equal(t, 0.95, stats.WAFCheck.Detection.Confidence)
	assert.True(t, stats.WAFCheck.BypassOpportunities.EncodingBypass)
}

func TestRunPreScanWAFCheck_FailureDoesNotBlock(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error": "internal error"}`))
	}))
	defer server.Close()

	tr := true
	cfg := &swagger.Config{
		BaseURL: "https://target.example.com",
		Settings: swagger.Settings{
			EnableWAFCheck:   &tr,
			WAFCheckEndpoint: server.URL,
		},
	}
	runner := New(cfg, nil)
	defer runner.Close()

	runner.runPreScanWAFCheck(context.Background())
	stats := runner.GetStats()
	assert.Nil(t, stats.WAFCheck)
}
