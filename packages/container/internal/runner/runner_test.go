package runner

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"swazz-engine/internal/swagger"
)

func newTestRunner(client *http.Client, config *swagger.Config) *Runner {
	if config == nil {
		config = &swagger.Config{
			Settings: swagger.Settings{
				TimeoutMs: 1000,
			},
			Security: swagger.SecurityConfig{
				AllowPrivateIPs: true,
			},
		}
	}
	return New(config, client)
}

func TestExecuteRequest_ErrorPath(t *testing.T) {
	r := newTestRunner(&http.Client{
		Timeout: 1 * time.Millisecond,
		Transport: &http.Transport{
			DialContext: nil,
		},
	}, nil)
	defer r.Close()

	// Test with invalid URL to ensure client.Do fails immediately
	res := r.executeRequest(
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

	r := newTestRunner(server.Client(), nil)
	defer r.Close()

	queryParams := map[string]any{
		"q":  "fuzz payload",
		"id": 123,
	}

	res := r.executeRequest(
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

func TestConcurrentStatsAccuracy(t *testing.T) {
	// Verify that concurrent workers sending results through statsChan
	// produce accurate aggregated counts.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	cfg := &swagger.Config{
		BaseURL: server.URL,
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
		Endpoints: []swagger.EndpointConfig{
			{
				Path:   "/api/test",
				Method: "GET",
				Schema: swagger.SchemaProperty{},
			},
		},
		Settings: swagger.Settings{
			IterationsPerProfile: 20,
			Concurrency:          5,
			Profiles:             []swagger.FuzzingProfile{swagger.ProfileRandom},
		},
	}

	r := New(cfg, nil)
	defer r.Close()

	resultsCh := r.Subscribe()
	done := make(chan bool, 1)
	go func() {
		for evt := range resultsCh {
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

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("timeout waiting for completion")
	}
	r.Unsubscribe(resultsCh)

	stats := r.GetStats()

	// All requests should have gone to /api/test with status 200
	if stats.TotalRequests == 0 {
		t.Fatal("Expected TotalRequests > 0")
	}

	// Verify status count consistency
	var totalFromStatus int64
	for _, count := range stats.StatusCounts {
		totalFromStatus += count
	}
	if totalFromStatus != stats.TotalRequests {
		t.Errorf("StatusCounts sum (%d) != TotalRequests (%d)", totalFromStatus, stats.TotalRequests)
	}

	// Verify profile count consistency
	var totalFromProfiles int64
	for _, count := range stats.ProfileCounts {
		totalFromProfiles += count
	}
	if totalFromProfiles != stats.TotalRequests {
		t.Errorf("ProfileCounts sum (%d) != TotalRequests (%d)", totalFromProfiles, stats.TotalRequests)
	}

	// Verify endpoint count consistency
	for ep, statusMap := range stats.EndpointCounts {
		var epTotal int64
		for _, count := range statusMap {
			epTotal += count
		}
		t.Logf("Endpoint %s: %d requests", ep, epTotal)
	}
}

func TestStatsAggregatorShutdown(t *testing.T) {
	// Verify that all buffered results are drained before the aggregator exits.
	cfg := &swagger.Config{
		Settings: swagger.Settings{TimeoutMs: 1000},
		Security: swagger.SecurityConfig{AllowPrivateIPs: true},
	}
	r := New(cfg, nil)
	defer r.Close()

	// Manually start the aggregator by mimicking Start's setup
	r.statsChan = make(chan statsMsg, 4096)
	r.statsDone = make(chan struct{})
	empty := newEmptyStats()
	r.latestStats.Store(&empty)
	go r.statsAggregator()

	// Send 100 results
	const numResults = 100
	for i := 0; i < numResults; i++ {
		r.statsChan <- statsMsg{
			result: &swagger.FuzzResult{
				Method:   "GET",
				Endpoint: "/test",
				Profile:  swagger.ProfileRandom,
				Status:   200,
			},
			currentIteration: i + 1,
			totalIterations:  numResults,
		}
	}

	// Close the channel and wait for aggregator to finish
	close(r.statsChan)
	select {
	case <-r.statsDone:
	case <-time.After(5 * time.Second):
		t.Fatal("aggregator did not shut down in time")
	}

	stats := r.GetStats()
	if stats.TotalRequests != numResults {
		t.Errorf("Expected %d TotalRequests after drain, got %d", numResults, stats.TotalRequests)
	}
}

func TestPauseResumeAtomic(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(5 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
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
				Method: "POST",
				Schema: swagger.SchemaProperty{
					Type: "object",
					Properties: map[string]*swagger.SchemaProperty{
						"name": {Type: "string"},
					},
				},
			},
		},
		Settings: swagger.Settings{
			IterationsPerProfile: 100,
			Concurrency:          2,
			Profiles:             []swagger.FuzzingProfile{swagger.ProfileRandom},
		},
	}

	r := New(cfg, nil)
	defer r.Close()

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		r.Start(context.Background())
	}()

	// Allow some requests to proceed
	time.Sleep(50 * time.Millisecond)

	// Pause
	r.Pause()
	if !r.isPaused.Load() {
		t.Error("Expected isPaused to be true after Pause()")
	}

	// Resume after a brief pause
	time.Sleep(50 * time.Millisecond)
	r.Resume()
	if r.isPaused.Load() {
		t.Error("Expected isPaused to be false after Resume()")
	}

	// Wait for completion
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		r.Stop()
		t.Fatal("runner did not complete in time")
	}

	if r.IsRunning() {
		t.Error("Expected runner to not be running after completion")
	}
}

