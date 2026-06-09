package api

import (
	"fmt"
	"net/http"
	"swazz-engine/internal/classifier"
	"swazz-engine/internal/output"
	"swazz-engine/internal/swagger"

	"github.com/gin-gonic/gin"
)

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

	case "md":
		md := output.ToMarkdown(findings, stats, "0.1.0")
		c.Header("Content-Disposition", "attachment; filename=\"swazz-report.md\"")
		c.Data(http.StatusOK, "text/markdown; charset=utf-8", md)

	case "json":
		report := output.ToJSON(findings, stats, "0.1.0")
		c.JSON(http.StatusOK, report)

	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("unknown format: %s. Use json, sarif, html, or md", format)})
	}
}
