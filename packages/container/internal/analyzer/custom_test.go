package analyzer

import (
	"strings"
	"testing"
)

func TestCustomAnalyzer(t *testing.T) {
	// Temporarily override CustomRules for the test
	oldRules := CustomRules
	defer func() { CustomRules = oldRules }()

	CustomRules = []CustomRule{
		{
			RuleID:  "swazz/custom-test-rule",
			Level:   "warning",
			Name:    "Custom Test Pattern",
			Pattern: `(?i)secret-token-[a-f0-9]{8}`,
			Message: "Detected custom secret token leak.",
		},
	}

	a := &CustomAnalyzer{}

	t.Run("Match custom pattern", func(t *testing.T) {
		input := &AnalysisInput{
			ResponseBody: []byte(`{"token": "secret-token-abcdef12"}`),
		}
		findings := a.Analyze(input)

		if len(findings) != 1 {
			t.Fatalf("expected 1 finding, got %d", len(findings))
		}
		if findings[0].RuleID != "swazz/custom-test-rule" {
			t.Errorf("expected RuleID 'swazz/custom-test-rule', got %s", findings[0].RuleID)
		}
		if findings[0].Level != "warning" {
			t.Errorf("expected level 'warning', got %s", findings[0].Level)
		}
		if !strings.Contains(findings[0].Evidence, "secret-token-abcdef12") {
			t.Errorf("expected evidence to contain secret-token-abcdef12, got %s", findings[0].Evidence)
		}
	})

	t.Run("No match on non-matching pattern", func(t *testing.T) {
		input := &AnalysisInput{
			ResponseBody: []byte(`{"token": "secret-token-invalid"}`),
		}
		findings := a.Analyze(input)

		if len(findings) != 0 {
			t.Errorf("expected 0 findings, got %d", len(findings))
		}
	})
}

func TestDefaultCustomRules(t *testing.T) {
	a := &CustomAnalyzer{}

	t.Run("Match LFI pattern", func(t *testing.T) {
		input := &AnalysisInput{
			ResponseBody: []byte(`root:x:0:0:root:/root:/bin/bash`),
		}
		findings := a.Analyze(input)
		if len(findings) != 1 {
			t.Fatalf("expected 1 finding, got %d", len(findings))
		}
		if findings[0].RuleID != "swazz/sensitive-data-leak" {
			t.Errorf("expected RuleID 'swazz/sensitive-data-leak', got %s", findings[0].RuleID)
		}
	})

	t.Run("Match RCE pattern", func(t *testing.T) {
		input := &AnalysisInput{
			ResponseBody: []byte(`uid=0(root) gid=0(root) groups=0(root)`),
		}
		findings := a.Analyze(input)
		if len(findings) != 1 {
			t.Fatalf("expected 1 finding, got %d", len(findings))
		}
		if findings[0].RuleID != "swazz/rce-leak" {
			t.Errorf("expected RuleID 'swazz/rce-leak', got %s", findings[0].RuleID)
		}
	})
}

