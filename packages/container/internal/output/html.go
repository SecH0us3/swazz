// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package output

import (
	"encoding/json"
	"fmt"
	"html"
	"math"
	"strings"
	"time"

	"swazz-engine/internal/classifier"
	"swazz-engine/internal/swagger"
)

const reportJS = `document.addEventListener("DOMContentLoaded", () => {
    const epFilter = document.getElementById('endpointFilter');
    const statusFilter = document.getElementById('statusFilter');
    const profileFilter = document.getElementById('profileFilter');

    function filterFindings() {
        const epValue = epFilter ? epFilter.value.toLowerCase() : "";
        const statusValue = statusFilter ? statusFilter.value : "";
        const profileValue = profileFilter ? profileFilter.value : "";

        document.querySelectorAll('.finding-group').forEach(group => {
            const endpoint = (group.getAttribute('data-endpoint') || "").toLowerCase();
            const items = group.querySelectorAll('.finding-item');
            let visibleItems = 0;

            items.forEach(item => {
                const status = item.getAttribute('data-status') || "";
                const profile = item.getAttribute('data-profile') || "";

                const epMatch = endpoint.includes(epValue);
                const statusMatch = !statusValue || status === statusValue;
                const profileMatch = !profileValue || profile === profileValue;

                if (epMatch && statusMatch && profileMatch) {
                    item.style.display = 'block';
                    visibleItems++;
                } else {
                    item.style.display = 'none';
                }
            });

            if (visibleItems > 0) {
                group.style.display = 'block';
                const countSpan = group.querySelector('.count');
                if (countSpan) {
                    countSpan.textContent = visibleItems;
                }
            } else {
                group.style.display = 'none';
            }
        });
    }

    if (epFilter) epFilter.addEventListener('input', filterFindings);
    if (statusFilter) statusFilter.addEventListener('change', filterFindings);
    if (profileFilter) profileFilter.addEventListener('change', filterFindings);
});`

