package runner

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"swazz-engine/internal/swagger"
)

func TestExecuteRequest_ErrorPath(t *testing.T) {
	runner := &Runner{
		client: &http.Client{
			Timeout: 1 * time.Millisecond,
			Transport: &http.Transport{
				DialContext: nil,
			},
		},
		config: &swagger.Config{
			Settings: swagger.Settings{
				TimeoutMs: 1000,
			},
		},
	}

	// Test with invalid URL to ensure client.Do fails immediately
	res := runner.executeRequest(
		context.Background(),
		"http://invalid.local::invalid", "/test", "/test", "GET",
		nil, nil, nil, swagger.ProfileRandom, nil, nil, "",
	)

	if res == nil {
		t.Fatal("Expected FuzzResult, got nil")
	}

	if res.Status != 0 {
		t.Errorf("Expected Status 0, got %d", res.Status)
	}

	if res.Error == "" {
		t.Error("Expected error message, got empty string")
	}
}

func TestStartIntegration(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"success":true}`))
	}))
	defer server.Close()

	cfg := &swagger.Config{
		BaseURL: server.URL,
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
		Endpoints: []swagger.EndpointConfig{
			{
				Path:   "/test",
				Method: "GET",
				Schema: swagger.SchemaProperty{},
			},
		},
		Settings: swagger.Settings{
			IterationsPerProfile: 1,
			Concurrency:          1,
			Profiles:             []swagger.FuzzingProfile{swagger.ProfileRandom},
		},
	}

	r := New(cfg, nil)
	defer r.Close()

	// Collect results to ensure it broadcasted
	resultsCh := r.Subscribe()
	var resultsCount int
	done := make(chan bool)
	go func() {
		for evt := range resultsCh {
			if evt.Type == EventResult {
				resultsCount++
			}
			if evt.Type == EventComplete {
				break
			}
		}
		done <- true
	}()

	err := r.Start(context.Background())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	// Wait until EventComplete is received
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatalf("timeout waiting for events")
	}
	r.Unsubscribe(resultsCh)

	if resultsCount == 0 {
		t.Errorf("Expected at least 1 result, got %d", resultsCount)
	}

	stats := r.GetStats()
	if stats.TotalRequests == 0 {
		t.Errorf("Expected TotalRequests > 0, got %d", stats.TotalRequests)
	}
}

func TestExecuteRequest_QueryParams(t *testing.T) {
	var capturedURL string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedURL = r.URL.String()
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	runner := &Runner{
		client: server.Client(),
		config: &swagger.Config{
			Settings: swagger.Settings{
				TimeoutMs: 1000,
			},
		},
	}

	queryParams := map[string]any{
		"q":  "fuzz payload",
		"id": 123,
	}

	res := runner.executeRequest(
		context.Background(),
		server.URL, "/test", "/test", "GET",
		nil, nil, nil, swagger.ProfileRandom, queryParams, nil, "",
	)

	if res == nil {
		t.Fatal("Expected FuzzResult, got nil")
	}
	if res.Error != "" {
		t.Fatalf("Expected no error, got %s", res.Error)
	}

	// url.Values.Encode() sorts keys alphabetically
	expectedQuery := "/test?id=123&q=fuzz+payload"
	if capturedURL != expectedQuery {
		t.Errorf("Expected URL to be %s, got: %s", expectedQuery, capturedURL)
	}
}
