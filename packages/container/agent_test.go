// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"swazz-engine/internal/swagger"
)

func TestInferOOBServerURL(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{
			input:    "wss://swazz.secmy.app/api/runners/connect",
			expected: "https://swazz.secmy.app",
		},
		{
			input:    "ws://localhost:8080/api/runners/connect",
			expected: "http://localhost:8080",
		},
		{
			input:    "wss://swazz.secmy.app/api/scans",
			expected: "https://swazz.secmy.app",
		},
		{
			input:    "https://swazz.secmy.app",
			expected: "https://swazz.secmy.app",
		},
		{
			input:    "",
			expected: "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			actual := inferOOBServerURL(tc.input)
			assert.Equal(t, tc.expected, actual)
		})
	}
}

func TestDeriveTelemetryURL(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{
			input:    "wss://swazz.secmy.app/api/runners/connect",
			expected: "https://swazz.secmy.app/api/telemetry/scans/increment",
		},
		{
			input:    "ws://localhost:8080/api/runners/connect",
			expected: "http://localhost:8080/api/telemetry/scans/increment",
		},
		{
			input:    "http://example.com",
			expected: "http://example.com/api/telemetry/scans/increment",
		},
		{
			input:    "",
			expected: "https://swazz.secmy.app/api/telemetry/scans/increment",
		},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			actual := deriveTelemetryURL(tc.input)
			assert.Equal(t, tc.expected, actual)
		})
	}
}

func TestIncrementGlobalScanTelemetry(t *testing.T) {
	calledChan := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "POST", r.Method)
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))
		assert.Equal(t, "Swazz/1.0 (+https://github.com/SecH0us3/swazz)", r.Header.Get("User-Agent"))
		w.WriteHeader(http.StatusOK)
		select {
		case calledChan <- struct{}{}:
		default:
		}
	}))
	defer server.Close()

	// Test case 1: disableTelemetry = true
	incrementGlobalScanTelemetry(server.URL, true)
	select {
	case <-calledChan:
		t.Fatal("telemetry should have been disabled")
	case <-time.After(50 * time.Millisecond):
		// Expected: no call
	}

	// Test case 2: disableTelemetry = false
	incrementGlobalScanTelemetry(server.URL, false)
	select {
	case <-calledChan:
		// Expected: call received
	case <-time.After(1 * time.Second):
		t.Fatal("timeout waiting for telemetry increment call")
	}
}

func TestAgent_GRPCAndProtoDetection(t *testing.T) {
	protoBytes := []byte("syntax = \"proto3\";\npackage test;\nmessage M { string a = 1; }")
	assert.True(t, swagger.IsProtoFile(protoBytes))
	assert.True(t, swagger.IsGRPCURL("grpc://localhost:50051"))
	assert.True(t, swagger.IsGRPCURL("grpcs://10.0.0.1:443"))
	assert.False(t, swagger.IsGRPCURL("http://localhost:8080"))
	assert.False(t, swagger.IsGRPCURL("https://api.example.com"))
}

func TestFilterSensitiveData(t *testing.T) {
	raw := `{"password": "secret123", "token": "jwt-token-456", "safe": "value"}`
	filtered := filterSensitiveData(raw)
	assert.NotContains(t, filtered, "password")
	assert.NotContains(t, filtered, "secret")
	assert.NotContains(t, filtered, "token")
	assert.Contains(t, filtered, "[FILTERED]")
	assert.Contains(t, filtered, "safe")
}

func TestPruneSchema(t *testing.T) {
	// 1. Nil safety
	pruneSchema(nil, 0, 3)

	// 2. Deeply nested schema
	schema := &swagger.SchemaProperty{
		Type: "object",
		Properties: map[string]*swagger.SchemaProperty{
			"level1": {
				Type: "object",
				Properties: map[string]*swagger.SchemaProperty{
					"level2": {
						Type: "object",
						Properties: map[string]*swagger.SchemaProperty{
							"level3": {Type: "string"},
						},
					},
				},
			},
		},
	}

	pruneSchema(schema, 0, 1)
	assert.Nil(t, schema.Properties["level1"].Properties)
}

func TestLoadPrivateKey(t *testing.T) {
	// 1. Valid 32-byte seed in hex
	seedHex := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	key, err := loadPrivateKey(seedHex)
	assert.NoError(t, err)
	assert.NotNil(t, key)

	// 2. Invalid hex
	_, err = loadPrivateKey("not-hex-string")
	assert.Error(t, err)

	// 3. Invalid key size
	_, err = loadPrivateKey("0123456789abcdef")
	assert.Error(t, err)
}

func TestDeriveHTTPBaseURL(t *testing.T) {
	assert.Equal(t, "https://swazz.secmy.app", deriveHTTPBaseURL("wss://swazz.secmy.app/api/runners/connect"))
	assert.Equal(t, "http://localhost:8080", deriveHTTPBaseURL("ws://localhost:8080/api/runners/connect"))
	assert.Equal(t, "https://api.example.com", deriveHTTPBaseURL("https://api.example.com/api/scans"))
	assert.Equal(t, "https://api.example.com/sub", deriveHTTPBaseURL("https://api.example.com/sub"))
	assert.Equal(t, "", deriveHTTPBaseURL(""))
}

func TestLoggingHelpers(t *testing.T) {
	// ensure no panics
	logDebug("test %s", "debug")
	logInfo("test %s", "info")
	logWarn("test %s", "warn")
	logError("test %s", "error")
}

