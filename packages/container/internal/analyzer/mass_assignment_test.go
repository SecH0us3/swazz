// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"testing"
)

func TestMassAssignmentAnalyzer(t *testing.T) {
	analyzer := &MassAssignmentAnalyzer{}

	tests := []struct {
		name          string
		payload       any
		responseBody  string
		expectFinding bool
		expectedRule  string
	}{
		{
			name:          "Clean response",
			payload:       `{"name":"Alice"}`,
			responseBody:  `{"status":"ok","user":{"name":"Alice"}}`,
			expectFinding: false,
		},
		{
			name:          "Reflected role: admin escalation",
			payload:       `{"name":"Alice","role":"admin"}`,
			responseBody:  `{"id":10,"name":"Alice","role":"admin","created_at":"2026-08-28"}`,
			expectFinding: true,
			expectedRule:  "swazz/mass-assignment",
		},
		{
			name:          "Reflected is_admin: true escalation",
			payload:       `{"name":"Bob","is_admin":true}`,
			responseBody:  `{"id":11,"name":"Bob","is_admin":true}`,
			expectFinding: true,
			expectedRule:  "swazz/mass-assignment",
		},
		{
			name:          "Reflected permissions: [*]",
			payload:       `{"name":"Charlie","permissions":["*"]}`,
			responseBody:  `{"id":12,"name":"Charlie","permissions":["*"]}`,
			expectFinding: true,
			expectedRule:  "swazz/mass-assignment",
		},
		{
			name:          "ActiveRecord UnknownAttributeError",
			payload:       `{"name":"Dave"}`,
			responseBody:  `ActiveRecord::UnknownAttributeError: unknown attribute 'role' for User`,
			expectFinding: true,
			expectedRule:  "swazz/mass-assignment",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := &AnalysisInput{
				SentPayload:  tt.payload,
				ResponseBody: []byte(tt.responseBody),
			}
			findings := analyzer.Analyze(input)
			if tt.expectFinding {
				if len(findings) == 0 {
					t.Fatalf("expected finding for test %q, got none", tt.name)
				}
				if findings[0].RuleID != tt.expectedRule {
					t.Errorf("expected rule ID %q, got %q", tt.expectedRule, findings[0].RuleID)
				}
				if len(findings[0].CWEIDs) == 0 || findings[0].CWEIDs[0] != "CWE-915" {
					t.Errorf("expected CWE-915, got %v", findings[0].CWEIDs)
				}
			} else {
				if len(findings) > 0 {
					t.Fatalf("unexpected finding for test %q: %v", tt.name, findings)
				}
			}
		})
	}
}
