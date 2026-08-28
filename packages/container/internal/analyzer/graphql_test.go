// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"testing"
)

func TestGraphQLSecurityAnalyzer(t *testing.T) {
	analyzer := &GraphQLSecurityAnalyzer{}

	tests := []struct {
		name          string
		responseBody  string
		expectFinding bool
		expectedRule  string
	}{
		{
			name:          "Clean GraphQL query response",
			responseBody:  `{"data":{"user":{"id":"1","name":"Alice"}}}`,
			expectFinding: false,
		},
		{
			name:          "GraphQL Introspection Schema leak",
			responseBody:  `{"data":{"__schema":{"queryType":{"name":"Query"},"types":[]}}}`,
			expectFinding: true,
			expectedRule:  "swazz/graphql-introspection-leak",
		},
		{
			name:          "GraphQL Field suggestion leak",
			responseBody:  `{"errors":[{"message":"Cannot query field \"passwrd\" on type \"User\". Did you mean \"password\"?"}]}`,
			expectFinding: true,
			expectedRule:  "swazz/graphql-field-suggestion",
		},
		{
			name:          "GraphQL Query complexity limit error",
			responseBody:  `{"errors":[{"message":"Max query depth exceeded: limit is 5"}]}`,
			expectFinding: true,
			expectedRule:  "swazz/graphql-complexity-limit",
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
