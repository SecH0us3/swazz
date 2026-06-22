package swagger

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type mockRoundTripper func(req *http.Request) (*http.Response, error)

func (f mockRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

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
			name:     "invalid json (missing closing brace)",
			raw:      json.RawMessage(`{"foo": "bar"`),
			expected: false,
		},
		{
			name:     "random json object (lacks spec identifier)",
			raw:      json.RawMessage(`{"foo": "bar", "extra_field": 1}`),
			expected: false, // Should fail validation unless it's a known format
		},
		{
			name:     "empty raw message",
			raw:      json.RawMessage(`{}`), // Empty object is valid JSON but lacks spec identifier
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
		raw      string
		expected bool
	}{
		{
			name:     "valid wsdl XML standard",
			raw:      `<?xml version="1.0"?><definitions name="StockQuote" targetNamespace="http://example.com/stockquote.wsdl" xmlns:tns="http://example.com/stockquote.wsdl" xmlns:xsd1="http://example.com/stockquote.xsd" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns="http://schemas.xmlsoap.org/wsdl/"></definitions>`,
			expected: true,
		},
		{
			name:     "valid wsdl with prefix",
			raw:      `<wsdl:definitions name="StockQuote"></wsdl:definitions>`,
			expected: true,
		},
		{
			name:     "invalid non-xml",
			raw:      `not xml at all`,
			expected: false,
		},
		{
			name:     "xml but not wsdl (missing definitions tag)",
			raw:      `<?xml version="1.0"?><note><body>Hello</body></note>`,
			expected: false,
		},
		{
			name:     "empty string",
			raw:      ``,
			expected: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := IsWSDL([]byte(tc.raw))
			if result != tc.expected {
				t.Errorf("expected IsWSDL to return %v, got %v", tc.expected, result)
			}
		})
	}
}

func TestIsPostman(t *testing.T) {
	tests := []struct {
		name     string
		raw      string
		expected bool
	}{
		{
			name: "valid postman schema",
			raw: `{
				"info": {
					"name": "Test",
					"schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
				},
				"item": []
			}`,
			expected: true,
		},
		{
			name: "valid postman schema generic non-empty",
			raw: `{
				"info": {
					"name": "Test",
					"schema": "some-schema"
				},
				"item": []
			}`,
			expected: true,
		},
		{
			name:     "invalid json",
			raw:      `bad json`,
			expected: false,
		},
		{
			name: "missing info field",
			raw: `{
				"item": []
			}`,
			expected: false,
		},
		{
			name: "missing item array",
			raw: `{
				"info": {
					"name": "Test",
					"schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
				}
			}`,
			expected: false,
		},
		{
			name:     "empty string input",
			raw:      ``,
			expected: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := IsPostman([]byte(tc.raw))
			if result != tc.expected {
				t.Errorf("expected IsPostman to return %v, got %v for %s", tc.expected, result, tc.name)
			}
		})
	}
}

func TestFetchRemoteSpec(t *testing.T) {
	// Setup test mock server (Kept)
	var getHandler func(w http.ResponseWriter, r *http.Request)
	var postHandler func(w http.ResponseWriter, r *http.Request)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			if getHandler != nil {
				getHandler(w, r)
				return
			}