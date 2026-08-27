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

func TestLogStartupSummary(t *testing.T) {
	t.Run("standard HTTP target with security modules", func(t *testing.T) {
		cfg := &swagger.Config{
			BaseURL: "https://api.example.com/v1",
			Endpoints: []swagger.EndpointConfig{
				{Method: "GET", Path: "/users"},
				{Method: "POST", Path: "/users"},
			},
			Settings: swagger.Settings{
				IterationsPerProfile:    15,
				Concurrency:             4,
				TimeoutMs:               5000,
				DelayBetweenRequestMs:   10,
				MaxPayloadSizeBytes:     10485760,
				BOLATesting:             true,
				BOLASimilarityThreshold: 0.85,
				RateLimitCheck:          true,
				RateLimitBurstSize:      30,
				ActiveParameterFuzzing:  true,
				RandomizeUserAgent:      true,
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
		}
		r := New(cfg, http.DefaultClient)
		defer r.Close()
		r.progress.totalPlanned.Store(120)

		ch := r.Subscribe()
		defer r.Unsubscribe(ch)

		profiles := []swagger.FuzzingProfile{swagger.ProfileRandom, swagger.ProfileBoundary}
		r.logStartupSummary(profiles)

		// Wait briefly for broadcastLoop to process queue
		time.Sleep(50 * time.Millisecond)

		// Collect emitted runner_log events
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
		assert.Contains(t, fullOutput, "https://api.example.com/v1 (2 endpoint(s))")
		assert.Contains(t, fullOutput, "RANDOM, BOUNDARY")
		assert.Contains(t, fullOutput, "~120 requests (15 iter/profile)")
		assert.Contains(t, fullOutput, "4 workers | Timeout: 5000ms | Delay: 10ms | Max Payload: 10.0 MB (10485760 B)")
		assert.Contains(t, fullOutput, "BOLA (threshold=0.85, identities=1)")
		assert.Contains(t, fullOutput, "RateLimitCheck (burst=30)")
		assert.Contains(t, fullOutput, "ActiveParamFuzz")
		assert.Contains(t, fullOutput, "Proxies (2)")
		assert.Contains(t, fullOutput, "RandomUA")
		assert.Contains(t, fullOutput, "ChainingRules (1)")
		assert.Contains(t, fullOutput, "AuthSequence (1 steps)")
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

func TestTruncateLog(t *testing.T) {
	short := "hello world"
	assert.Equal(t, short, truncateLog(short))

	long := strings.Repeat("A", 40000)
	truncated := truncateLog(long)
	assert.True(t, strings.HasSuffix(truncated, "... [TRUNCATED]"))
	assert.Equal(t, 32768+len("... [TRUNCATED]"), len(truncated))
}
