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

func TestIsWSDL(t *testing.T) {
	tests := []struct {
		name     string
		raw      []byte
		expected bool
	}{
		{
			name:     "valid simple wsdl with definitions",
			raw:      []byte(`<?xml version="1.0"?><definitions name="TestService"></definitions>`),
			expected: true,
		},
		{
			name:     "valid namespace prefixed wsdl definitions",
			raw:      []byte(`<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" name="TestService"></wsdl:definitions>`),
			expected: true,
		},
		{
			name:     "arbitrary xml but not wsdl",
			raw:      []byte(`<?xml version="1.0"?><hello><world/></hello>`),
			expected: false,
		},
		{
			name:     "invalid xml structure",
			raw:      []byte(`<?xml version="1.0"?><definitions`),
			expected: false,
		},
		{
			name:     "json content",
			raw:      []byte(`{"definitions": {}}`),
			expected: false,
		},
		{
			name:     "empty content",
			raw:      []byte(``),
			expected: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := IsWSDL(tc.raw)
			if result != tc.expected {
				t.Errorf("expected IsWSDL to return %v, got %v", tc.expected, result)
			}
		})
	}
}

