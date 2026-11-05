// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package agent

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/safenet"
	"swazz-engine/internal/triage"
	"swazz-engine/internal/wafcheck"
)

// endlessErrorServer answers every request with a 500 whose body never ends.
func endlessErrorServer(t *testing.T) *httptest.Server {
	t.Helper()
	chunk := bytes.Repeat([]byte("x"), 32<<10)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		for r.Context().Err() == nil {
			if _, err := w.Write(chunk); err != nil {
				return
			}
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// An Edge API error reads only the start of its body into the error, however long the body.
func TestEdgeAPIErrors_BodyIsCapped(t *testing.T) {
	srv := endlessErrorServer(t)
	cases := []struct {
		name string
		call func() error
	}{
		{"waf patch", func() error {
			return sendWAFPatchToEdge(srv.URL, "tok", "scan-1", &wafcheck.PatchReport{
				Bundles: map[string]wafcheck.PatchBundle{"cloudflare": {Vendor: "cloudflare", Native: "rule"}},
			})
		}},
		{"triage batch", func() error {
			return sendTriageBatchToEdge(srv.URL, "tok", "scan-1", []*triage.TriageResult{{FindingIDs: []string{"f1"}}})
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			start := time.Now()
			err := tc.call()
			require.Error(t, err)
			assert.Contains(t, err.Error(), "status 500")
			assert.LessOrEqual(t, len(err.Error()), safenet.MaxErrorBodyBytes+100)
			assert.Less(t, time.Since(start), 10*time.Second, "not read until the client timeout")
		})
	}
}
