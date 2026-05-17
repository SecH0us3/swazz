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
	
	// Collect results to ensure it broadcasted
	resultsCh := r.Subscribe()
	var resultsCount int
	done := make(chan bool)
	go func() {
		for evt := range resultsCh {
			if evt.Type == EventResult {
				resultsCount++
			}
		}
		done <- true
	}()

	err := r.Start(context.Background())
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	r.Unsubscribe(resultsCh)
	<-done

	if resultsCount == 0 {
		t.Errorf("Expected at least 1 result, got %d", resultsCount)
	}
	
	stats := r.GetStats()
	if stats.TotalRequests == 0 {
		t.Errorf("Expected TotalRequests > 0, got %d", stats.TotalRequests)
	}
}
