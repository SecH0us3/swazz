// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package bola

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"time"

	"swazz-engine/internal/swagger"
)

type mockRunnerContext struct {
	config *swagger.Config
	client *http.Client
}

func NewMock(cfg *swagger.Config, client *http.Client) *mockRunnerContext {
	if cfg.Variables == nil {
		cfg.Variables = make(map[string]any)
	}
	if client == nil {
		client = &http.Client{}
	}
	return &mockRunnerContext{config: cfg, client: client}
}

func (m *mockRunnerContext) Config() *swagger.Config { return m.config }
func (m *mockRunnerContext) LogDebug(f string, a ...any) {}
func (m *mockRunnerContext) LogInfo(f string, a ...any) {}
func (m *mockRunnerContext) LogWarn(f string, a ...any) {}
func (m *mockRunnerContext) LogError(f string, a ...any) {}
func (m *mockRunnerContext) BroadcastProgress() {}
func (m *mockRunnerContext) BroadcastResult(res *swagger.FuzzResult) {}
func (m *mockRunnerContext) UpdateProgressProfile(p string) {}
func (m *mockRunnerContext) UpdateProgressEndpoint(p string) {}
func (m *mockRunnerContext) AddTotalEndpoints(n int32) {}
func (m *mockRunnerContext) AddCompletedEndpoints(n int32) {}
func (m *mockRunnerContext) AddTotalPlanned(n int64) {}
func (m *mockRunnerContext) SendStat(res *swagger.FuzzResult, c, t int) {}
func (m *mockRunnerContext) RLockConfig() {}
func (m *mockRunnerContext) RUnlockConfig() {}
func (m *mockRunnerContext) LockConfig() {}
func (m *mockRunnerContext) UnlockConfig() {}
func (m *mockRunnerContext) LockResults() {}
func (m *mockRunnerContext) UnlockResults() {}
func (m *mockRunnerContext) SetLimiterTarget(c int) {}
func (m *mockRunnerContext) LimiterAcquire(ctx context.Context) error { return nil }
func (m *mockRunnerContext) LimiterRelease() {}
func (m *mockRunnerContext) GlobalHeadersWithGenerated(extra map[string]string) map[string]string {
	return extra
}

func (m *mockRunnerContext) ExecuteAuthSequence(ctx context.Context, seq []swagger.AuthStep, headers map[string]string, cookies map[string]string) (map[string]string, map[string]string, error) {
	outHeaders := make(map[string]string)
	outCookies := make(map[string]string)

	for k, v := range headers {
		outHeaders[k] = v
	}
	if len(seq) > 0 {
		if seq[0].URL == "/api/login-b" {
			outHeaders["Authorization"] = "Bearer user2-token"
		} else if seq[0].URL == "/api/login-admin" {
			outHeaders["Authorization"] = "Bearer admin-token"
		}
	}
	return outHeaders, outCookies, nil
}

func (m *mockRunnerContext) ExecuteRequest(ctx context.Context, baseURL, resolvedPath, epPath, method string,
	globalHeaders map[string]string, globalCookies map[string]string,
	body any, profile swagger.FuzzingProfile, queryParams map[string]any,
	headers map[string]string, contentType string) *swagger.FuzzResult {
	
	reqURL := baseURL + resolvedPath
	var bodyReader io.Reader
	if body != nil {
		if b, ok := body.([]byte); ok {
			bodyReader = bytes.NewReader(b)
		} else if s, ok := body.(string); ok {
			bodyReader = bytes.NewReader([]byte(s))
		}
	}
	req, _ := http.NewRequestWithContext(ctx, method, reqURL, bodyReader)
	for k, v := range globalHeaders {
		req.Header.Set(k, v)
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	
	start := time.Now()
	resp, err := m.client.Do(req)
	duration := time.Since(start)
	
	res := &swagger.FuzzResult{
		Endpoint: epPath,
		ResolvedPath: resolvedPath,
		Method: method,
		Profile: profile,
		Duration: int64(duration),
	}
	if err != nil {
		res.Error = err.Error()
		return res
	}
	defer resp.Body.Close()
	res.Status = resp.StatusCode
	bodyBytes, _ := io.ReadAll(resp.Body)
	res.ResponseSize = int64(len(bodyBytes))
	res.ResponseBody = string(bodyBytes)
	return res
}
