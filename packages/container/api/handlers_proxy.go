package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

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

	// Strict URL validation: only HTTP and HTTPS schemes are allowed to mitigate SSRF.
	parsedURL, err := url.Parse(req.URL)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid URL: scheme must be http or https"})
		return
	}
	sanitizedURL := parsedURL.String()

	finalHeaders := map[string]string{"Content-Type": "application/json"}
	for k, v := range req.Headers {
		finalHeaders[k] = v
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

	// #nosec G107 -- URL is user-controlled by design in this fuzzer tool
	httpReq, err := http.NewRequestWithContext(ctx, method, sanitizedURL, bodyReader)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	for k, v := range finalHeaders {
		httpReq.Header.Set(k, v)
	}

	// Add Cookies idiometically
	for k, v := range req.Cookies {
		if k != "" && v != "" {
			httpReq.AddCookie(&http.Cookie{Name: k, Value: v})
		}
	}

	start := time.Now()
	// codeql[go/request-forgery] false positive: intentional proxy request
	resp, err := h.getClient().Do(httpReq)
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
