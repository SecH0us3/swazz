// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"testing"
)

func TestNoSQLiAnalyzer(t *testing.T) {
	analyzer := &NoSQLiAnalyzer{}

	tests := []struct {
		name          string
		responseBody  string
		expectFinding bool
		expectedRule  string
	}{
		{
			name:          "Clean response",
			responseBody:  `{"status":"ok","items":[]}`,
			expectFinding: false,
		},
		{
			name:          "Mongoose CastError leak",
			responseBody:  `{"error":"CastError: Cast to ObjectId failed for value \"{\\\"$ne\\\":null}\" at path \"_id\""}`,
			expectFinding: true,
			expectedRule:  "swazz/nosql-injection",
		},
		{
			name:          "MongoDB unknown operator",
			responseBody:  `MongoServerError: unknown operator: $where at processRequest`,
			expectFinding: true,
			expectedRule:  "swazz/nosql-injection",
		},
		{
			name:          "DynamoDB ValidationException",
			responseBody:  `com.amazonaws.services.dynamodbv2.model.AmazonDynamoDBException: ValidationException: The provided key element does not match`,
			expectFinding: true,
			expectedRule:  "swazz/nosql-injection",
		},
		{
			name:          "CouchDB error leak",
			responseBody:  `{"error":"not_found","reason":"no_db_file"}`,
			expectFinding: true,
			expectedRule:  "swazz/nosql-injection",
		},
		{
			name:          "Negative generic message",
			responseBody:  `{"error":"Internal server error, please contact support"}`,
			expectFinding: false,
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
				if len(findings[0].CWEIDs) == 0 || findings[0].CWEIDs[0] != "CWE-943" {
					t.Errorf("expected CWE-943, got %v", findings[0].CWEIDs)
				}
			} else {
				if len(findings) > 0 {
					t.Fatalf("unexpected finding for test %q: %v", tt.name, findings)
				}
			}
		})
	}
}
