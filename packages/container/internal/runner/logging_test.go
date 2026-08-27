// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"swazz-engine/internal/swagger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFormatBytes(t *testing.T) {
	tests := []struct {
		input    int
		expected string
	}{
		{0, "0 B"},
		{-10, "0 B"},
		{500, "500 B"},
		{1024, "1.0 KB (1024 B)"},
		{2048, "2.0 KB (2048 B)"},
		{524288, "512.0 KB (524288 B)"},
		{1048576, "1.0 MB (1048576 B)"},
		{10485760, "10.0 MB (10485760 B)"},
		{1073741824, "1.0 GB (1073741824 B)"},
	}

	for _, tc := range tests {
		t.Run(tc.expected, func(t *testing.T) {
			assert.Equal(t, tc.expected, formatBytes(tc.input))
		})
	}
}

func TestFormatDuration(t *testing.T) {
	tests := []struct {
		inputMs  int64
		expected string
	}{
		{0, "0s"},
		{-100, "0s"},
		{500, "0s"},
		{1500, "1s"},
		{45000, "45s"},
		{60000, "1m"},
		{75000, "1m 15s"},
		{3600000, "1h"},
		{3720000, "1h 2m"},
	}

	for _, tc := range tests {
		t.Run(tc.expected, func(t *testing.T) {
			assert.Equal(t, tc.expected, formatDuration(tc.inputMs))
		})
	}
}

func TestMaskSensitiveString(t *testing.T) {
	assert.Equal(t, "", maskSensitiveString(""))
	assert.Equal(t, "****", maskSensitiveString("pass"))
	assert.Equal(t, "se...23", maskSensitiveString("secret123"))
	assert.Equal(t, "Bearer ****", maskSensitiveString("Bearer 1234"))
	assert.Equal(t, "Bearer eyJ...xyz", maskSensitiveString("Bearer eyJhbGciOi...xyz"))
}

func TestIsSensitiveHeader(t *testing.T) {
	assert.True(t, isSensitiveHeader("Authorization"))
	assert.True(t, isSensitiveHeader("X-Api-Key"))
	assert.True(t, isSensitiveHeader("Cookie"))
	assert.True(t, isSensitiveHeader("X-CSRF-Token"))
	assert.False(t, isSensitiveHeader("Content-Type"))
	assert.False(t, isSensitiveHeader("Accept"))
	assert.False(t, isSensitiveHeader("Host"))
}

func TestEstimateScanDuration(t *testing.T) {
	assert.Equal(t, "<1s", estimateScanDuration(0, 5, 0, false))
	assert.Equal(t, "<1s", estimateScanDuration(10, 0, 0, false))
	assert.Equal(t, "~2s", estimateScanDuration(100, 2, 0, false))
	assert.Equal(t, "~10s", estimateScanDuration(100, 2, 0, true))
}

