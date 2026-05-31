package output

import (
	"bytes"
	"fmt"
	"strings"
	"time"

	"swazz-engine/internal/classifier"
	"swazz-engine/internal/swagger"
)

// ToMarkdown generates a Markdown report for Swazz.
func ToMarkdown(findings []*classifier.Finding, stats *swagger.RunStats, version string) []byte {
	if version == "" {
		version = "1.0.0"
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

	durationSec := int64(0)
	totalRequests := int64(0)
	if stats != nil {
		if stats.StartTime > 0 {
			durationSec = (time.Now().UnixMilli() - stats.StartTime) / 1000
		}
		totalRequests = stats.TotalRequests
	}

	var sb bytes.Buffer

	// Title & Summary
	sb.WriteString(fmt.Sprintf("# 🛡️ Swazz API Fuzzer Report (v%s)\n\n", version))
	sb.WriteString(fmt.Sprintf("**Generated At**: %s\n\n", time.Now().UTC().Format(time.RFC3339)))
	
	sb.WriteString("## 📊 Executive Summary\n\n")
	sb.WriteString("| Metric | Value |\n")
	sb.WriteString("| --- | --- |\n")
	sb.WriteString(fmt.Sprintf("| Total Requests | %d |\n", totalRequests))
	sb.WriteString(fmt.Sprintf("| Duration | %ds |\n", durationSec))
	sb.WriteString(fmt.Sprintf("| Total Findings | %d |\n", len(findings)))
	sb.WriteString(fmt.Sprintf("| 🔴 Errors | %d |\n", errors))
	sb.WriteString(fmt.Sprintf("| 🟡 Warnings | %d |\n", warnings))
	sb.WriteString(fmt.Sprintf("| 🔵 Notes | %d |\n", notes))
	sb.WriteString("\n")

	// Group findings by Endpoint
	groupedByEndpoint := make(map[string][]*classifier.Finding)
	for _, f := range findings {
		groupedByEndpoint[f.Endpoint] = append(groupedByEndpoint[f.Endpoint], f)
	}

	sb.WriteString("## 🔍 Detailed Findings\n\n")
	if len(findings) == 0 {
		sb.WriteString("✅ **No vulnerabilities detected.**\n")
		return sb.Bytes()
	}

	for endpoint, epFindings := range groupedByEndpoint {
		sb.WriteString(fmt.Sprintf("### %s\n\n", endpoint))
		for _, f := range epFindings {
			sb.WriteString(fmt.Sprintf("#### [%s] %s\n", strings.ToUpper(string(f.Level)), f.RuleID))
			sb.WriteString(fmt.Sprintf("- **Path:** `%s`\n", f.ResolvedPath))
			if f.Method != "" {
				sb.WriteString(fmt.Sprintf("- **Method:** `%s`\n", f.Method))
			}
			if len(f.OWASPCategory) > 0 {
				sb.WriteString(fmt.Sprintf("- **OWASP Category:** %s\n", strings.Join(f.OWASPCategory, ", ")))
			}
			if f.Source != "" {
				sb.WriteString(fmt.Sprintf("- **Source:** `%s`\n", f.Source))
			}

			// Format payload and evidence safely
			if payloadPreview := previewString(f.Payload, 200); payloadPreview != "" && payloadPreview != "<nil>" {
				sb.WriteString("- **Sent Payload:**\n")
				sb.WriteString(fmt.Sprintf("  ```json\n  %s\n  ```\n", payloadPreview))
			}

			if evidencePreview := previewString(f.ResponseBody, 500); evidencePreview != "" && evidencePreview != "<nil>" {
				sb.WriteString("- **Response Preview:**\n")
				sb.WriteString(fmt.Sprintf("  ```text\n  %s\n  ```\n", evidencePreview))
			}
			sb.WriteString("\n")
		}
	}

	return sb.Bytes()
}

func previewString(v any, maxLen int) string {
	if v == nil {
		return ""
	}
	s := fmt.Sprintf("%v", v)
	if len(s) > maxLen {
		return s[:maxLen] + "..."
	}
	return s
}
