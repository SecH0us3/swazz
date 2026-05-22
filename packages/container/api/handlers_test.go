package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestParseSpec_Handlers(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name           string
		requestBody    map[string]any
		expectedStatus int
		verifyResponse func(t *testing.T, body string)
	}{
		{
			name: "valid openapi spec",
			requestBody: map[string]any{
				"spec": json.RawMessage(`{"openapi": "3.0.0", "info": {"title": "Test API", "version": "1.0"}, "paths": {}}`),
			},
			expectedStatus: http.StatusOK,
			verifyResponse: func(t *testing.T, body string) {
				var resp map[string]any
				if err := json.Unmarshal([]byte(body), &resp); err != nil {
					t.Fatalf("failed to parse JSON response: %v", err)
				}
				if _, ok := resp["endpoints"]; !ok {
					t.Errorf("expected endpoints field in response, got %s", body)
				}
			},
		},
		{
			name: "valid wsdl spec",
			requestBody: map[string]any{
				"spec": json.RawMessage([]byte(`"<?xml version=\"1.0\"?><definitions name=\"TestService\" targetNamespace=\"http://example.com\" xmlns=\"http://schemas.xmlsoap.org/wsdl/\"><portType name=\"TestPort\"></portType></definitions>"`)),
			},
			expectedStatus: http.StatusOK,
			verifyResponse: func(t *testing.T, body string) {
				var resp map[string]any
				if err := json.Unmarshal([]byte(body), &resp); err != nil {
					t.Fatalf("failed to parse JSON response: %v", err)
				}
				if _, ok := resp["endpoints"]; !ok {
					t.Errorf("expected endpoints field in response, got %s", body)
				}
			},
		},
		{
			name: "invalid wsdl spec returns 422",
			requestBody: map[string]any{
				"spec": json.RawMessage([]byte(`"<?xml version=\"1.0\"?><definitions name=\"TestService\"><unclosedTag"`)), // invalid xml structure but matches IsWSDL
			},
			expectedStatus: http.StatusUnprocessableEntity,
			verifyResponse: func(t *testing.T, body string) {
				var resp map[string]any
				if err := json.Unmarshal([]byte(body), &resp); err != nil {
					t.Fatalf("failed to parse JSON response: %v", err)
				}
				errStr, ok := resp["error"].(string)
				if !ok {
					t.Fatalf("expected error field in response, got %s", body)
				}
				expectedSubstr := "failed to parse spec as WSDL"
				if !bytes.Contains([]byte(errStr), []byte(expectedSubstr)) {
					t.Errorf("expected error message to contain %q, got %q", expectedSubstr, errStr)
				}
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			handler := NewHandler()
			router := gin.New()
			router.POST("/api/parse", handler.ParseSpec)

			bodyBytes, err := json.Marshal(tc.requestBody)
			if err != nil {
				t.Fatalf("failed to marshal request body: %v", err)
			}

			w := httptest.NewRecorder()
			req, err := http.NewRequest("POST", "/api/parse", bytes.NewBuffer(bodyBytes))
			if err != nil {
				t.Fatalf("failed to create request: %v", err)
			}
			req.Header.Set("Content-Type", "application/json")

			router.ServeHTTP(w, req)

			if w.Code != tc.expectedStatus {
				t.Errorf("expected status %d, got %d. Body: %s", tc.expectedStatus, w.Code, w.Body.String())
			}

			if tc.verifyResponse != nil {
				tc.verifyResponse(t, w.Body.String())
			}
		})
	}
}
