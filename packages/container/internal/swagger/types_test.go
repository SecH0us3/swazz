// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package swagger

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
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
			name:         "whitespace-only status is cleared",
			jsonInput:    `{"rule_id": "rule-1", "status": "   "}`,
			expectStatus: "",
			expectErr:    false,
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

func TestSettingsSerialization(t *testing.T) {
	s := DefaultSettings()
	s.ProxyList = []string{"http://127.0.0.1:8080"}
	s.RandomizeUserAgent = true
	s.EnableAdaptiveRateLimit = true

	b, err := json.Marshal(s)
	assert.NoError(t, err)

	var s2 Settings
	err = json.Unmarshal(b, &s2)
	assert.NoError(t, err)

	assert.Equal(t, s.ProxyList, s2.ProxyList)
	assert.True(t, s2.RandomizeUserAgent)
	assert.True(t, s2.EnableAdaptiveRateLimit)
}

func TestSchemaProperty_UnmarshalJSON_TypeUnion(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantType string
		wantErr  bool
	}{
		{name: "plain string type", input: `{"type":"string"}`, wantType: "string"},
		{name: "nullable union", input: `{"type":["string","null"]}`, wantType: "string"},
		{name: "null first", input: `{"type":["null","integer"]}`, wantType: "integer"},
		{name: "all null", input: `{"type":["null"]}`, wantType: ""},
		{name: "absent type", input: `{"format":"uuid"}`, wantType: ""},
		{name: "number in union", input: `{"type":["number","null"]}`, wantType: "number"},
		{name: "invalid type shape", input: `{"type":42}`, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got SchemaProperty
			err := json.Unmarshal([]byte(tt.input), &got)
			if tt.wantErr {
				assert.Error(t, err)
				return
			}
			assert.NoError(t, err)
			assert.Equal(t, tt.wantType, got.Type)
		})
	}
}

func TestSchemaProperty_UnmarshalJSON_KeepsSiblingsAndNesting(t *testing.T) {
	// The union lives on a nested property: this is the shape that broke tools/list.
	raw := `{
		"type": "object",
		"required": ["walletId"],
		"properties": {
			"walletId": {"type": ["string", "null"], "format": "uuid"},
			"tags":     {"type": "array", "items": {"type": ["string", "null"]}}
		}
	}`

	var got SchemaProperty
	assert.NoError(t, json.Unmarshal([]byte(raw), &got))

	assert.Equal(t, "object", got.Type)
	assert.Equal(t, []string{"walletId"}, got.Required)

	wallet := got.Properties["walletId"]
	assert.NotNil(t, wallet)
	assert.Equal(t, "string", wallet.Type)
	assert.Equal(t, "uuid", wallet.Format, "sibling fields must survive the custom unmarshaller")

	tags := got.Properties["tags"]
	assert.NotNil(t, tags)
	assert.Equal(t, "array", tags.Type)
	assert.NotNil(t, tags.Items)
	assert.Equal(t, "string", tags.Items.Type, "union must resolve inside items too")
}

func TestSchemaProperty_UnmarshalJSON_Polymorphic(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantType string
	}{
		{
			name:     "anyOf with scalar and null",
			input:    `{"anyOf":[{"type":"string","format":"email"},{"type":"null"}]}`,
			wantType: "string",
		},
		{
			name:     "oneOf with object",
			input:    `{"oneOf":[{"type":"integer"}]}`,
			wantType: "integer",
		},
		{
			name:     "allOf nested properties",
			input:    `{"allOf":[{"type":"object","properties":{"id":{"type":"string"}}}]}`,
			wantType: "object",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got SchemaProperty
			assert.NoError(t, json.Unmarshal([]byte(tt.input), &got))
			assert.Equal(t, tt.wantType, got.Type)
		})
	}
}
