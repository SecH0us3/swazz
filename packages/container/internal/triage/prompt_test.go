// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package triage

import (
	"strings"
	"testing"

	"swazz-engine/internal/swagger"
)

func TestBuildPrompt_TruncationAndContext(t *testing.T) {
	finding := &swagger.AnalysisFinding{
		RuleID:   "swazz/500-error",
		Level:    "error",
		Message:  "Server returned HTTP 500",
		Evidence: "Internal Server Error in /api/users",
	}

	largeBody := strings.Repeat("A", 3000)
	result := &swagger.FuzzResult{
		Method:       "GET",
		Endpoint:     "/api/users",
		Status:       500,
		ResponseSize: 3000,
		Duration:     150,
		ResponseBody: largeBody,
	}

	prompt := BuildPrompt(finding, result)

	if !strings.Contains(prompt, "<untrusted-scan-context>") {
		t.Errorf("expected prompt to contain untrusted-scan-context delimiter")
	}
	if !strings.Contains(prompt, "... [truncated]") {
		t.Errorf("expected prompt response body to be truncated")
	}
	if len(prompt) > 4000 {
		t.Errorf("expected prompt size to be reasonable after truncation, got %d", len(prompt))
	}
}