// ToHTML generates a premium dark-theme HTML report.
func ToHTML(findings []*classifier.Finding, stats *swagger.RunStats) string {
	timestamp := time.Now().Format("2006-01-02 15:04:05")
	duration := int64(0)
	if stats != nil && stats.StartTime > 0 {
		duration = (time.Now().UnixMilli() - stats.StartTime) / 1000
	}

	var errors, warnings, notes int
	for _, f := range findings {
		switch f.Level {
		case classifier.SeverityError:
			errors++
		case classifier.SeverityWarning:
			warnings++
		case classifier.SeverityNote:
			notes++
		}
	}

	// Count findings by OWASP category
	owaspCounts := make(map[string]int)
	owaspAPICounts := make(map[string]int)
	for _, f := range findings {
		if len(f.OWASPCategory) > 0 {
			for _, cat := range f.OWASPCategory {
				owaspCounts[cat]++
			}
		} else {
			owaspCounts["Unmapped / Other"]++
		}
		if len(f.OWASPAPICategory) > 0 {
			for _, cat := range f.OWASPAPICategory {
				owaspAPICounts[cat]++
			}
		}
	}

	owaspAPICategories := []string{
		"API1:2023 Broken Object Level Authorization",
		"API2:2023 Broken Authentication",
		"API3:2023 Broken Object Property Level Authorization",
		"API4:2023 Unrestricted Resource Consumption",
		"API5:2023 Broken Function Level Authorization",
		"API6:2023 Unrestricted Access to Sensitive Business Flows",
		"API7:2023 Server Side Request Forgery",
		"API8:2023 Security Misconfiguration",
		"API9:2023 Improper Assets Management",
		"API10:2023 Unsafe Consumption of APIs",
	}

	var owaspAPIGrid strings.Builder
	for _, cat := range owaspAPICategories {
		count := owaspAPICounts[cat]
		cardClass := "no-findings"
		if count > 0 {
			cardClass = "has-findings"
		}
		owaspAPIGrid.WriteString(fmt.Sprintf(`
            <div class="owasp-card %s">
                <span class="owasp-name">%s</span>
                <span class="owasp-count">%d</span>
            </div>`, cardClass, html.EscapeString(cat), count))
	}

	owaspCategories := []string{
		"A01:2025 Broken Access Control",
		"A02:2025 Security Misconfiguration",
		"A03:2025 Software Supply Chain Failures",
		"A04:2025 Cryptographic Failures",
		"A05:2025 Injection",
		"A06:2025 Insecure Design",
		"A07:2025 Authentication Failures",
		"A08:2025 Software or Data Integrity Failures",
		"A09:2025 Security Logging & Alerting Failures",
		"A10:2025 Mishandling of Exceptional Conditions",
	}

	var owaspGrid strings.Builder
	for _, cat := range owaspCategories {
		count := owaspCounts[cat]
		cardClass := "no-findings"
		if count > 0 {
			cardClass = "has-findings"
		}
		owaspGrid.WriteString(fmt.Sprintf(`
            <div class="owasp-card %s">
                <span class="owasp-name">%s</span>
                <span class="owasp-count">%d</span>
            </div>`, cardClass, html.EscapeString(cat), count))
	}
	if unmappedCount := owaspCounts["Unmapped / Other"]; unmappedCount > 0 {
		owaspGrid.WriteString(fmt.Sprintf(`
            <div class="owasp-card has-findings">
                <span class="owasp-name">Unmapped / Other Findings</span>
                <span class="owasp-count">%d</span>
            </div>`, unmappedCount))
	}

	// Group findings by endpoint
	groups := make(map[string][]*classifier.Finding)
	groupOrder := make([]string, 0)

	uniqueStatuses := make(map[int]bool)
	uniqueProfiles := make(map[swagger.FuzzingProfile]bool)

	for _, f := range findings {
		key := fmt.Sprintf("%s %s", f.Method, f.Endpoint)
		if _, exists := groups[key]; !exists {
			groupOrder = append(groupOrder, key)
		}
		groups[key] = append(groups[key], f)
		uniqueStatuses[f.Status] = true
		uniqueProfiles[f.Profile] = true
	}

	var statusOptions strings.Builder
	for status := range uniqueStatuses {
		statusOptions.WriteString(fmt.Sprintf(`<option value="%d">%d</option>`, status, status))
	}
	var profileOptions strings.Builder
	for profile := range uniqueProfiles {
		profileOptions.WriteString(fmt.Sprintf(`<option value="%s">%s</option>`, profile, profile))
	}

	totalEndpoints := 0
	if stats != nil {
		totalEndpoints = stats.Progress.TotalEndpoints
	}
	if totalEndpoints == 0 {
		totalEndpoints = len(groups)
	}

	totalRequests := int64(0)
	if stats != nil {
		totalRequests = stats.TotalRequests
	}

	// Build finding rows
	var findingRows strings.Builder
	for _, key := range groupOrder {
		group := groups[key]
		parts := strings.SplitN(key, " ", 2)
		method, path := parts[0], parts[1]

		findingRows.WriteString(fmt.Sprintf(`
            <div class="finding-group" data-endpoint="%s">
                <h3><span class="method">%s</span> %s <span class="count">%d</span></h3>
                <div class="group-items">`, html.EscapeString(path), html.EscapeString(method), html.EscapeString(path), len(group)))

		for _, f := range group {
			payloadHTML := ""
			if f.Payload != nil {
				truncated := truncateValue(f.Payload)
				b, _ := json.MarshalIndent(truncated, "", "  ")
				payloadHTML = fmt.Sprintf(`
                    <div class="payload-block">
                        <h4>Payload</h4>
                        <pre><code>%s</code></pre>
                    </div>`, html.EscapeString(string(b)))
			}

			responseHTML := ""
			if f.ResponseBody != nil {
				truncated := truncateValue(f.ResponseBody)
				var display string
				if s, ok := truncated.(string); ok {
					display = s
				} else {
					b, _ := json.MarshalIndent(truncated, "", "  ")
					display = string(b)
				}
				responseHTML = fmt.Sprintf(`
                    <div class="payload-block">
                        <h4>Response Body</h4>
                        <pre><code>%s</code></pre>
                    </div>`, html.EscapeString(display))
			}

			owaspBadges := ""
			for _, cat := range f.OWASPAPICategory {
				parts := strings.SplitN(cat, " ", 2)
				owaspBadges += fmt.Sprintf(`<span class="badge" style="background:#7c3aed;color:#fff;">%s</span> `, html.EscapeString(parts[0]))
			}
			for _, cwe := range f.CWEIDs {
				owaspBadges += fmt.Sprintf(`<span class="badge" style="background:#0284c7;color:#fff;">%s</span> `, html.EscapeString(cwe))
			}

			findingRows.WriteString(fmt.Sprintf(`
                <div class="finding-item level-%s" data-status="%d" data-profile="%s">
                    <div class="finding-meta">
                        <span class="badge profile-%s">%s</span>
                        %s
                        <span class="status">HTTP %d</span>
                        <span class="duration">%dms</span>
                    </div>
                    %s
                    %s
                </div>`,
				f.Level, f.Status, f.Profile, f.Profile, f.Profile, owaspBadges, f.Status, f.Duration, payloadHTML, responseHTML))
		}

		findingRows.WriteString(`</div></div>`)
	}

	findingsContent := findingRows.String()
	if findingsContent == "" {
		findingsContent = `<p>No findings discovered. ✨</p>`
	}

	wafSectionHTML := ""
	if stats != nil && stats.WAFCheck != nil {
		detectedText := "No"
		statusColor := "var(--note)"
		if stats.WAFCheck.Detection.Detected {
			detectedText = "Yes"
			statusColor = "var(--error)"
		}

		var evidenceList strings.Builder
		if len(stats.WAFCheck.Detection.Evidence) > 0 {
			evidenceList.WriteString(`<ul style="margin: 0.5rem 0 0 1.25rem; padding: 0;">`)
			for _, ev := range stats.WAFCheck.Detection.Evidence {
				evidenceList.WriteString(fmt.Sprintf("<li>%s</li>", html.EscapeString(ev)))
			}
			evidenceList.WriteString("</ul>")
		} else {
			evidenceList.WriteString("None")
		}

		var bypassList strings.Builder
		var activeBypasses []string
		if stats.WAFCheck.BypassOpportunities.HTTPMethodsBypass {
			activeBypasses = append(activeBypasses, "HTTP Methods Bypass")
		}
		if stats.WAFCheck.BypassOpportunities.HeaderBypass {
			activeBypasses = append(activeBypasses, "Header Bypass")
		}
		if stats.WAFCheck.BypassOpportunities.EncodingBypass {
			activeBypasses = append(activeBypasses, "Encoding Bypass")
		}
		if stats.WAFCheck.BypassOpportunities.ParameterPollution {
			activeBypasses = append(activeBypasses, "Parameter Pollution")
		}
		if len(activeBypasses) > 0 {
			bypassList.WriteString(`<ul style="margin: 0.5rem 0 0 1.25rem; padding: 0;">`)
			for _, bp := range activeBypasses {
				bypassList.WriteString(fmt.Sprintf("<li>%s</li>", html.EscapeString(bp)))
			}
			bypassList.WriteString("</ul>")
		} else {
			bypassList.WriteString("None")
		}

		wafType := stats.WAFCheck.Detection.WAFType
		if wafType == "" {
			wafType = "None"
		}

		wafSectionHTML = fmt.Sprintf(`
        <h2>WAF Analysis</h2>
        <div class="stat-card" style="text-align: left; margin-bottom: 2rem;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
                <div><span class="stat-label">WAF Detected</span> <span style="font-weight: bold; color: %s;">%s</span></div>
                <div><span class="stat-label">Vendor</span> <span style="font-weight: bold;">%s</span></div>
                <div><span class="stat-label">Confidence</span> <span style="font-weight: bold;">%.0f%%</span></div>
            </div>
            <div style="margin-top: 1rem;">
                <span class="stat-label">Evidence</span>
                %s
            </div>
            <div style="margin-top: 1rem;">
                <span class="stat-label">Bypass Opportunities</span>
                %s
            </div>
        </div>`,
			statusColor,
			detectedText,
			html.EscapeString(wafType),
			math.Min(100, stats.WAFCheck.Detection.Confidence),
			evidenceList.String(),
			bypassList.String(),
		)
	}

	const placeholder = "/*__REPORT_JS__*/"
	tmpl := fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Swazz Fuzzing Report</title>
    <style>
        :root {
            --bg: #0f172a; --fg: #f1f5f9; --card: #1e293b;
            --border: #334155; --primary: #38bdf8;
            --error: #ef4444; --warning: #f59e0b; --note: #10b981;
        }
        body { background: var(--bg); color: var(--fg); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 2rem; line-height: 1.5; }
        .container { max-width: 1000px; margin: 0 auto; }
        header { margin-bottom: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem; }
        h1 { margin: 0; font-size: 1.875rem; color: var(--primary); }
        .timestamp { font-size: 0.875rem; color: #94a3b8; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 3rem; }
        .stat-card { background: var(--card); padding: 1.5rem; border-radius: 0.75rem; border: 1px solid var(--border); text-align: center; }
        .stat-value { font-size: 1.5rem; font-weight: bold; display: block; }
        .stat-label { font-size: 0.875rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
        .owasp-section { margin-bottom: 3rem; }
        .owasp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; }
        .owasp-card { background: var(--card); padding: 1.25rem; border-radius: 0.75rem; border: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
        .owasp-card.has-findings { border-color: var(--error); }
        .owasp-card.no-findings { opacity: 0.65; }
        .owasp-name { font-size: 0.875rem; font-weight: 500; }
        .owasp-count { font-size: 1.125rem; font-weight: bold; padding: 0.25rem 0.75rem; border-radius: 9999px; }
        .owasp-card.has-findings .owasp-count { background: rgba(239, 68, 68, 0.2); color: var(--error); }
        .owasp-card.no-findings .owasp-count { background: #475569; color: var(--fg); }
        .finding-group { background: var(--card); margin-bottom: 1.5rem; border-radius: 0.75rem; border: 1px solid var(--border); overflow: hidden; }
        .finding-group h3 { margin: 0; padding: 1rem 1.5rem; background: #273549; font-size: 1.125rem; display: flex; align-items: center; gap: 0.75rem; }
        .method { color: var(--primary); font-family: monospace; }
        .count { margin-left: auto; font-size: 0.875rem; background: #475569; padding: 0.125rem 0.5rem; border-radius: 9999px; }
        .finding-item { padding: 1rem 1.5rem; border-top: 1px solid var(--border); }
        .finding-meta { display: flex; gap: 1rem; align-items: center; margin-bottom: 0.5rem; font-size: 0.875rem; }
        .badge { padding: 0.125rem 0.5rem; border-radius: 0.25rem; font-size: 0.75rem; font-weight: bold; }
        .profile-RANDOM { background: #6366f1; } .profile-BOUNDARY { background: #8b5cf6; } .profile-MALICIOUS { background: #d946ef; }
        .status { color: var(--error); font-weight: bold; }
        .duration { color: #94a3b8; }
        .payload-block { margin-top: 1rem; }
        .payload-block h4 { margin: 0 0 0.5rem 0; font-size: 0.75rem; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.05em; }
        .payload-block pre { background: #0f172a; padding: 0.75rem; border-radius: 0.375rem; margin: 0; overflow-x: auto; }
        .payload-block code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.8125rem; word-break: break-all; white-space: pre-wrap; }
        .level-error { border-left: 4px solid var(--error); }
        .level-warning { border-left: 4px solid var(--warning); }
        .level-note { border-left: 4px solid var(--note); }
        .filters { display: flex; gap: 1rem; margin-bottom: 2rem; background: var(--card); padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border); }
        .filters input, .filters select { flex: 1; padding: 0.5rem; border-radius: 0.375rem; border: 1px solid var(--border); background: var(--bg); color: var(--fg); outline: none; }
        .filters input:focus, .filters select:focus { border-color: var(--primary); }
        @media print {
            body { background: white; color: black; }
            .filters, .owasp-section { display: none; }
            .finding-group { break-inside: avoid; border-color: #ccc; box-shadow: none; }
            .finding-group h3 { background: #f8fafc; color: #0f172a; border-bottom: 1px solid #ccc; }
            .finding-item { break-inside: avoid; }
            .payload-block pre { background: #f8fafc; color: black; border: 1px solid #ccc; white-space: pre-wrap; word-wrap: break-word; }
            .stat-card { border-color: #ccc; }
        }
        .noscript-warning {
            background: var(--warning); color: #000; padding: 1rem; border-radius: 0.5rem; margin: 1rem auto; max-width: 1000px; font-weight: bold; text-align: center;
        }
    </style>
</head>
<body>
    <noscript>
        <div class="noscript-warning">
            ⚠️ JavaScript is disabled. Filters and interactive features are unavailable, but all raw findings are displayed below.
        </div>
    </noscript>
    <div class="container">
        <header>
            <h1>Swazz Scan Report</h1>
            <div class="timestamp">Generated on %s &bull; Took %ds</div>
        </header>
        <div class="stats-grid">
            <div class="stat-card"><span class="stat-value">%d</span><span class="stat-label">Requests</span></div>
            <div class="stat-card"><span class="stat-value" style="color: var(--error)">%d</span><span class="stat-label">Errors</span></div>
            <div class="stat-card"><span class="stat-value" style="color: var(--warning)">%d</span><span class="stat-label">Warnings</span></div>
            <div class="stat-card"><span class="stat-value">%d</span><span class="stat-label">Endpoints</span></div>
        </div>
        %s

        <h2>OWASP API Security Top 10 (2023)</h2>
        <div class="owasp-section">
            <div class="owasp-grid">
                %s
            </div>
        </div>

        <h2>OWASP Top 10 (2025) Summary</h2>
        <div class="owasp-section">
            <div class="owasp-grid">
                %s
            </div>
        </div>

        <div class="filters">
            <input type="text" id="endpointFilter" placeholder="Filter by endpoint path...">
            <select id="statusFilter">
                <option value="">All Statuses</option>
                %s
            </select>
            <select id="profileFilter">
                <option value="">All Profiles</option>
                %s
            </select>
        </div>

        <h2>Findings</h2>
        <div class="findings-list">%s</div>
    </div>
    <script>
`+placeholder+`
    </script>
</body>
</html>`,
		timestamp, duration, totalRequests, errors, warnings, totalEndpoints, wafSectionHTML, owaspAPIGrid.String(), owaspGrid.String(), statusOptions.String(), profileOptions.String(), findingsContent)
	return strings.ReplaceAll(tmpl, placeholder, reportJS)
}

const valueLimit = 100

func truncateValue(val any) any {
	if val == nil {
		return nil
	}

	switch v := val.(type) {
	case string:
		if len(v) <= valueLimit {
			return v
		}
		// Check for simple repetition
		if len(v) > 0 {
			firstChar := v[0]
			isUniform := true
			for i := 1; i < len(v); i++ {
				if v[i] != firstChar {
					isUniform = false
					break
				}
			}
			if isUniform {
				return strings.Repeat(string(firstChar), 10) + fmt.Sprintf("... (%d repeats)", len(v))
			}
		}
		return v[:valueLimit] + fmt.Sprintf("... (%d chars more)", len(v)-valueLimit)

	case []any:
		if len(v) <= 5 {
			out := make([]any, len(v))
			for i, item := range v {
				out[i] = truncateValue(item)
			}
			return out
		}
		out := make([]any, 6)
		for i := 0; i < 5; i++ {
			out[i] = truncateValue(v[i])
		}
		out[5] = fmt.Sprintf("... (%d more items)", len(v)-5)
		return out

	case map[string]any:
		out := make(map[string]any, len(v))
		for k, item := range v {
			out[k] = truncateValue(item)
		}
		return out

	default:
		return val
	}
}
