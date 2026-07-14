package swagger

import (
	"encoding/json"
	"testing"
)

func TestIgnoreRule_UnmarshalJSON(t *testing.T) {
	tests := []struct {
		name        string
		jsonInput   string
		expectStatus string
		expectErr   bool
	}{
		{
			name:         "status as integer",
			jsonInput:    `{"rule_id": "rule-1", "status": 400}`,
			expectStatus: "400",
			expectErr:    false,
		},
		{
			name:         "status as string",
			jsonInput:    `{"rule_id": "rule-1", "status": "400"}`,
			expectStatus: "400",
			expectErr:    false,
		},
		{
			name:         "status as range string",
			jsonInput:    `{"rule_id": "rule-1", "status": "4xx"}`,
			expectStatus: "4xx",
			expectErr:    false,
		},
		{
			name:         "status_code as integer",
			jsonInput:    `{"rule_id": "rule-1", "status_code": 500}`,
			expectStatus: "500",
			expectErr:    false,
		},
		{
			name:         "status_code as string",
			jsonInput:    `{"rule_id": "rule-1", "status_code": "500"}`,
			expectStatus: "500",
			expectErr:    false,
		},
		{
			name:         "status_code as range string",
			jsonInput:    `{"rule_id": "rule-1", "status_code": "5xx"}`,
			expectStatus: "5xx",
			expectErr:    false,
		},
		{
			name:         "status takes precedence over status_code",
			jsonInput:    `{"rule_id": "rule-1", "status": 400, "status_code": 500}`,
			expectStatus: "400",
			expectErr:    false,
		},
		{
			name:         "no status or status_code",
			jsonInput:    `{"rule_id": "rule-1"}`,
			expectStatus: "",
			expectErr:    false,
		},
		{
			name:         "invalid type for status",
			jsonInput:    `{"rule_id": "rule-1", "status": true}`,
			expectStatus: "",
			expectErr:    true,
		},
		{
			name:         "invalid type for status_code",
			jsonInput:    `{"rule_id": "rule-1", "status_code": [1, 2]}`,
			expectStatus: "",
			expectErr:    true,
		},
		{
			name:         "invalid status string format",
			jsonInput:    `{"rule_id": "rule-1", "status": "4abc"}`,
			expectStatus: "",
			expectErr:    true,
		},
		{
			name:         "invalid status wildcard pattern",
			jsonInput:    `{"rule_id": "rule-1", "status": "4yy"}`,
			expectStatus: "",
			expectErr:    true,
		},
		{
			name:         "invalid status too long",
			jsonInput:    `{"rule_id": "rule-1", "status": 2000}`,
			expectStatus: "",
			expectErr:    true,
		},
		{
			name:         "valid status 0",
			jsonInput:    `{"rule_id": "rule-1", "status": 0}`,
			expectStatus: "0",
			expectErr:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var rule IgnoreRule
			err := json.Unmarshal([]byte(tt.jsonInput), &rule)
			if (err != nil) != tt.expectErr {
				t.Fatalf("json.Unmarshal() error = %v, expectErr = %v", err, tt.expectErr)
			}
			if !tt.expectErr {
				if rule.Status != tt.expectStatus {
					t.Errorf("expected Status = %q, got %q", tt.expectStatus, rule.Status)
				}
				if rule.RuleID != "rule-1" {
					t.Errorf("expected RuleID = %q, got %q", "rule-1", rule.RuleID)
				}
			}
		})
	}
}
