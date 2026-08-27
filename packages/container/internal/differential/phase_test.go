// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package differential

import (
	"context"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"swazz-engine/internal/swagger"
)

type mockRunnerContext struct {
	cfg            *swagger.Config
	broadcasted    []*swagger.FuzzResult
	mu             sync.Mutex
	executeCalls   int
	executeHandler func(baseURL, resolvedPath, epPath, method string, headers map[string]string) *swagger.FuzzResult
}

func (m *mockRunnerContext) Config() *swagger.Config { return m.cfg }
func (m *mockRunnerContext) LogDebug(format string, args ...any) {}
func (m *mockRunnerContext) LogInfo(format string, args ...any)  {}
func (m *mockRunnerContext) LogWarn(format string, args ...any)  {}
func (m *mockRunnerContext) LogError(format string, args ...any) {}

func (m *mockRunnerContext) BroadcastProgress() {}
func (m *mockRunnerContext) BroadcastResult(res *swagger.FuzzResult) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.broadcasted = append(m.broadcasted, res)
}

func (m *mockRunnerContext) UpdateProgressProfile(profile string) {}
func (m *mockRunnerContext) UpdateProgressEndpoint(epKey string)  {}
func (m *mockRunnerContext) AddTotalEndpoints(n int32)            {}
func (m *mockRunnerContext) AddCompletedEndpoints(n int32)        {}
func (m *mockRunnerContext) AddTotalPlanned(n int64)              {}

func (m *mockRunnerContext) SendStat(res *swagger.FuzzResult, currentIteration, totalIterations int) {}

func (m *mockRunnerContext) RLockConfig()   {}
func (m *mockRunnerContext) RUnlockConfig() {}

func (m *mockRunnerContext) ExecuteAuthSequence(ctx context.Context, seq []swagger.AuthStep, headers map[string]string, cookies map[string]string) (map[string]string, map[string]string, error) {
	return headers, cookies, nil
}

func (m *mockRunnerContext) ExecuteRequest(ctx context.Context, baseURL, resolvedPath, epPath, method string,
	globalHeaders map[string]string, globalCookies map[string]string,
	body any, profile swagger.FuzzingProfile, queryParams map[string]any,
	headers map[string]string, contentType string) *swagger.FuzzResult {
	m.mu.Lock()
	m.executeCalls++
	m.mu.Unlock()

	if m.executeHandler != nil {
		return m.executeHandler(baseURL, resolvedPath, epPath, method, headers)
	}

	return &swagger.FuzzResult{
		Status:       200,
		ResponseBody: `{"id": "doc_123", "title": "Secret Alice Document", "author": "Alice"}`,
		Endpoint:     epPath,
		Method:       method,
	}
}

func (m *mockRunnerContext) LimiterAcquire(ctx context.Context) error { return nil }
func (m *mockRunnerContext) LimiterRelease()                          {}

func TestPhase_Disabled(t *testing.T) {
	f := false
	mockCtx := &mockRunnerContext{
		cfg: &swagger.Config{
			Settings: swagger.Settings{
				EnableDifferentialAnalysis: &f,
			},
		},
	}

	phase := NewPhase(mockCtx)
	results := []*swagger.FuzzResult{
		{
			Status:       201,
			ResponseBody: `{"id": "doc_123"}`,
			Endpoint:     "/api/documents",
			Method:       "POST",
		},
	}

	findings := phase.Run(context.Background(), results)
	assert.Nil(t, findings)
	assert.Equal(t, 0, mockCtx.executeCalls)
}

func TestPhase_Run_BOLAFinding(t *testing.T) {
	tr := true
	mockCtx := &mockRunnerContext{
		cfg: &swagger.Config{
			BaseURL: "http://example.com",
			Settings: swagger.Settings{
				EnableDifferentialAnalysis: &tr,
			},
			Endpoints: []swagger.EndpointConfig{
				{
					Method: "POST",
					Path:   "/api/documents",
				},
				{
					Method: "GET",
					Path:   "/api/documents/{doc_id}",
				},
			},
			AuthIdentities: map[string]swagger.AuthIdentity{
				"UserB": {
					Headers: map[string]string{"Authorization": "Bearer token_user_b"},
				},
			},
		},
		executeHandler: func(baseURL, resolvedPath, epPath, method string, headers map[string]string) *swagger.FuzzResult {
			// Return Alice's document data to User B -> BOLA confirmed!
			return &swagger.FuzzResult{
				Status:       200,
				ResponseBody: `{"id": "doc_123", "title": "Secret Alice Document", "author": "Alice"}`,
				Endpoint:     epPath,
				Method:       method,
			}
		},
	}

	phase := NewPhase(mockCtx)
	results := []*swagger.FuzzResult{
		{
			Status:       201,
			ResponseBody: `{"id": "doc_123", "title": "Secret Alice Document", "author": "Alice"}`,
			Endpoint:     "/api/documents",
			Method:       "POST",
		},
	}

	findings := phase.Run(context.Background(), results)
	require.NotEmpty(t, findings)
	assert.GreaterOrEqual(t, mockCtx.executeCalls, 1)

	// Check finding contents
	foundBOLA := false
	for _, f := range findings {
		for _, af := range f.AnalyzerFindings {
			if af.RuleID == "swazz/differential-bola-idor" || af.RuleID == "swazz/differential-unauthorized-access" {
				foundBOLA = true
				assert.Equal(t, "error", af.Level)
			}
		}
	}
	assert.True(t, foundBOLA, "expected differential BOLA finding")
}
