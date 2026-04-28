package output

import (
	"encoding/json"
	"fmt"
	"html"
	"strings"
	"time"

	"swazz-engine/internal/classifier"
	"swazz-engine/internal/swagger"
)

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

	// Group findings by endpoint
	groups := make(map[string][]*classifier.Finding)
	groupOrder := make([]string, 0)
	for _, f := range findings {
		key := fmt.Sprintf("%s %s", f.Method, f.Endpoint)
		if _, exists := groups[key]; !exists {
			groupOrder = append(groupOrder, key)
		}
		groups[key] = append(groups[key], f)
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
            <div class="finding-group">
                <h3><span class="method">%s</span> %s <span class="count">%d</span></h3>
                <div class="group-items">`, html.EscapeString(method), html.EscapeString(path), len(group)))

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

			findingRows.WriteString(fmt.Sprintf(`
                <div class="finding-item level-%s">
                    <div class="finding-meta">
                        <span class="badge profile-%s">%s</span>
                        <span class="status">HTTP %d</span>
                        <span class="duration">%dms</span>
                    </div>
                    %s
                    %s
                </div>`,
				f.Level, f.Profile, f.Profile, f.Status, f.Duration, payloadHTML, responseHTML))
		}

		findingRows.WriteString(`</div></div>`)
	}

	findingsContent := findingRows.String()
	if findingsContent == "" {
		findingsContent = `<p>No findings discovered. ✨</p>`
	}

	return fmt.Sprintf(`<!DOCTYPE html>
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
    </style>
</head>
<body>
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
        <h2>Findings</h2>
        <div class="findings-list">%s</div>
    </div>
</body>
</html>`,
		timestamp, duration, totalRequests, errors, warnings, totalEndpoints, findingsContent)
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
