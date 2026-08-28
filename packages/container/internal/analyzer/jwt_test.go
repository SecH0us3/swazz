// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"testing"
)

func TestJWTTamperingAnalyzer(t *testing.T) {
	analyzer := &JWTTamperingAnalyzer{}

	tests := []struct {
		name          string
		payload       any
		responseBody  string
		expectFinding bool
		expectedRule  string
	}{
		{
			name:          "Clean response",
			payload:       `Bearer valid.token.here`,
			responseBody:  `{"status":"ok"}`,
			expectFinding: false,
		},
		{
			name:          "JWT JsonWebTokenError leak",
			payload:       `Bearer invalid`,
			responseBody:  `{"error":"JsonWebTokenError: invalid signature at verifyToken"}`,
			expectFinding: true,
			expectedRule:  "swazz/jwt-tampering",
		},
		{
			name:          "JWT alg:none acceptance",
			payload:       `Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxIn0.`,
			responseBody:  `{"status":"ok","user":{"id":1,"email":"admin@example.com","roles":["admin"]}}`,
			expectFinding: true,
			expectedRule:  "swazz/jwt-tampering",
		},
		{
			name:          "JWT TokenExpiredError leak",
			payload:       `Bearer expired.jwt.here`,
			responseBody:  `{"message":"TokenExpiredError: jwt expired at 2026-08-28"}`,
			expectFinding: true,
			expectedRule:  "swazz/jwt-tampering",
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
			} else {
				if len(findings) > 0 {
					t.Fatalf("unexpected finding for test %q: %v", tt.name, findings)
				}
			}
		})
	}
}
