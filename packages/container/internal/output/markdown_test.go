// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package output

import (
	"strings"
	"swazz-engine/internal/classifier"
	"swazz-engine/internal/swagger"
	"swazz-engine/internal/wafcheck"
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

	// 3. Test with WAFCheck populated
	statsWithWAF := &swagger.RunStats{
		StartTime:     time.Now().UnixMilli() - 5000,
		TotalRequests: 100,
		WAFCheck: &wafcheck.Result{
			Detection: wafcheck.Detection{
				Detected:   true,
				WAFType:    "Cloudflare",
				Confidence: 0.92,
				Evidence:   []string{"cf-ray header present"},
			},
			BypassOpportunities: wafcheck.BypassOpportunities{
				EncodingBypass: true,
			},
			Timestamp: "2026-09-04T12:00:00Z",
		},
	}
	resWAF := ToMarkdown(nil, statsWithWAF, "1.0.0")
	resWAFStr := string(resWAF)
	if !strings.Contains(resWAFStr, "## 🛡️ WAF Analysis") {
		t.Error("Expected WAF Analysis section in markdown report")
	}
	if !strings.Contains(resWAFStr, "**Vendor:** Cloudflare") {
		t.Error("Expected Cloudflare vendor in markdown report")
	}
	if !strings.Contains(resWAFStr, "92%") {
		t.Error("Expected 92% confidence in markdown report")
	}
	if !strings.Contains(resWAFStr, "cf-ray header present") {
		t.Error("Expected evidence in markdown report")
	}
	if !strings.Contains(resWAFStr, "Encoding Bypass") {
		t.Error("Expected bypass opportunities in markdown report")
	}

	// 4. Test with WAFCheck nil
	statsWithoutWAF := &swagger.RunStats{
		TotalRequests: 100,
		WAFCheck:      nil,
	}
	resNoWAF := ToMarkdown(nil, statsWithoutWAF, "1.0.0")
	if strings.Contains(string(resNoWAF), "## 🛡️ WAF Analysis") {
		t.Error("Did not expect WAF Analysis section in markdown report when WAFCheck is nil")
	}
}
