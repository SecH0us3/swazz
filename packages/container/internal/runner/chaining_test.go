package runner

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"swazz-engine/internal/swagger"
)

func TestStatefulChaining(t *testing.T) {
	mux := http.NewServeMux()
	
	mux.HandleFunc("/login", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Custom-Token", "header-token-123")
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":{"userId": 42}, "session": "json-session-abc"}`))
	})
	
	mux.HandleFunc("/profile/42", func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if auth != "Bearer header-token-123" {
			t.Errorf("Missing or incorrect Authorization header: %s", auth)
		}
		if r.Header.Get("X-Session") != "json-session-abc" {
			t.Errorf("Missing or incorrect X-Session header: %s", r.Header.Get("X-Session"))
		}
		w.WriteHeader(200)
	})

	ts := httptest.NewServer(mux)
	defer ts.Close()

	settings := swagger.DefaultSettings()
	
	settings.ChainingRules = []swagger.ChainingRule{
		{
			SourceEndpoint: "/login",
			ExtractType:    "json",
			ExtractPath:    "data.userId",
			VariableName:   "USER_ID",
		},
		{
			SourceEndpoint: "/login",
			ExtractType:    "json",
			ExtractPath:    "session",
			VariableName:   "SESSION_ID",
		},
		{
			SourceEndpoint: "/login",
			ExtractType:    "header",
			ExtractPath:    "X-Custom-Token",
			VariableName:   "AUTH_TOKEN",
		},
	}
	settings.Profiles = []swagger.FuzzingProfile{swagger.ProfileRandom}
	settings.IterationsPerProfile = 1

	config := &swagger.Config{
		BaseURL: ts.URL,
		GlobalHeaders: map[string]string{
			"Authorization": "Bearer {{AUTH_TOKEN}}",
			"X-Session":     "{{SESSION_ID}}",
		},
		Settings: settings,
		Security: swagger.SecurityConfig{AllowPrivateIPs: true},
		Endpoints: []swagger.EndpointConfig{
			{
				Path:   "/login",
				Method: "POST",
			},
			{
				Path:   "/profile/{{USER_ID}}",
				Method: "GET",
			},
		},
	}

	runner := New(config, ts.Client())
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := runner.Start(ctx)
	if err != nil {
		t.Fatalf("Runner failed: %v", err)
	}

	runner.stateMu.RLock()
	if runner.state["USER_ID"] != "42" {
		t.Errorf("Expected USER_ID to be 42, got %v", runner.state["USER_ID"])
	}
	if runner.state["SESSION_ID"] != "json-session-abc" {
		t.Errorf("Expected SESSION_ID to be json-session-abc, got %v", runner.state["SESSION_ID"])
	}
	if runner.state["AUTH_TOKEN"] != "header-token-123" {
		t.Errorf("Expected AUTH_TOKEN to be header-token-123, got %v", runner.state["AUTH_TOKEN"])
	}
	runner.stateMu.RUnlock()
}
