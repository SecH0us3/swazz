// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"net/http"
	"testing"
)

func TestWSStatusAnalyzer(t *testing.T) {
	analyzer := NewWSStatusAnalyzer()

	t.Run("ignore non-ws", func(t *testing.T) {
		h := http.Header{}
		h.Set("X-Swazz-WS-Status", "500")
		input := &AnalysisInput{
			Method:          "GET",
			Endpoint:        "http://example.com/api",
			ResponseHeaders: h,
		}
		findings := analyzer.Analyze(input)
		if len(findings) > 0 {
			t.Errorf("expected 0 findings, got %d", len(findings))
		}
	})

	t.Run("detect ws 500 status", func(t *testing.T) {
		h := http.Header{}
		h.Set("X-Swazz-WS-Status", "500")
		h.Set("X-Swazz-WS-Error", "abnormal closure")
		input := &AnalysisInput{
			Method:          "WS",
			Endpoint:        "ws://example.com/api",
			ResponseHeaders: h,
		}
		findings := analyzer.Analyze(input)
		if len(findings) != 1 {
			t.Fatalf("expected 1 finding, got %d", len(findings))
		}
		if findings[0].RuleID != "swazz/ws-crash-detected" {
			t.Errorf("expected rule swazz/ws-crash-detected, got %s", findings[0].RuleID)
		}
	})

	t.Run("detect ws panic in body", func(t *testing.T) {
		input := &AnalysisInput{
			Method:          "WS",
			Endpoint:        "ws://example.com/api",
			ResponseBody:    []byte("panic: index out of range"),
			ResponseHeaders: http.Header{},
		}
		findings := analyzer.Analyze(input)
		if len(findings) != 1 {
			t.Fatalf("expected 1 finding, got %d", len(findings))
		}
		if findings[0].RuleID != "swazz/ws-internal-error-leak" {
			t.Errorf("expected rule swazz/ws-internal-error-leak, got %s", findings[0].RuleID)
		}
	})

	t.Run("detect ws EOF drop", func(t *testing.T) {
		h := http.Header{}
		h.Set("X-Swazz-WS-Error", "read: connection reset by peer")
		input := &AnalysisInput{
			Method:          "WS",
			Endpoint:        "ws://example.com/api",
			ResponseHeaders: h,
		}
		findings := analyzer.Analyze(input)
		if len(findings) != 1 {
			t.Fatalf("expected 1 finding, got %d", len(findings))
		}
		if findings[0].RuleID != "swazz/ws-eof-drop" {
			t.Errorf("expected rule swazz/ws-eof-drop, got %s", findings[0].RuleID)
		}
	})
}
