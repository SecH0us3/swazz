// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package wafcheck

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClient_Detect_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/waf-detect", r.URL.Path)
		assert.Equal(t, "https://example.com", r.URL.Query().Get("url"))

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"detection": {
				"detected": true,
				"wafType": "Cloudflare",
				"confidence": 0.92,
				"evidence": ["cf-ray header present"],
				"suggestedBypassTechniques": ["encoding bypass"]
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

	client := NewClient(server.URL)
	res, err := client.Detect(context.Background(), "https://example.com")
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.True(t, res.Detection.Detected)
	assert.Equal(t, "Cloudflare", res.Detection.WAFType)
	assert.Equal(t, 0.92, res.Detection.Confidence)
	assert.Contains(t, res.Detection.Evidence, "cf-ray header present")
	assert.True(t, res.BypassOpportunities.EncodingBypass)
	assert.False(t, res.BypassOpportunities.HeaderBypass)
}

func TestClient_Detect_NoWAF(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"detection": {
				"detected": false,
				"wafType": "",
				"confidence": 0,
				"evidence": [],
				"suggestedBypassTechniques": []
			},
			"bypassOpportunities": {
				"httpMethodsBypass": false,
				"headerBypass": false,
				"encodingBypass": false,
				"parameterPollution": false
			},
			"timestamp": "2026-09-04T12:00:00.000Z"
		}`))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	res, err := client.Detect(context.Background(), "https://nowaf.example.com")
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.False(t, res.Detection.Detected)
	assert.Empty(t, res.Detection.WAFType)
}

func TestClient_Detect_400Error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error": "invalid url", "message": "hostname missing"}`))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	res, err := client.Detect(context.Background(), "invalid-url")
	require.Error(t, err)
	assert.Nil(t, res)
	assert.Contains(t, err.Error(), "invalid url")
	assert.Contains(t, err.Error(), "hostname missing")
}

func TestClient_Detect_MalformedJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{not-json`))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	res, err := client.Detect(context.Background(), "https://example.com")
	require.Error(t, err)
	assert.Nil(t, res)
	assert.Contains(t, err.Error(), "failed to decode WAF check response JSON")
}

func TestClient_Detect_ContextTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := NewClient(server.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	res, err := client.Detect(ctx, "https://example.com")
	require.Error(t, err)
	assert.Nil(t, res)
}
