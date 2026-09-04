// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package wafcheck

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClient_GeneratePatches_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/virtual-patch", r.URL.Path)
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))

		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)

		var req patchRequest
		require.NoError(t, json.Unmarshal(body, &req))
		assert.Len(t, req.Results, 1)
		assert.Equal(t, "SQL Injection", req.Results[0].Category)
		assert.Equal(t, "all", req.Options.Vendor)
		assert.True(t, req.Options.IncludeTerraform)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"targetUrl": "https://example.com",
			"generatedAt": "2026-09-04T12:00:00.000Z",
			"totalBypasses": 1,
			"bundles": {
				"cloudflare": {
					"vendor": "cloudflare",
					"native": "http.request.uri.query contains \"1' OR '1'='1\"",
					"terraform": "resource \"cloudflare_ruleset\" ...",
					"ruleCount": 1
				},
				"aws": {
					"vendor": "aws",
					"native": "aws-waf-rule",
					"ruleCount": 1
				}
			}
		}`))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	items := []AuditResultItem{
		{
			Category:       "SQL Injection",
			Payload:        "1' OR '1'='1",
			Method:         "GET",
			Status:         200,
			ResponseTimeMs: 45,
		},
	}
	opts := PatchOptions{
		Vendor:           "all",
		TargetURL:        "https://example.com",
		IncludeTerraform: true,
	}

	report, err := client.GeneratePatches(context.Background(), items, opts)
	require.NoError(t, err)
	require.NotNil(t, report)
	assert.Equal(t, "https://example.com", report.TargetUrl)
	assert.Equal(t, 1, report.TotalBypasses)
	assert.Len(t, report.Bundles, 2)
	assert.Equal(t, "cloudflare", report.Bundles["cloudflare"].Vendor)
	assert.Contains(t, report.Bundles["cloudflare"].Native, "1' OR '1'='1")
	assert.Contains(t, report.Bundles["cloudflare"].Terraform, "cloudflare_ruleset")
	assert.Equal(t, "aws", report.Bundles["aws"].Vendor)
}

func TestClient_GeneratePatches_EmptyResults(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"targetUrl": "https://example.com",
			"generatedAt": "2026-09-04T12:00:00.000Z",
			"totalBypasses": 0,
			"bundles": {}
		}`))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	report, err := client.GeneratePatches(context.Background(), []AuditResultItem{}, PatchOptions{Vendor: "all"})
	require.NoError(t, err)
	require.NotNil(t, report)
	assert.Equal(t, 0, report.TotalBypasses)
	assert.Empty(t, report.Bundles)
}

func TestClient_GeneratePatches_400Error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error": "bad request", "message": "invalid options"}`))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	report, err := client.GeneratePatches(context.Background(), nil, PatchOptions{})
	require.Error(t, err)
	assert.Nil(t, report)
	assert.Contains(t, err.Error(), "bad request")
	assert.Contains(t, err.Error(), "invalid options")
}

func TestClient_GeneratePatches_MalformedJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{malformed`))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	report, err := client.GeneratePatches(context.Background(), nil, PatchOptions{})
	require.Error(t, err)
	assert.Nil(t, report)
	assert.Contains(t, err.Error(), "failed to decode virtual-patch response JSON")
}

func TestClient_GeneratePatches_ContextTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := NewClient(server.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	report, err := client.GeneratePatches(ctx, nil, PatchOptions{})
	require.Error(t, err)
	assert.Nil(t, report)
}
