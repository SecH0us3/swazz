// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"net/http"
	"testing"

	"swazz-engine/internal/swagger"
)

func TestNewRegistry(t *testing.T) {
	r := NewRegistry()
	if r == nil {
		t.Fatal("expected registry to not be nil")
	}
	if len(r.analyzers) == 0 {
		t.Error("expected at least one analyzer registered")
	}

	// Just a simple check to see if CSPAnalyzer is registered
	foundCSP := false
	for _, a := range r.analyzers {
		if _, ok := a.(*CSPAnalyzer); ok {
			foundCSP = true
			break
		}
	}
	if !foundCSP {
		t.Error("expected CSPAnalyzer to be registered")
	}
}

func TestRegistry_Analyze(t *testing.T) {
	r := NewRegistry()

	// 1. Disabled by default
	inputDefault := &AnalysisInput{
		ResponseHeaders: http.Header{
			"Content-Type": []string{"text/html"},
		},
	}
	findingsDefault := r.Analyze(inputDefault)
	for _, f := range findingsDefault {
		if f.RuleID == "swazz/csp-missing" || f.RuleID == "swazz/x-content-type-options-missing" {
			t.Errorf("did not expect %s when security headers analysis is disabled by default", f.RuleID)
		}
	}

	// 2. Explicitly enabled
	tr := true
	inputEnabled := &AnalysisInput{
		ResponseHeaders: http.Header{
			"Content-Type": []string{"text/html"},
		},
		Settings: swagger.Settings{
			EnableSecurityHeadersAnalysis: &tr,
		},
	}

	findings := r.Analyze(inputEnabled)
	foundCSPMissing := false
	for _, f := range findings {
		if f.RuleID == "swazz/csp-missing" {
			foundCSPMissing = true
			break
		}
	}
	if !foundCSPMissing {
		t.Error("expected swazz/csp-missing finding from registry execution when enabled")
	}
}
