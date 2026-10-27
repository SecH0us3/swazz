// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"swazz-engine/internal/swagger"
)

// benchmarkExecuteRequest sends one JSON request per iteration to a local server answering with
// a small JSON body: the per-request cost of the runner, connection reuse included.
func benchmarkExecuteRequest(b *testing.B, profile swagger.FuzzingProfile) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":1,"name":"item","status":"ok"}`))
	}))
	b.Cleanup(srv.Close)
	r := New(&swagger.Config{BaseURL: srv.URL, Security: swagger.SecurityConfig{AllowPrivateIPs: true}, Settings: swagger.Settings{TimeoutMs: 5000, AnalyzeResponseBody: true}}, srv.Client())
	b.Cleanup(r.Close)
	payload := map[string]any{"name": strings.Repeat("x", 4096), "comment": "' OR 1=1 --", "nested": map[string]any{"a": 1, "b": []any{"c", "d"}}}

	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		res := r.executeRequest(context.Background(), srv.URL, "/items", "/items", "POST", nil, nil, payload, profile, nil, nil, "application/json")
		if res.Status != 200 {
			b.Fatalf("status %d: %s", res.Status, res.Error)
		}
	}
}

func BenchmarkExecuteRequest_Malicious(b *testing.B) {
	benchmarkExecuteRequest(b, swagger.ProfileMalicious)
}

func BenchmarkExecuteRequest_Random(b *testing.B) {
	benchmarkExecuteRequest(b, swagger.ProfileRandom)
}
