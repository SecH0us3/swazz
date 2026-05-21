package swagger

import (
	"encoding/json"
	"testing"
)

func TestIsValidSpec(t *testing.T) {
	tests := []struct {
		name     string
		raw      json.RawMessage
		expected bool
	}{
		{
			name:     "valid openapi 3.0",
			raw:      json.RawMessage(`{"openapi": "3.0.0", "paths": {}}`),
			expected: true,
		},
		{
			name:     "valid swagger 2.0",
			raw:      json.RawMessage(`{"swagger": "2.0", "paths": {}}`),
			expected: true,
		},
		{
			name:     "valid graphql introspection under data",
			raw:      json.RawMessage(`{"data": {"__schema": {"types": []}}}`),
			expected: true,
		},
		{
			name:     "valid graphql introspection at root",
			raw:      json.RawMessage(`{"__schema": {"types": []}}`),
			expected: true,
		},
		{
			name:     "invalid json",
			raw:      json.RawMessage(`{invalid`),
			expected: false,
		},
		{
			name:     "random json object",
			raw:      json.RawMessage(`{"foo": "bar"}`),
			expected: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := IsValidSpec(tc.raw)
			if result != tc.expected {
				t.Errorf("expected IsValidSpec to return %v, got %v", tc.expected, result)
			}
		})
	}
}