func TestLogStartupSummary(t *testing.T) {
	t.Run("standard HTTP target with complete configuration", func(t *testing.T) {
		cfg := &swagger.Config{
			BaseURL: "https://api.example.com/v1",
			Endpoints: []swagger.EndpointConfig{
				{Method: "GET", Path: "/users"},
				{Method: "POST", Path: "/users"},
			},
			GlobalHeaders: map[string]string{
				"Authorization": "Bearer secret-token-value-12345",
				"X-Custom-App":  "SwazzMobile",
			},
			Cookies: map[string]string{
				"session": "session-val-1234",
			},
			Dictionaries: map[string][]any{
				"SQLi": {"' OR '1'='1", "admin'--"},
			},
			WordlistFiles: map[string]string{
				"endpoints": "/data/wordlists/common.txt",
			},
			Rules: &swagger.RulesConfig{
				Ignore: []int{404},
				IgnoreRules: []swagger.IgnoreRule{
					{Endpoint: "/health", Status: "200"},
				},
			},
			Settings: swagger.Settings{
				IterationsPerProfile:    15,
				Concurrency:             4,
				TimeoutMs:               5000,
				DelayBetweenRequestMs:   10,
				MaxPayloadSizeBytes:     10485760,
				MaxScanDurationMin:      10,
				BOLATesting:             true,
				BOLASimilarityThreshold: 0.85,
				RateLimitCheck:          true,
				RateLimitBurstSize:      30,
				ActiveParameterFuzzing:  true,
				RandomizeUserAgent:      true,
				UseLLMPrepass:           true,
				AIGatewayURL:            "https://gateway.ai.cloudflare.com/v1/swazz",
				EnableSmartTriage:       true,
				MaxTriagePerScan:        25,
				ProxyList:               []string{"http://proxy1:8080", "http://proxy2:8080"},
				ChainingRules: []swagger.ChainingRule{
					{SourceEndpoint: "/login", ExtractType: "json", ExtractPath: "token", VariableName: "authToken"},
				},
			},
			AuthSequence: []swagger.AuthStep{
				{Type: "login", Method: "POST", URL: "/api/login"},
			},
			AuthIdentities: map[string]swagger.AuthIdentity{
				"UserB": {},
			},
			Security: swagger.SecurityConfig{
				AllowPrivateIPs: true,
			},
		}
		r := New(cfg, http.DefaultClient)
		defer r.Close()
		r.progress.totalPlanned.Store(120)

		ch := r.Subscribe()
		defer r.Unsubscribe(ch)

		profiles := []swagger.FuzzingProfile{swagger.ProfileRandom, swagger.ProfileBoundary}
		r.logStartupSummary(profiles)

		time.Sleep(50 * time.Millisecond)

		var receivedMsgs []string
		for len(ch) > 0 {
			evt := <-ch
			if evt.Type == "runner_log" {
				if m, ok := evt.Data.(map[string]any); ok {
					if msg, ok := m["message"].(string); ok {
						receivedMsgs = append(receivedMsgs, msg)
					}
				}
			}
		}

		fullOutput := strings.Join(receivedMsgs, "\n")
		assert.Contains(t, fullOutput, "Runtime & Engine")
		assert.Contains(t, fullOutput, "Private IPs Allowed")
		assert.Contains(t, fullOutput, "https://api.example.com/v1 (2 endpoint(s))")
		assert.Contains(t, fullOutput, "RANDOM, BOUNDARY")
		assert.Contains(t, fullOutput, "~120 requests (15 iter/profile)")
		assert.Contains(t, fullOutput, "Max Limit: 10m")
		assert.Contains(t, fullOutput, "4 workers | Timeout: 5000ms | Delay: 10ms | Max Payload: 10.0 MB (10485760 B)")
		assert.Contains(t, fullOutput, "Authorization: Bearer sec...345")
		assert.Contains(t, fullOutput, "X-Custom-App")
		assert.Contains(t, fullOutput, "Cookies (1: session)")
		assert.Contains(t, fullOutput, "Identities (1: UserB)")
		assert.Contains(t, fullOutput, "AuthSequence (1 steps)")
		assert.Contains(t, fullOutput, "Dictionaries (1: SQLi (2 entries))")
		assert.Contains(t, fullOutput, "Wordlists (1: endpoints=common.txt)")
		assert.Contains(t, fullOutput, "LLM Pre-scan (https://gateway.ai.cloudflare.com/v1/swazz)")
		assert.Contains(t, fullOutput, "Smart Triage (Max: 25 evaluations)")
		assert.Contains(t, fullOutput, "BOLA (threshold=0.85, identities=1)")
		assert.Contains(t, fullOutput, "RateLimitCheck (burst=30)")
		assert.Contains(t, fullOutput, "ActiveParamFuzz")
		assert.Contains(t, fullOutput, "Proxies (2)")
		assert.Contains(t, fullOutput, "RandomUA")
		assert.Contains(t, fullOutput, "ChainingRules (1)")
		assert.Contains(t, fullOutput, "IgnoreRules (2)")
	})

	t.Run("MCP stdio target and checkpoint resumption", func(t *testing.T) {
		cfg := &swagger.Config{
			MCPServer: &swagger.MCPServerConfig{
				Type:    "stdio",
				Command: "npx",
				Args:    []string{"-y", "@modelcontextprotocol/server-everything"},
			},
			Endpoints: []swagger.EndpointConfig{
				{Method: "CALL", Path: "mcp://tool/echo"},
			},
			Settings: swagger.Settings{
				IterationsPerProfile: 5,
				Concurrency:          2,
				TimeoutMs:            3000,
				MaxPayloadSizeBytes:  2097152,
				Checkpoint: &swagger.Checkpoint{
					Profile:   "RANDOM",
					Endpoint:  "CALL mcp://tool/echo",
					Iteration: 3,
				},
			},
		}
		r := New(cfg, http.DefaultClient)
		defer r.Close()
		r.progress.totalPlanned.Store(10)

		ch := r.Subscribe()
		defer r.Unsubscribe(ch)

		r.logStartupSummary([]swagger.FuzzingProfile{swagger.ProfileRandom})

		time.Sleep(50 * time.Millisecond)

		var receivedMsgs []string
		for len(ch) > 0 {
			evt := <-ch
			if evt.Type == "runner_log" {
				if m, ok := evt.Data.(map[string]any); ok {
					if msg, ok := m["message"].(string); ok {
						receivedMsgs = append(receivedMsgs, msg)
					}
				}
			}
		}

		fullOutput := strings.Join(receivedMsgs, "\n")
		assert.Contains(t, fullOutput, "MCP stdio (npx -y @modelcontextprotocol/server-everything) (1 endpoint(s))")
		assert.Contains(t, fullOutput, "2 workers | Timeout: 3000ms | Delay: 0ms | Max Payload: 2.0 MB (2097152 B)")
		assert.Contains(t, fullOutput, "Resuming Checkpoint:  Profile=RANDOM | Endpoint=CALL mcp://tool/echo | Iteration=3")
	})

	t.Run("nil config defense", func(t *testing.T) {
		r := &Runner{config: nil}
		require.NotPanics(t, func() {
			r.logStartupSummary([]swagger.FuzzingProfile{swagger.ProfileRandom})
		})
	})
}

