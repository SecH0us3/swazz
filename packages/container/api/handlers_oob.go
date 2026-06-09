package api

import (
	"fmt"
	"net/http"
	"swazz-engine/internal/oob"
	"swazz-engine/internal/runner"
	"swazz-engine/internal/swagger"
	"time"

	"github.com/gin-gonic/gin"
)

func (h *Handler) HandleOOB(c *gin.Context) {
	uuidStr := c.Param("uuid")

	ctx, ok := oob.GlobalStore.GetAndRemoveUUID(uuidStr)
	if !ok {
		// Not found or already processed
		c.JSON(http.StatusOK, gin.H{"status": "ignored"})
		return
	}

	finding := swagger.AnalysisFinding{
		RuleID:   "swazz/oob-interaction",
		Level:    "error",
		Message:  "Out-of-Band Interaction Detected",
		Evidence: fmt.Sprintf("Received %s request from %s for payload: %v", c.Request.Method, c.ClientIP(), ctx.Payload),
	}

	// Try to broadcast the finding
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.runner != nil && h.runner.IsRunning() {
		// Wrap it in a pseudo FuzzResult
		result := &swagger.FuzzResult{
			ID:               uuidStr,
			Endpoint:         ctx.Endpoint,
			Method:           c.Request.Method, // Fallback method
			Profile:          swagger.ProfileMalicious,
			Status:           http.StatusOK,
			Payload:          ctx.Payload,
			Timestamp:        time.Now().UnixMilli(),
			AnalyzerFindings: []swagger.AnalysisFinding{finding},
		}

		if ctx.Request != nil {
			if ctx.Request.OriginalPath != "" {
				result.Endpoint = ctx.Request.OriginalPath
			} else {
				result.Endpoint = ctx.Request.URL
			}
			if ctx.Request.ResolvedPath != "" {
				result.ResolvedPath = ctx.Request.ResolvedPath
			} else {
				result.ResolvedPath = ctx.Request.URL
			}
			result.Method = ctx.Request.Method
			result.RequestHeaders = ctx.Request.Headers
			result.Payload = ctx.Request.Body
		}

		h.results = append(h.results, result)
		h.runner.Broadcast(runner.Event{Type: runner.EventResult, Data: result})
	}

	c.JSON(http.StatusOK, gin.H{"status": "processed"})
}
