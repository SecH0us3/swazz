package output

import (
	"strings"
	"swazz-engine/internal/classifier"
	"swazz-engine/internal/swagger"
	"testing"
	"time"
)

func TestToMarkdown(t *testing.T) {
	// 1. Test empty findings
	stats := &swagger.RunStats{
		StartTime:     time.Now().UnixMilli() - 5000,
		TotalRequests: 100,
	}
	resEmpty := ToMarkdown(nil, stats, "")
	resEmptyStr := string(resEmpty)
	if !strings.Contains(resEmptyStr, "Executive Summary") {
		t.Error("Expected Executive Summary section in report")
	}
	if !strings.Contains(resEmptyStr, "No vulnerabilities detected") {
		t.Error("Expected no vulnerabilities notification")
	}

	// 2. Test filled findings
	findings := []*classifier.Finding{
		{
			Level:         classifier.SeverityError,
			RuleID:        "swazz/reflected-xss",
			Endpoint:      "/api/test",
			ResolvedPath:  "/api/test?q=%3Cscript%3E",
			Method:        "GET",
			OWASPCategory: []string{"A03:2021-Injection"},
			Source:        "Fuzzer",
			Payload:       "<script>",
			ResponseBody:  "<div><script></div>",
		},
		{
			Level:        classifier.SeverityWarning,
			RuleID:       "swazz/cors-misconfig",
			Endpoint:     "/api/cors",
			ResolvedPath: "/api/cors",
			Method:       "OPTIONS",
			Payload:      nil,
			ResponseBody: "Access-Control-Allow-Origin: *",
		},
		{
			Level:        classifier.SeverityNote,
			RuleID:       "swazz/info-leak",
			Endpoint:     "/api/info",
			ResolvedPath: "/api/info",
			Payload:      "test-payload",
			ResponseBody: strings.Repeat("A", 1000), // triggers previewString limit truncation
		},
	}

	res := ToMarkdown(findings, stats, "2.1.0")
	resStr := string(res)

	if !strings.Contains(resStr, "Report (v2.1.0)") {
		t.Error("Expected version v2.1.0 in title")
	}
	if !strings.Contains(resStr, "swazz/reflected-xss") {
		t.Error("Expected reflected-xss finding in report")
	}
	if !strings.Contains(resStr, "swazz/cors-misconfig") {
		t.Error("Expected cors-misconfig finding in report")
	}
	if !strings.Contains(resStr, "swazz/info-leak") {
		t.Error("Expected info-leak finding in report")
	}
	// Verify truncation preview string is present
	if !strings.Contains(resStr, "...") {
		t.Error("Expected response preview to be truncated with ellipsis")
	}
}
