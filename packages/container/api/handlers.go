package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"swazz-engine/internal/classifier"
	"swazz-engine/internal/output"
	"swazz-engine/internal/runner"
	"swazz-engine/internal/swagger"

	"github.com/gin-gonic/gin"
)

// Handler holds references to the runner and current config.
type Handler struct {
	mu      sync.Mutex
	runner  *runner.Runner
	config  *swagger.Config
	results []*swagger.FuzzResult
}

// NewHandler creates a new API handler.
func NewHandler() *Handler {
	return &Handler{}
}

// ─── POST /api/parse ────────────────────────────────────

type parseRequest struct {
	URL  string          `json:"url,omitempty"`
	Spec json.RawMessage `json:"spec,omitempty"`
}

func (h *Handler) ParseSpec(c *gin.Context) {
	var req parseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON body"})
		return
	}

	var raw json.RawMessage

	if len(req.Spec) > 0 {
		raw = req.Spec
	} else if req.URL != "" {
		// Fetch spec from URL
		ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
		defer cancel()

		httpReq, err := http.NewRequestWithContext(ctx, "GET", req.URL, nil)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid URL: %s", err)})
			return
		}
		httpReq.Header.Set("Accept", "application/json")

		resp, err := http.DefaultClient.Do(httpReq)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("failed to fetch spec: %s", err)})
			return
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024)) // 10MB limit
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("failed to read spec: %s", err)})
			return
		}
		raw = body
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provide either 'url' or 'spec'"})
		return
	}

	result, err := swagger.ParseSpec(raw)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// ─── POST /api/fuzz/start ───────────────────────────────

func (h *Handler) StartFuzz(c *gin.Context) {
	var config swagger.Config
	if err := c.ShouldBindJSON(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid config: " + err.Error()})
		return
	}

	// Apply defaults
	if config.Settings.IterationsPerProfile <= 0 {
		config.Settings = swagger.DefaultSettings()
	}
	if len(config.Settings.Profiles) == 0 {
		config.Settings.Profiles = swagger.DefaultSettings().Profiles
	}

	h.mu.Lock()
	if h.runner != nil && h.runner.IsRunning() {
		h.mu.Unlock()
		c.JSON(http.StatusConflict, gin.H{"error": "a fuzzing run is already in progress"})
		return
	}

	h.config = &config
	h.results = nil
	h.runner = runner.New(&config, nil)

	// Collect results
	resultsCh := h.runner.Subscribe()
	r := h.runner
	h.mu.Unlock()

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

		r.Start(context.Background())
		r.Unsubscribe(resultsCh)
	}()

	c.JSON(http.StatusAccepted, gin.H{"status": "started"})
}

// ─── POST /api/fuzz/stop ────────────────────────────────

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

// ─── POST /api/fuzz/pause ───────────────────────────────

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

// ─── POST /api/fuzz/resume ──────────────────────────────

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

// ─── GET /api/fuzz/stream (SSE) ─────────────────────────

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
			fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", evt.Type, evt.JSON())
			flusher.Flush()

			if evt.Type == runner.EventComplete {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

// ─── GET /api/stats ─────────────────────────────────────

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

// ─── POST /api/proxy (replaces @swazz/worker) ──────────

type proxyRequest struct {
	URL     string            `json:"url"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers,omitempty"`
	Cookies map[string]string `json:"cookies,omitempty"`
	Body    json.RawMessage   `json:"body,omitempty"`
}

func (h *Handler) Proxy(c *gin.Context) {
	var req proxyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON body"})
		return
	}

	if req.URL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing \"url\" field"})
		return
	}

	// Build Cookie header
	cookieParts := make([]string, 0, len(req.Cookies))
	for k, v := range req.Cookies {
		if k != "" && v != "" {
			cookieParts = append(cookieParts, k+"="+v)
		}
	}

	finalHeaders := map[string]string{"Content-Type": "application/json"}
	for k, v := range req.Headers {
		finalHeaders[k] = v
	}
	if len(cookieParts) > 0 {
		finalHeaders["Cookie"] = strings.Join(cookieParts, "; ")
	}

	var bodyReader io.Reader
	if len(req.Body) > 0 {
		ct := finalHeaders["Content-Type"]
		if ct == "" {
			ct = finalHeaders["content-type"]
		}
		if strings.Contains(ct, "x-www-form-urlencoded") {
			var bodyMap map[string]string
			if json.Unmarshal(req.Body, &bodyMap) == nil {
				params := make([]string, 0, len(bodyMap))
				for k, v := range bodyMap {
					params = append(params, k+"="+v)
				}
				bodyReader = strings.NewReader(strings.Join(params, "&"))
			}
		}
		if bodyReader == nil {
			bodyReader = strings.NewReader(string(req.Body))
		}
	}

	method := req.Method
	if method == "" {
		method = "POST"
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(ctx, method, req.URL, bodyReader)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	for k, v := range finalHeaders {
		httpReq.Header.Set(k, v)
	}

	start := time.Now()
	resp, err := http.DefaultClient.Do(httpReq)
	duration := time.Since(start).Milliseconds()

	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{
			"status":   0,
			"headers":  map[string]string{},
			"body":     "",
			"duration": duration,
			"error":    err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 5*1024*1024)) // 5MB limit
	respHeaders := make(map[string]string)
	for k := range resp.Header {
		respHeaders[k] = resp.Header.Get(k)
	}

	c.JSON(http.StatusOK, gin.H{
		"status":   resp.StatusCode,
		"headers":  respHeaders,
		"body":     string(respBody),
		"duration": duration,
	})
}

// ─── GET /api/report ────────────────────────────────────

func (h *Handler) GetReport(c *gin.Context) {
	format := c.DefaultQuery("format", "json")

	h.mu.Lock()
	results := make([]*swagger.FuzzResult, len(h.results))
	copy(results, h.results)
	r := h.runner
	h.mu.Unlock()

	// Classify results into findings
	cls := classifier.New(nil)
	findings := cls.ClassifyAll(results)

	var stats *swagger.RunStats
	if r != nil {
		s := r.GetStats()
		stats = &s
	}

	switch format {
	case "sarif":
		report := output.ToSARIF(findings, "0.1.0")
		c.JSON(http.StatusOK, report)

	case "html":
		html := output.ToHTML(findings, stats)
		c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(html))

	case "json":
		report := output.ToJSON(findings, stats, "0.1.0")
		c.JSON(http.StatusOK, report)

	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("unknown format: %s. Use json, sarif, or html", format)})
	}
}
