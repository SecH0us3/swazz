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

func TestParseAPIError(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		label      string
		statusCode int
		body       []byte
		expected   string
	}{
		{
			name:       "structured error with both error and message",
			label:      "WAF check",
			statusCode: 400,
			body:       []byte(`{"error": "invalid_url", "message": "hostname is missing"}`),
			expected:   "WAF check API error (400): invalid_url - hostname is missing",
		},
		{
			name:       "structured error with only error",
			label:      "WAF check",
			statusCode: 403,
			body:       []byte(`{"error": "access_denied"}`),
			expected:   "WAF check API error (403): access_denied",
		},
		{
			name:       "structured error with only message",
			label:      "virtual-patch",
			statusCode: 429,
			body:       []byte(`{"message": "rate limit exceeded"}`),
			expected:   "virtual-patch API error (429): rate limit exceeded",
		},
		{
			name:       "unexpected json shape with empty error and message",
			label:      "WAF check",
			statusCode: 500,
			body:       []byte(`{"code": 500, "details": "internal failure"}`),
			expected:   `WAF check API error with status 500: {"code": 500, "details": "internal failure"}`,
		},
		{
			name:       "non-json raw text error body",
			label:      "WAF check",
			statusCode: 502,
			body:       []byte("502 Bad Gateway: upstream unreachable"),
			expected:   "WAF check API error with status 502: 502 Bad Gateway: upstream unreachable",
		},
		{
			name:       "empty body",
			label:      "WAF check",
			statusCode: 504,
			body:       []byte(""),
			expected:   "WAF check API error with status 504: ",
		},
		{
			name:       "nil body",
			label:      "virtual-patch",
			statusCode: 500,
			body:       nil,
			expected:   "virtual-patch API error with status 500: ",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := parseAPIError(tt.label, tt.statusCode, tt.body)
			require.Error(t, err)
			assert.Equal(t, tt.expected, err.Error())
		})
	}
}

func TestNewClient(t *testing.T) {
	t.Parallel()

	t.Run("empty endpoint defaults to DefaultEndpoint", func(t *testing.T) {
		t.Parallel()
		c := NewClient("")
		require.NotNil(t, c)
		assert.Equal(t, DefaultEndpoint, c.endpoint)
		assert.Equal(t, "https://waf.secmy.app", c.endpoint)
		require.NotNil(t, c.client)
		assert.Equal(t, 15*time.Second, c.client.Timeout)
	})

	t.Run("custom endpoint preserved", func(t *testing.T) {
		t.Parallel()
		c := NewClient("https://custom.waf.internal")
		require.NotNil(t, c)
		assert.Equal(t, "https://custom.waf.internal", c.endpoint)
	})

	t.Run("trailing slashes trimmed", func(t *testing.T) {
		t.Parallel()
		c := NewClient("https://custom.waf.internal///")
		require.NotNil(t, c)
		assert.Equal(t, "https://custom.waf.internal", c.endpoint)
	})
}

func TestClient_Detect_APIError_Variants(t *testing.T) {
	t.Parallel()

	t.Run("error only payload", func(t *testing.T) {
		t.Parallel()
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error": "forbidden_domain"}`))
		}))
		defer server.Close()

		client := NewClient(server.URL)
		res, err := client.Detect(context.Background(), "https://example.com")
		require.Error(t, err)
		assert.Nil(t, res)
		assert.Contains(t, err.Error(), "WAF check API error (403): forbidden_domain")
	})

	t.Run("message only payload", func(t *testing.T) {
		t.Parallel()
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"message": "rate limited, please wait"}`))
		}))
		defer server.Close()

		client := NewClient(server.URL)
		res, err := client.Detect(context.Background(), "https://example.com")
		require.Error(t, err)
		assert.Nil(t, res)
		assert.Contains(t, err.Error(), "WAF check API error (429): rate limited, please wait")
	})

	t.Run("plain text non-json error", func(t *testing.T) {
		t.Parallel()
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte("backend connection reset"))
		}))
		defer server.Close()

		client := NewClient(server.URL)
		res, err := client.Detect(context.Background(), "https://example.com")
		require.Error(t, err)
		assert.Nil(t, res)
		assert.Contains(t, err.Error(), "WAF check API error with status 500: backend connection reset")
	})
}

func TestClient_Detect_InvalidEndpointURL(t *testing.T) {
	t.Parallel()
	client := NewClient("http://[::1]:namedport")
	res, err := client.Detect(context.Background(), "https://example.com")
	require.Error(t, err)
	assert.Nil(t, res)
	assert.Contains(t, err.Error(), "invalid WAF check endpoint")
}

