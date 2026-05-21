package runner

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"swazz-engine/internal/swagger"
	"testing"
)

func TestRunAuthSequence(t *testing.T) {
	// 1. Setup mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/login" {
			// Set some cookies
			http.SetCookie(w, &http.Cookie{Name: "session", Value: "secret-session"})
			http.SetCookie(w, &http.Cookie{Name: "ignore-me", Value: "trash"})

			// Return JSON with token
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]string{
					"token":  "bearer-123",
					"user":   "admin",
					"userId": "999",
				},
			})
			return
		}
		if r.URL.Path == "/verify/999" {
			// Check if we got the session cookie and the header from previous step
			cookie, err := r.Cookie("session")
			if err != nil || cookie.Value != "secret-session" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			auth := r.Header.Get("Authorization")
			if auth != "bearer-123" {
				w.WriteHeader(http.StatusForbidden)
				return
			}

			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	// 2. Define config
	cfg := &swagger.Config{
		BaseURL: server.URL,
		AuthSequence: []swagger.AuthStep{
			{
				Method:         "POST",
				URL:            "/login",
				Body:           map[string]string{"user": "admin"},
				ExtractCookies: []string{"session"}, // Ignore "ignore-me"
				ExtractJSON: map[string]string{
					"data.token": "Authorization",
				},
				ExtractVariables: map[string]string{
					"data.userId": "user_id",
				},
			},
			{
				Method: "GET",
				URL:    "/verify/{{user_id}}",
			},
		},
	}

	// 3. Run runner
	r := New(cfg, nil)
	err := r.RunAuthSequence(context.Background())

	if err != nil {
		t.Fatalf("Auth sequence failed: %v", err)
	}

	// 4. Verify results
	if cfg.Cookies["session"] != "secret-session" {
		t.Errorf("Expected cookie 'session' to be 'secret-session', got '%s'", cfg.Cookies["session"])
	}
	if _, ok := cfg.Cookies["ignore-me"]; ok {
		t.Errorf("Cookie 'ignore-me' should have been filtered out")
	}
	if cfg.GlobalHeaders["Authorization"] != "bearer-123" {
		t.Errorf("Expected header 'Authorization' to be 'bearer-123', got '%s'", cfg.GlobalHeaders["Authorization"])
	}
}

func TestRunAuthSequenceFailures(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("crash"))
	}))
	defer server.Close()

	cfg := &swagger.Config{
		BaseURL: server.URL,
		AuthSequence: []swagger.AuthStep{
			{Method: "GET", URL: "/fail"},
		},
	}

	r := New(cfg, nil)
	err := r.RunAuthSequence(context.Background())

	if err == nil {
		t.Fatal("Expected error for 500 status code, got nil")
	}
}
