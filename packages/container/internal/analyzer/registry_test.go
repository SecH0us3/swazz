package analyzer

import (
	"net/http"
	"testing"
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
	
	// Test running with empty input (should execute all analyzers and not crash)
	input := &AnalysisInput{
		ResponseHeaders: http.Header{
			"Content-Type": []string{"text/html"},
		},
	}
	
	findings := r.Analyze(input)
	// We expect at least the CSP analyzer to find missing CSP header
	foundCSPMissing := false
	for _, f := range findings {
		if f.RuleID == "swazz/csp-missing" {
			foundCSPMissing = true
			break
		}
	}
	if !foundCSPMissing {
		t.Error("expected swazz/csp-missing finding from registry execution")
	}
}
