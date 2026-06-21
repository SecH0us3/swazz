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
			name:     "xml but not wsdl",
			raw:      `<?xml version="1.0"?><note><body>Hello</body></note>`,
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
			name: "missing info",
			raw: `{
				"item": []
			}`,
			expected: false,
		},
		{
			name: "missing item",
			raw: `{
				"info": {
					"name": "Test",
					"schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
				}
			}`,
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
	// Setup test mock server
	var getHandler func(w http.ResponseWriter, r *http.Request)
	var postHandler func(w http.ResponseWriter, r *http.Request)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			if getHandler != nil {
				getHandler(w, r)
				return
			}
			w.WriteHeader(http.StatusMethodNotAllowed)
		} else if r.Method == "POST" {
			if postHandler != nil {
				postHandler(w, r)
				return
			}
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	defer server.Close()

	ctx := context.Background()
	client := server.Client()

	t.Run("GET returns valid OpenAPI spec", func(t *testing.T) {
		getHandler = func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"openapi": "3.0.0", "paths": {}}`))
		}
		postHandler = nil

		res, err := FetchRemoteSpec(ctx, client, server.URL, nil, "introspection")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !IsValidSpec(res) {
			t.Error("expected valid spec in result")
		}
	})

	t.Run("GET returns valid YAML OpenAPI spec (different MIME types)", func(t *testing.T) {
		mimeTypes := []string{"application/yaml", "application/x-yaml", "text/yaml", "text/x-yaml"}
		for _, mt := range mimeTypes {
			t.Run("MIME type: "+mt, func(t *testing.T) {
				getHandler = func(w http.ResponseWriter, r *http.Request) {
					// Verify custom headers are passed
					if r.Header.Get("X-Custom-Req-Header") != "ReqValue" {
						t.Errorf("expected X-Custom-Req-Header to be 'ReqValue'")
					}
					// Verify Accept header contains application/yaml
					accept := r.Header.Get("Accept")
					if !strings.Contains(accept, "application/yaml") {
						t.Errorf("expected Accept header to contain application/yaml, got %s", accept)
					}
					w.Header().Set("Content-Type", mt)
					w.WriteHeader(http.StatusOK)
					w.Write([]byte("openapi: 3.0.0\npaths: {}"))
				}
				postHandler = nil

				res, err := FetchRemoteSpec(ctx, client, server.URL, map[string]string{"X-Custom-Req-Header": "ReqValue"}, "introspection")
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if !IsValidSpec(res) {
					t.Error("expected valid spec in result after YAML-to-JSON conversion")
				}
			})
		}
	})

	t.Run("GET returns valid YAML OpenAPI spec by extension", func(t *testing.T) {
		getHandler = func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("openapi: 3.0.0\npaths: {}"))
		}
		postHandler = nil

		res, err := FetchRemoteSpec(ctx, client, server.URL+"/spec.yaml", nil, "introspection")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !IsValidSpec(res) {
			t.Error("expected valid spec in result after YAML-to-JSON conversion")
		}

		resYml, err := FetchRemoteSpec(ctx, client, server.URL+"/spec.yml", nil, "introspection")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !IsValidSpec(resYml) {
			t.Error("expected valid spec in result after YAML-to-JSON conversion for .yml")
		}
	})

	t.Run("GET fails, POST returns valid spec", func(t *testing.T) {
		getHandler = func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}
		postHandler = func(w http.ResponseWriter, r *http.Request) {
			// Verify POST body has JSON query
			var bodyMap map[string]string
			if err := json.NewDecoder(r.Body).Decode(&bodyMap); err != nil {
				t.Errorf("failed to decode post body: %v", err)
			}
			if bodyMap["query"] != "introspection" {
				t.Errorf("expected introspection query, got %v", bodyMap["query"])
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"openapi": "3.0.0", "paths": {}}`))
		}

		res, err := FetchRemoteSpec(ctx, client, server.URL, map[string]string{"X-Custom-Header": "PostmanTest"}, "introspection")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !IsValidSpec(res) {
			t.Error("expected valid spec in result")
		}
	})

	t.Run("GET returns invalid spec but 200, POST returns valid spec", func(t *testing.T) {
		getHandler = func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"invalid": "spec"}`))
		}
		postHandler = func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"openapi": "3.0.0", "paths": {}}`))
		}

		res, err := FetchRemoteSpec(ctx, client, server.URL, nil, "introspection")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !IsValidSpec(res) {
			t.Error("expected valid spec in result")
		}
	})

	t.Run("GET returns invalid spec 200, POST fails, should return GET body", func(t *testing.T) {
		getHandler = func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"invalid": "but-returned-anyway"}`))
		}
		postHandler = func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}

		res, err := FetchRemoteSpec(ctx, client, server.URL, nil, "introspection")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if string(res) != `{"invalid": "but-returned-anyway"}` {
			t.Errorf("expected original GET body, got %s", string(res))
		}
	})

	t.Run("GET returns invalid spec, POST returns network error, returns GET body", func(t *testing.T) {
		customClient := &http.Client{
			Transport: mockRoundTripper(func(req *http.Request) (*http.Response, error) {
				if req.Method == "GET" {
					resp := &http.Response{
						StatusCode: http.StatusOK,
						Body:       io.NopCloser(bytes.NewBufferString(`{"invalid": "spec"}`)),
					}
					return resp, nil
				}
				return nil, fmt.Errorf("network connection refused")
			}),
		}

		res, err := FetchRemoteSpec(ctx, customClient, "http://example.com/spec", map[string]string{"X-Test": "Val"}, "introspection")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if string(res) != `{"invalid": "spec"}` {
			t.Errorf("expected GET body, got %s", string(res))
		}
	})

	t.Run("GET fails completely, POST fails completely", func(t *testing.T) {
		getHandler = func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}
		postHandler = func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNotFound)
		}

		_, err := FetchRemoteSpec(ctx, client, server.URL, nil, "introspection")
		if err == nil {
			t.Fatal("expected error but got nil")
		}
	})
}

func TestIsHAR(t *testing.T) {
	raw := []byte(`{"log":{"version":"1.2","creator":{"name":"Swazz HAR Generator","version":"1.0"},"entries":[{"request":{"method":"GET","url":"http://127.0.0.1:8788/welcome","queryString":[]}},{"request":{"method":"GET","url":"http://127.0.0.1:8788/users","queryString":[]}},{"request":{"method":"GET","url":"http://127.0.0.1:8788/api/goods","queryString":[{"name":"limit","value":"10"}]}}]}}`)
	if !IsHAR(raw) {
		t.Errorf("IsHAR failed to detect valid HAR spec")
	}
}
