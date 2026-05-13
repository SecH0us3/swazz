package runner

import (
	"context"
	"net/http"
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
