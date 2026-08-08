// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package triage

import (
	"testing"
)

func TestParseResponse_ValidJSON(t *testing.T) {
	raw := `{"classification": "false_positive", "confidence": 90, "reasoning": "Standard validation error"}`
	verdict, err := ParseResponse(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if verdict.Classification != "false_positive" {
		t.Errorf("expected false_positive, got %s", verdict.Classification)
	}
	if verdict.Confidence != 90 {
		t.Errorf("expected confidence 90, got %d", verdict.Confidence)
	}
}

func TestParseResponse_MarkdownStripping(t *testing.T) {
	raw := "```json\n{\n  \"classification\": \"true_positive\",\n  \"confidence\": 95,\n  \"reasoning\": \"SQL syntax error in response body\"\n}\n```"
	verdict, err := ParseResponse(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if verdict.Classification != "true_positive" {
		t.Errorf("expected true_positive, got %s", verdict.Classification)
	}
	if verdict.Confidence != 95 {
		t.Errorf("expected 95, got %d", verdict.Confidence)
	}
}

func TestParseResponse_ConfidenceClamping(t *testing.T) {
	raw := `{"classification": "false_positive", "confidence": 150, "reasoning": "High confidence"}`
	verdict, err := ParseResponse(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if verdict.Confidence != 100 {
		t.Errorf("expected confidence clamped to 100, got %d", verdict.Confidence)
	}
}

func TestParseResponse_InvalidJSON(t *testing.T) {
	raw := `not a json response`
	_, err := ParseResponse(raw)
	if err == nil {
		t.Errorf("expected error for invalid JSON")
	}
}
