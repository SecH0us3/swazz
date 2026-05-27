package analyzer

import (
	"strings"
	"testing"
)

func TestStackTraceAnalyzer(t *testing.T) {
	a := &StackTraceAnalyzer{}

	tests := []struct {
		name          string
		response      string
		expectedCount int
		contains      string
	}{
		{
			name:          "Python traceback signature match",
			response:      "Traceback (most recent call last):\n  File \"app.py\", line 10, in <module>\n    main()\nZeroDivisionError: division by zero",
			expectedCount: 1,
			contains:      "Traceback (most recent call last)",
		},
		{
			name:          "Go goroutine signature match",
			response:      "panic: runtime error: index out of range\n\ngoroutine 1 [running]:\nmain.main()",
			expectedCount: 1,
			contains:      "goroutine",
		},
		{
			name:          "Java stack trace signature match",
			response:      "Exception in thread \"main\" java.lang.NullPointerException\n\tat java.base/java.util.Objects.requireNonNull(Objects.java:208)",
			expectedCount: 1,
			contains:      "at java.",
		},
		{
			name:          "No match on regular response",
			response:      `{"status":"ok"}`,
			expectedCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := &AnalysisInput{
				ResponseBody: []byte(tt.response),
			}
			findings := a.Analyze(input)
			if len(findings) != tt.expectedCount {
				t.Errorf("expected %d findings, got %d", tt.expectedCount, len(findings))
			}
			if len(findings) > 0 {
				if findings[0].RuleID != "swazz/stack-trace-leak" {
					t.Errorf("expected ruleID swazz/stack-trace-leak, got %s", findings[0].RuleID)
				}
				if !strings.Contains(findings[0].Evidence, tt.contains) {
					t.Errorf("expected evidence to contain '%s', got '%s'", tt.contains, findings[0].Evidence)
				}
			}
		})
	}
}
