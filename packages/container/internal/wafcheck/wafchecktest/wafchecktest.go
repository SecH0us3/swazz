// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// Package wafchecktest keeps test binaries off the production WAF-checker API.
//
// The pre-scan WAF check is on by default (swagger.Settings.WAFCheckEnabled) and an empty
// WAFCheckEndpoint means wafcheck.DefaultEndpoint, so any test that starts a Runner without
// opting out would otherwise call https://waf.secmy.app with a 15 s timeout. A package whose
// tests start Runners wraps its TestMain with Wrap:
//
//	func TestMain(m *testing.M) { os.Exit(wafchecktest.Wrap(m).Run()) }
//
// Tests that set WAFCheckEndpoint to their own server are unaffected.
package wafchecktest

import (
	"net/http"
	"net/http/httptest"

	"swazz-engine/internal/wafcheck"
)

// NoWAFResponse is the stub's answer to GET /api/waf-detect: no WAF detected, so no
// post-scan patch generation follows.
const NoWAFResponse = `{
	"detection": {"detected": false, "wafType": "", "confidence": 0, "evidence": [], "suggestedBypassTechniques": []},
	"bypassOpportunities": {"httpMethodsBypass": false, "headerBypass": false, "encodingBypass": false, "parameterPollution": false},
	"timestamp": "2026-01-01T00:00:00.000Z"
}`

// TestingM is the part of *testing.M that Wrap needs; goleak.VerifyTestMain accepts the result.
type TestingM interface {
	Run() int
}

type wrapped struct{ m TestingM }

// Wrap returns m with Run starting a local stub of the WAF-checker API and pointing
// wafcheck's default endpoint at it for the duration of the tests. The stub is closed
// before Run returns, so a goleak check that runs afterwards does not see its goroutines.
func Wrap(m TestingM) TestingM { return wrapped{m} }

func (w wrapped) Run() int {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/waf-detect", func(rw http.ResponseWriter, _ *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		_, _ = rw.Write([]byte(NoWAFResponse))
	})
	srv := httptest.NewServer(mux)
	restore := wafcheck.SetDefaultEndpointForTesting(srv.URL)
	defer func() {
		restore()
		srv.Close()
		http.DefaultTransport.(*http.Transport).CloseIdleConnections()
	}()
	return w.m.Run()
}
