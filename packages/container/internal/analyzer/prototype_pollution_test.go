// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"testing"
)

func TestPrototypePollutionAnalyzer(t *testing.T) {
	analyzer := &PrototypePollutionAnalyzer{}

	tests := []struct {
		name          string
		payload       any
		responseBody  string
		expectFinding bool
		expectedRule  string
	}{
		{
			name:          "Clean response without pollution",
			payload:       `{"__proto__":{"polluted":"true"}}`,
			responseBody:  `{"status":"ok","data":{"id":123,"name":"Alice"}}`,
			expectFinding: false,
		},
		{
			name:          "Polluted property reflected in response JSON",
			payload:       `{"__proto__":{"polluted":"true"}}`,
			responseBody:  `{"status":"ok","polluted":"true","user":{"id":1}}`,
			expectFinding: true,
			expectedRule:  "swazz/prototype-pollution",
		},
		{
			name:          "Polluted boolean reflected in response JSON",
			payload:       `constructor.prototype.polluted=true`,
			responseBody:  `{"status":"ok","polluted":true,"user":{"id":1}}`,
			expectFinding: true,
			expectedRule:  "swazz/prototype-pollution",
		},
		{
			name:          "Runtime TypeError cannot assign to read only property polluted",
			payload:       `{"name":"normal"}`,
			responseBody:  `TypeError: Cannot assign to read only property 'polluted' of object '#<Object>'`,
			expectFinding: true,
			expectedRule:  "swazz/prototype-pollution",
		},
		{
			name:          "Runtime TypeError cannot create property polluted on prototype",
			payload:       `{"name":"normal"}`,
			responseBody:  `TypeError: Cannot create property 'polluted' on prototype '#<Object>'`,
			expectFinding: true,
			expectedRule:  "swazz/prototype-pollution",
		},
		{
			name:          "Negative check for random word",
			payload:       `test`,
			responseBody:  `{"message":"Invalid parameters supplied"}`,
			expectFinding: false,
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
				if len(findings[0].CWEIDs) == 0 || findings[0].CWEIDs[0] != "CWE-1321" {
					t.Errorf("expected CWE-1321, got %v", findings[0].CWEIDs)
				}
			} else {
				if len(findings) > 0 {
					t.Fatalf("unexpected finding for test %q: %v", tt.name, findings)
				}
			}
		})
	}
}