func TestLogCompletionSummary(t *testing.T) {
	cfg := &swagger.Config{
		BaseURL: "https://api.example.com",
	}
	r := New(cfg, http.DefaultClient)
	defer r.Close()

	ch := r.Subscribe()
	defer r.Unsubscribe(ch)

	stats := swagger.RunStats{
		TotalRequests:      50,
		TotalPlanned:       50,
		RequestsPerSec:     25.5,
		TotalDurationMs:    1960,
		TotalResponseBytes: 1048576,
		StatusCounts: map[int]int64{
			200: 45,
			500: 5,
		},
	}

	r.logCompletionSummary(stats)

	time.Sleep(50 * time.Millisecond)

	var receivedMsgs []string
	for len(ch) > 0 {
		evt := <-ch
		if evt.Type == "runner_log" {
			if m, ok := evt.Data.(map[string]any); ok {
				if msg, ok := m["message"].(string); ok {
					receivedMsgs = append(receivedMsgs, msg)
				}
			}
		}
	}

	fullOutput := strings.Join(receivedMsgs, "\n")
	assert.Contains(t, fullOutput, "Swazz Fuzzing Scan Completed")
	assert.Contains(t, fullOutput, "Duration:           1s (Avg RPS: 25.5)")
	assert.Contains(t, fullOutput, "Requests Executed:   50 / 50 (100.0%) | Transferred: 1.0 MB (1048576 B)")
	assert.Contains(t, fullOutput, "Status Distribution: 200: 45 | 500: 5")
	assert.Contains(t, fullOutput, "Clean scan (0 analyzer findings)")
}

func TestTruncateLog(t *testing.T) {
	short := "hello world"
	assert.Equal(t, short, truncateLog(short))

	long := strings.Repeat("A", 40000)
	truncated := truncateLog(long)
	assert.True(t, strings.HasSuffix(truncated, "... [TRUNCATED]"))
	assert.Equal(t, 32768+len("... [TRUNCATED]"), len(truncated))
}
