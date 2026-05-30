package output

import (
	"strings"
	"testing"
	"time"

	"swazz-engine/internal/classifier"
	"swazz-engine/internal/swagger"
)

func TestToHTML(t *testing.T) {
	// Case 1: Empty findings, null stats
	t.Run("Empty findings and null stats", func(t *testing.T) {
		res := ToHTML(nil, nil)

		if !strings.HasPrefix(res, "<!DOCTYPE html>") {
			t.Errorf("expected HTML output to start with <!DOCTYPE html>")
		}

		if !strings.Contains(res, "</html>") {
			t.Errorf("expected HTML output to contain </html>")
		}

		if !strings.Contains(res, "No findings discovered. ✨") {
			t.Errorf("expected HTML to contain 'No findings discovered' placeholder")
		}

		// Stats showing 0
		if !strings.Contains(res, `<span class="stat-value">0</span><span class="stat-label">Requests</span>`) {
			t.Errorf("expected 0 requests in stats")
		}
		if !strings.Contains(res, `<span class="stat-value" style="color: var(--error)">0</span><span class="stat-label">Errors</span>`) {
			t.Errorf("expected 0 errors in stats")
		}
		if !strings.Contains(res, `<span class="stat-value" style="color: var(--warning)">0</span><span class="stat-label">Warnings</span>`) {
			t.Errorf("expected 0 warnings in stats")
		}
		if !strings.Contains(res, `<span class="stat-value">0</span><span class="stat-label">Endpoints</span>`) {
			t.Errorf("expected 0 endpoints in stats")
		}
	})

	// Case 2: Single finding with details
	t.Run("Single finding validation", func(t *testing.T) {
		finding := &classifier.Finding{
			Level:    classifier.SeverityError,
			Method:   "POST",
			Endpoint: "/api/v1/users",
			Status:   500,
			Profile:  "RANDOM",
			Duration: 120,
		}

		res := ToHTML([]*classifier.Finding{finding}, nil)

		if !strings.Contains(res, "level-error") {
			t.Errorf("expected level-error CSS class")
		}
		if !strings.Contains(res, "HTTP 500") {
			t.Errorf("expected HTTP 500 label")
		}
		if !strings.Contains(res, "profile-RANDOM") {
			t.Errorf("expected profile-RANDOM class")
		}
		if !strings.Contains(res, "120ms") {
			t.Errorf("expected 120ms duration label")
		}
		if !strings.Contains(res, `<span class="method">POST</span>`) {
			t.Errorf("expected method span for POST")
		}
		if !strings.Contains(res, `/api/v1/users`) {
			t.Errorf("expected endpoint path /api/v1/users")
		}
	})

	// Case 3: Multiple findings across endpoints & grouping
	t.Run("Multiple findings and grouping", func(t *testing.T) {
		findings := []*classifier.Finding{
			{
				Level:    classifier.SeverityError,
				Method:   "POST",
				Endpoint: "/api/v1/users",
				Status:   500,
				Profile:  "RANDOM",
			},
			{
				Level:    classifier.SeverityWarning,
				Method:   "GET",
				Endpoint: "/api/v1/users",
				Status:   400,
				Profile:  "BOUNDARY",
			},
			{
				Level:    classifier.SeverityNote,
				Method:   "GET",
				Endpoint: "/api/v1/items",
				Status:   200,
				Profile:  "MALICIOUS",
			},
		}

		res := ToHTML(findings, nil)

		// Grouping check
		if !strings.Contains(res, `data-endpoint="/api/v1/users"`) {
			t.Errorf("expected group for /api/v1/users")
		}
		if !strings.Contains(res, `data-endpoint="/api/v1/items"`) {
			t.Errorf("expected group for /api/v1/items")
		}

		// Filter dropdowns options
		if !strings.Contains(res, `<option value="500">500</option>`) {
			t.Errorf("expected status option 500")
		}
		if !strings.Contains(res, `<option value="400">400</option>`) {
			t.Errorf("expected status option 400")
		}
		if !strings.Contains(res, `<option value="200">200</option>`) {
			t.Errorf("expected status option 200")
		}

		if !strings.Contains(res, `<option value="RANDOM">RANDOM</option>`) {
			t.Errorf("expected profile option RANDOM")
		}
		if !strings.Contains(res, `<option value="BOUNDARY">BOUNDARY</option>`) {
			t.Errorf("expected profile option BOUNDARY")
		}
		if !strings.Contains(res, `<option value="MALICIOUS">MALICIOUS</option>`) {
			t.Errorf("expected profile option MALICIOUS")
		}
	})

	// Case 4: HTML Escaping / XSS Safety
	t.Run("HTML Escaping and XSS safety", func(t *testing.T) {
		finding := &classifier.Finding{
			Level:        classifier.SeverityError,
			Method:       "<script>alert('method')</script>",
			Endpoint:     "/api/v1/users?name=<script>alert('endpoint')</script>",
			Status:       500,
			Profile:      "RANDOM",
			Payload:      map[string]any{"xss": "<script>alert('payload')</script>"},
			ResponseBody: "<script>alert('response')</script>",
		}

		res := ToHTML([]*classifier.Finding{finding}, nil)

		// Ensure raw scripts are not present
		badStrings := []string{
			"<script>alert('method')</script>",
			"<script>alert('endpoint')</script>",
			"<script>alert('payload')</script>",
			"<script>alert('response')</script>",
		}

		for _, bad := range badStrings {
			if strings.Contains(res, bad) {
				t.Errorf("security vulnerability: HTML report contains raw injection script %q", bad)
			}
		}

		// Verify proper HTML escaping exists instead (support both decimal &#39; and hex &#x27;)
		containsEscaped := func(s, pattern string) bool {
			opt1 := strings.ReplaceAll(pattern, "PLACEHOLDER", s)
			opt2 := strings.ReplaceAll(opt1, "&#39;", "&#x27;")
			return strings.Contains(res, opt1) || strings.Contains(res, opt2)
		}

		if !containsEscaped("method", "&lt;script&gt;alert(&#39;PLACEHOLDER&#39;)&lt;/script&gt;") {
			t.Errorf("expected escaped method in output")
		}
		if !containsEscaped("endpoint", "/api/v1/users?name=&lt;script&gt;alert(&#39;PLACEHOLDER&#39;)&lt;/script&gt;") {
			t.Errorf("expected escaped endpoint in output")
		}
		if !strings.Contains(res, "u003cscript") {
			t.Errorf("expected escaped payload in output, got %s", res)
		}
		if !containsEscaped("response", "&lt;script&gt;alert(&#39;PLACEHOLDER&#39;)&lt;/script&gt;") {
			t.Errorf("expected escaped response body in output")
		}
	})

	// Case 5: Very long URLs (>500 chars)
	t.Run("Very long URLs handling", func(t *testing.T) {
		longPath := "/api/" + strings.Repeat("a", 600)
		finding := &classifier.Finding{
			Level:    classifier.SeverityError,
			Method:   "GET",
			Endpoint: longPath,
			Status:   500,
			Profile:  "RANDOM",
		}

		// Ensure it does not panic and contains the long path
		res := ToHTML([]*classifier.Finding{finding}, nil)
		if !strings.Contains(res, longPath) {
			t.Errorf("expected HTML to contain the long endpoint path")
		}
	})

	// Case 6: All severity levels mapping
	t.Run("All severity levels mapping", func(t *testing.T) {
		findings := []*classifier.Finding{
			{Level: classifier.SeverityError, Method: "GET", Endpoint: "/e"},
			{Level: classifier.SeverityWarning, Method: "GET", Endpoint: "/w"},
			{Level: classifier.SeverityNote, Method: "GET", Endpoint: "/n"},
		}

		res := ToHTML(findings, nil)

		if !strings.Contains(res, "level-error") {
			t.Errorf("expected level-error CSS class")
		}
		if !strings.Contains(res, "level-warning") {
			t.Errorf("expected level-warning CSS class")
		}
		if !strings.Contains(res, "level-note") {
			t.Errorf("expected level-note CSS class")
		}
	})

	// Case 7: ResponseBody truncation (>100 chars)
	t.Run("ResponseBody truncation", func(t *testing.T) {
		// 150 'A' characters - uniform repetition
		uniformBody := strings.Repeat("A", 150)
		// 150 mixed characters - normal truncation
		mixedBody := "XYZ" + strings.Repeat("B", 147)

		findings := []*classifier.Finding{
			{
				Level:        classifier.SeverityError,
				Method:       "GET",
				Endpoint:     "/uniform",
				ResponseBody: uniformBody,
			},
			{
				Level:        classifier.SeverityError,
				Method:       "GET",
				Endpoint:     "/mixed",
				ResponseBody: mixedBody,
			},
		}

		res := ToHTML(findings, nil)

		// Uniform body should be truncated to 10 repeats + suffix
		expectedUniformSuffix := "AAAAAAAAAA... (150 repeats)"
		if !strings.Contains(res, expectedUniformSuffix) {
			t.Errorf("expected uniform response body to match uniform truncation logic, got it wrong in HTML output")
		}

		// Mixed body should truncate at 100 characters + suffix
		expectedMixedPrefix := mixedBody[:100]
		expectedMixedSuffix := "... (50 chars more)"
		if !strings.Contains(res, expectedMixedPrefix) || !strings.Contains(res, expectedMixedSuffix) {
			t.Errorf("expected mixed response body to match normal truncation logic")
		}
	})

	// Case 8: RunStats details (StartTime duration, Progress total, TotalRequests)
	t.Run("RunStats details handling", func(t *testing.T) {
		startTime := time.Now().UnixMilli() - 10000 // 10 seconds ago
		stats := &swagger.RunStats{
			TotalRequests: 500,
			StartTime:     startTime,
			Progress: swagger.Progress{
				TotalEndpoints: 15,
			},
		}

		findings := []*classifier.Finding{
			{Level: classifier.SeverityError, Method: "GET", Endpoint: "/stats-test"},
		}

		res := ToHTML(findings, stats)

		// Total requests
		if !strings.Contains(res, `<span class="stat-value">500</span><span class="stat-label">Requests</span>`) {
			t.Errorf("expected 500 requests in stats header")
		}

		// Total endpoints
		if !strings.Contains(res, `<span class="stat-value">15</span><span class="stat-label">Endpoints</span>`) {
			t.Errorf("expected 15 endpoints in stats header")
		}

		// Verify Took duration is present
		if !strings.Contains(res, "Took ") {
			t.Errorf("expected Took duration to be present, output was: %s", res)
		}
	})
}
