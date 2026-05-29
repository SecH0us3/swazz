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
		expectedRule  string
		contains      string
	}{
		{
			name:          "Python traceback signature match",
			response:      "Traceback (most recent call last):\n  File \"app.py\", line 10, in <module>\n    main()\nZeroDivisionError: division by zero",
			expectedCount: 1,
			expectedRule:  "swazz/stack-trace-leak",
			contains:      "Traceback (most recent call last)",
		},
		{
			name:          "Go goroutine signature match",
			response:      "panic: runtime error: index out of range\n\ngoroutine 1 [running]:\nmain.main()",
			expectedCount: 1,
			expectedRule:  "swazz/stack-trace-leak",
			contains:      "goroutine",
		},
		{
			name:          "Java NullPointerException match",
			response:      "Exception in thread \"main\" java.lang.NullPointerException\n\tat java.base/java.util.Objects.requireNonNull(Objects.java:208)",
			expectedCount: 1,
			expectedRule:  "swazz/null-pointer-exception",
			contains:      "NullPointerException",
		},
		{
			name:          ".NET NullReferenceException match",
			response:      `System.NullReferenceException: Object reference not set to an instance of an object.\n   at Bank.Cards.API.Handler.Handle() in /builds/back/src/Bank/Cards/API/Handler.cs:line 50`,
			expectedCount: 1,
			expectedRule:  "swazz/null-pointer-exception",
			contains:      "NullReferenceException",
		},
		{
			name:          ".NET generic exception match (not NPE)",
			response:      `System.InvalidOperationException: Operation is not valid due to the current state of the object.\n   at Bank.Cards.API.Handler.Handle() in /builds/back/src/Bank/Cards/API/Handler.cs:line 50`,
			expectedCount: 1,
			expectedRule:  "swazz/stack-trace-leak",
			contains:      "Exception:",
		},
		{
			name:          "NodeJS TypeError match (Null/Undefined)",
			response:      `TypeError: Cannot read properties of null (reading 'wallet')\n   at /builds/back/bank/index.js:5:10`,
			expectedCount: 1,
			expectedRule:  "swazz/null-pointer-exception",
			contains:      "Cannot read properties",
		},
		{
			name:          "PHP Member Function on Null match",
			response:      `Fatal error: Uncaught Error: Call to a member function getBalance() on null in /var/www/bank.php:12`,
			expectedCount: 1,
			expectedRule:  "swazz/null-pointer-exception",
			contains:      "on null",
		},
		{
			name:          "Go nil pointer dereference match",
			response:      `panic: runtime error: invalid memory address or nil pointer dereference`,
			expectedCount: 1,
			expectedRule:  "swazz/null-pointer-exception",
			contains:      "nil pointer dereference",
		},
		{
			name:          ".NET stack trace - plain documentation text should not match",
			response:      `{"description": "Look at System.Configuration for more details about settings"}`,
			expectedCount: 0,
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
				if findings[0].RuleID != tt.expectedRule {
					t.Errorf("expected ruleID %s, got %s", tt.expectedRule, findings[0].RuleID)
				}
				if !strings.Contains(findings[0].Evidence, tt.contains) {
					t.Errorf("expected evidence to contain '%s', got '%s'", tt.contains, findings[0].Evidence)
				}
			}
		})
	}
}

