// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"testing"
)

func TestDPoPTamperingAnalyzer(t *testing.T) {
	analyzer := &DPoPTamperingAnalyzer{}

	tests := []struct {
		name          string
		responseBody  string
		expectFinding bool
		expectedRule  string
	}{
		{
			name:          "Clean response",
			responseBody:  `{"status":"ok","data":{"id":1}}`,
			expectFinding: false,
		},
		{
			name:          "DPoP invalid proof leak",
			responseBody:  `{"error":"invalid_dpop_proof","error_description":"DPoP signature verification failed"}`,
			expectFinding: true,
			expectedRule:  "swazz/dpop-tampering",
		},
		{
			name:          "DPoP htm claim mismatch",
			responseBody:  `DPoPProofError: htm claim mismatch: expected POST but got GET`,
			expectFinding: true,
			expectedRule:  "swazz/dpop-tampering",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := &AnalysisInput{
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
			} else {
				if len(findings) > 0 {
					t.Fatalf("unexpected finding for test %q: %v", tt.name, findings)
				}
			}
		})
	}
}
