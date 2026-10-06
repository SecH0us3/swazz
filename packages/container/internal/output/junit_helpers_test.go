// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package output

import (
	"strings"
	"testing"

	"swazz-engine/internal/classifier"
	"swazz-engine/internal/swagger"
)

func TestFormatDurationSec(t *testing.T) {
	t.Parallel()
	if got := formatDurationSec(1500); got != "1.500" {
		t.Errorf("formatDurationSec(1500) = %q, want 1.500", got)
	}
	if got := formatDurationSec(0); got != "0.000" {
		t.Errorf("formatDurationSec(0) = %q, want 0.000", got)
	}
}

func TestComputeTopTime(t *testing.T) {
	t.Parallel()
	// No stats -> falls back to the provided duration.
	if got := computeTopTime(nil, 2000); got != "2.000" {
		t.Errorf("computeTopTime(nil, 2000) = %q, want 2.000", got)
	}
	// StartTime unset -> fallback as well.
	if got := computeTopTime(&swagger.RunStats{}, 3000); got != "3.000" {
		t.Errorf("computeTopTime(zero-start, 3000) = %q, want 3.000", got)
	}
	// StartTime set -> elapsed is computed from now; just assert it parses as seconds.
	got := computeTopTime(&swagger.RunStats{StartTime: 1}, 9999)
	if !strings.Contains(got, ".") {
		t.Errorf("computeTopTime with StartTime should produce a seconds string, got %q", got)
	}
	if got == "9.999" {
		t.Errorf("computeTopTime with StartTime should not use the fallback duration")
	}
}

func TestFormatFailureBody(t *testing.T) {
	t.Parallel()
	// Byte-slice payload is rendered as a string; error becomes evidence.
	bodyBytes := formatFailureBody(&classifier.Finding{
		RuleID:  "swazz/reflected-xss",
		Level:   classifier.SeverityError,
		Error:   "payload reflected",
		Payload: []byte("<script>"),
	})
	for _, want := range []string{"Rule: swazz/reflected-xss", "Evidence: payload reflected", "Payload: <script>"} {
		if !strings.Contains(bodyBytes, want) {
			t.Errorf("formatFailureBody missing %q in:\n%s", want, bodyBytes)
		}
	}

	// Non-byte payload uses the %v default branch; no error -> no Evidence line.
	bodyAny := formatFailureBody(&classifier.Finding{
		RuleID:  "swazz/status-500",
		Level:   classifier.SeverityWarning,
		Payload: map[string]int{"n": 1},
	})
	if strings.Contains(bodyAny, "Evidence:") {
		t.Errorf("formatFailureBody should omit Evidence when Error is empty:\n%s", bodyAny)
	}
	if !strings.Contains(bodyAny, "Payload: map[n:1]") {
		t.Errorf("formatFailureBody should render non-byte payload with %%v:\n%s", bodyAny)
	}
}
