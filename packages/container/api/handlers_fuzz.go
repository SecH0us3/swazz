package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"swazz-engine/internal/runner"
	"swazz-engine/internal/swagger"

	"github.com/gin-gonic/gin"
)

func (h *Handler) StartFuzz(c *gin.Context) {
	var config swagger.Config
	if err := c.ShouldBindJSON(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid config: " + err.Error()})
		return
	}
	if os.Getenv("SWAZZ_ALLOW_PRIVATE_IPS") == "true" {
		config.Security.AllowPrivateIPs = true
	}

	// Apply defaults
	if config.Settings.IterationsPerProfile <= 0 {
		config.Settings = swagger.DefaultSettings()
	}
	if len(config.Settings.Profiles) == 0 {
		config.Settings.Profiles = swagger.DefaultSettings().Profiles
	}

	if err := config.Validate(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "malformed configuration: " + err.Error()})
		return
	}

	if err := swagger.LoadWordlists(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to load custom wordlists: " + err.Error()})
		return
	}

	h.mu.Lock()
	if h.runner != nil && h.runner.IsRunning() {
		h.mu.Unlock()
		c.JSON(http.StatusConflict, gin.H{"error": "a fuzzing run is already in progress"})
		return
	}

	h.config = &config
	h.results = nil
	if h.runner != nil {
		h.runner.Close()
	}
	h.runner = runner.New(&config, nil)

	// Collect results
	resultsCh := h.runner.Subscribe()
	r := h.runner
	h.mu.Unlock()

	// Perform authentication sequence synchronously using the request context
	if err := r.RunAuthSequence(c.Request.Context()); err != nil {
		fmt.Printf("Authentication sequence failed: %v\n", err)
		r.Unsubscribe(resultsCh)
		r.Close()
		c.JSON(http.StatusUnauthorized, gin.H{"error": fmt.Sprintf("Authentication sequence failed: %v", err)})
		return
	}

	// Start in background
	go func() {
		// Collect results from the subscription
		go func() {
			for evt := range resultsCh {
				if evt.Type == runner.EventResult {
					if result, ok := evt.Data.(*swagger.FuzzResult); ok {
						h.mu.Lock()
						h.results = append(h.results, result)
						h.mu.Unlock()
					}
				}
			}
		}()

		if err := r.Start(context.Background()); err != nil {
			fmt.Printf("Fuzzer run failed: %v\n", err)
			r.Broadcast(runner.Event{Type: runner.EventError, Data: fmt.Sprintf("Fuzzer run failed: %v", err)})
		}
		r.Unsubscribe(resultsCh)
	}()

	c.JSON(http.StatusAccepted, gin.H{"status": "started"})

}

func (h *Handler) StopFuzz(c *gin.Context) {
	h.mu.Lock()
	r := h.runner
	h.mu.Unlock()

	if r == nil || !r.IsRunning() {
		c.JSON(http.StatusOK, gin.H{"status": "not running"})
		return
	}
	r.Stop()
	c.JSON(http.StatusOK, gin.H{"status": "stopping"})
}

func (h *Handler) PauseFuzz(c *gin.Context) {
	h.mu.Lock()
	r := h.runner
	h.mu.Unlock()

	if r == nil || !r.IsRunning() {
		c.JSON(http.StatusOK, gin.H{"status": "not running"})
		return
	}
	r.Pause()
	c.JSON(http.StatusOK, gin.H{"status": "paused"})
}

func (h *Handler) ResumeFuzz(c *gin.Context) {
	h.mu.Lock()
	r := h.runner
	h.mu.Unlock()

	if r == nil {
		c.JSON(http.StatusOK, gin.H{"status": "not running"})
		return
	}
	r.Resume()
	c.JSON(http.StatusOK, gin.H{"status": "resumed"})
}

func (h *Handler) StreamResults(c *gin.Context) {
	h.mu.Lock()
	r := h.runner
	h.mu.Unlock()

	if r == nil {
		c.JSON(http.StatusOK, gin.H{"status": "no active run"})
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming not supported"})
		return
	}

	ch := r.Subscribe()
	defer r.Unsubscribe(ch)

	ctx := c.Request.Context()
	for {
		select {
		case evt, ok := <-ch:
			if !ok {
				return
			}
			data := evt.Data
			if evt.Type == runner.EventResult {
				if res, ok := evt.Data.(*swagger.FuzzResult); ok {
					data = runner.ToSSE(res)
				}
			}

			b, err := json.Marshal(data)
			if err != nil {
				fmt.Printf("Failed to marshal SSE event %s: %v\n", evt.Type, err)
				continue
			}
			fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", evt.Type, string(b))
			flusher.Flush()

			if evt.Type == runner.EventComplete {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

func (h *Handler) GetStats(c *gin.Context) {
	h.mu.Lock()
	r := h.runner
	h.mu.Unlock()

	if r == nil {
		c.JSON(http.StatusOK, swagger.RunStats{})
		return
	}
	c.JSON(http.StatusOK, r.GetStats())
}
