// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package agent

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/wafcheck"
)

func TestSendWAFPatchToEdge_NilOrEmpty(t *testing.T) {
	err := sendWAFPatchToEdge("http://localhost:8080", "token", "scan-1", nil)
	assert.NoError(t, err)

	err = sendWAFPatchToEdge("http://localhost:8080", "token", "scan-1", &wafcheck.PatchReport{
		Bundles: map[string]wafcheck.PatchBundle{},
	})
	assert.NoError(t, err)
}

func TestSendWAFPatchToEdge_InvalidURL(t *testing.T) {
	report := &wafcheck.PatchReport{
		Bundles: map[string]wafcheck.PatchBundle{
			"cloudflare": {Vendor: "cloudflare", Native: "rule"},
		},
	}
	err := sendWAFPatchToEdge("", "token", "scan-1", report)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid coordinator URL")
}

func TestSendWAFPatchToEdge_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/scans/scan-123/waf-patch", r.URL.Path)
		assert.Equal(t, "PATCH", r.Method)
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))
		assert.Equal(t, "Bearer test-token", r.Header.Get("Authorization"))

		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)

		var received wafcheck.PatchReport
		require.NoError(t, json.Unmarshal(body, &received))
		assert.Equal(t, 1, received.TotalBypasses)
		assert.Contains(t, received.Bundles, "cloudflare")

		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"success": true}`))
	}))
	defer server.Close()

	report := &wafcheck.PatchReport{
		TargetUrl:     "https://example.com",
		TotalBypasses: 1,
		Bundles: map[string]wafcheck.PatchBundle{
			"cloudflare": {
				Vendor: "cloudflare",
				Native: "rule",
			},
		},
	}

	err := sendWAFPatchToEdge(server.URL, "test-token", "scan-123", report)
	assert.NoError(t, err)
}

func TestSendWAFPatchToEdge_ErrorResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error": "invalid report"}`))
	}))
	defer server.Close()

	report := &wafcheck.PatchReport{
		TotalBypasses: 1,
		Bundles: map[string]wafcheck.PatchBundle{
			"cloudflare": {Vendor: "cloudflare", Native: "rule"},
		},
	}

	err := sendWAFPatchToEdge(server.URL, "test-token", "scan-123", report)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "status 400")
	assert.Contains(t, err.Error(), "invalid report")
}