func TestExecuteRequest_VulnerabilityAnalysis(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`Fatal error: You have an error in your SQL syntax near line 1.`))
	}))
	defer server.Close()

	cfg := &swagger.Config{
		Settings: swagger.Settings{
			AnalyzeResponseBody: true,
			TimeoutMs:           1000,
		},
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
	}

	r := newTestRunner(server.Client(), cfg)
	defer r.Close()

	res := r.executeRequest(
		context.Background(),
		server.URL, "/test", "/test", "POST",
		nil, nil, nil, swagger.ProfileMalicious, nil, nil, "",
	)

	if res == nil {
		t.Fatal("Expected FuzzResult, got nil")
	}

	if len(res.AnalyzerFindings) == 0 {
		t.Fatal("Expected analyzer findings, got none")
	}

	foundSQLi := false
	for _, f := range res.AnalyzerFindings {
		if f.RuleID == "swazz/sql-error-leak" {
			foundSQLi = true
		}
	}

	if !foundSQLi {
		t.Errorf("Expected 'swazz/sql-error-leak' finding, got findings: %+v", res.AnalyzerFindings)
	}
}

func TestRunner_RateLimitPhase(t *testing.T) {
	// A server that returns 200 OK for all requests
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	}))
	defer server.Close()

	cfg := &swagger.Config{
		BaseURL: server.URL,
		Endpoints: []swagger.EndpointConfig{
			{
				Path:   "/api/ratelimit-test",
				Method: "GET",
			},
		},
		Settings: swagger.Settings{
			RateLimitCheck:     true,
			RateLimitBurstSize: 5,
			TimeoutMs:          1000,
			Concurrency:        2,
			Profiles:           []swagger.FuzzingProfile{swagger.ProfileRandom},
		},
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
	}

	r := newTestRunner(server.Client(), cfg)
	defer r.Close()

	resultsCh := r.Subscribe()

	go func() {
		err := r.Start(context.Background())
		if err != nil {
			t.Errorf("Start failed: %v", err)
		}
	}()

	foundNoRateLimitFinding := false
	timeout := time.After(2 * time.Second)

loop:
	for {
		select {
		case evt, ok := <-resultsCh:
			if !ok {
				break loop
			}
			if evt.Type == EventResult {
				if res, ok := evt.Data.(*swagger.FuzzResult); ok {
					for _, af := range res.AnalyzerFindings {
						if af.RuleID == "swazz/no-rate-limit" {
							foundNoRateLimitFinding = true
						}
					}
				}
			}
			if evt.Type == EventComplete {
				break loop
			}
		case <-timeout:
			t.Fatal("Test timed out waiting for events")
		}
	}

	if !foundNoRateLimitFinding {
		t.Error("Expected to find 'swazz/no-rate-limit' finding, but got none")
	}
}

