package main

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
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
	var callCount int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&callCount, 1)
		assert.Equal(t, "POST", r.Method)
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))
		assert.Equal(t, "Swazz/1.0 (+https://github.com/SecH0us3/swazz)", r.Header.Get("User-Agent"))
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	// Test case 1: disableTelemetry = true
	incrementGlobalScanTelemetry(server.URL, true)
	time.Sleep(50 * time.Millisecond) // wait for goroutine
	assert.Equal(t, int32(0), atomic.LoadInt32(&callCount))

	// Test case 2: disableTelemetry = false
	incrementGlobalScanTelemetry(server.URL, false)
	time.Sleep(150 * time.Millisecond) // wait for goroutine
	assert.Equal(t, int32(1), atomic.LoadInt32(&callCount))
}
