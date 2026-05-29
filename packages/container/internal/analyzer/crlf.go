package analyzer

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"swazz-engine/internal/swagger"
)

// CRLFAnalyzer detects successful CRLF injection and header injection by
// inspecting HTTP response headers for evidence that attacker-controlled
// header names or values were injected via CRLF sequences in fuzz payloads.
type CRLFAnalyzer struct {
	// headerInjectionRe matches "HeaderName: Value" patterns that may appear
	// after a CRLF sequence in a payload string.
	headerInjectionRe *regexp.Regexp
}

// NewCRLFAnalyzer creates a CRLFAnalyzer with pre-compiled regex patterns.
func NewCRLFAnalyzer() *CRLFAnalyzer {
	return &CRLFAnalyzer{
		// Match header lines: "Header-Name: value" (canonical HTTP header format)
		headerInjectionRe: regexp.MustCompile(`(?i)^([A-Za-z0-9][A-Za-z0-9\-_]*)\s*:\s*(.+)$`),
	}
}

// Analyze checks whether CRLF injection payloads successfully injected
// headers into the HTTP response. It implements the ResponseAnalyzer interface.
func (a *CRLFAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if input == nil {
		return nil
	}
	if input.Profile != swagger.ProfileMalicious {
		return nil
	}
	if input.ResponseHeaders == nil {
		return nil
	}

	sentStrings := extractStrings(input.SentPayload)
	if len(sentStrings) == 0 {
		return nil
	}

	var findings []swagger.AnalysisFinding

	for _, payloadStr := range sentStrings {
		if payloadStr == "" {
			continue
		}

		// Check for CRLF-injected headers in the response
		findings = append(findings, a.checkInjectedHeaders(payloadStr, input.ResponseHeaders)...)

		// Check for CORS origin reflection
		findings = append(findings, a.checkCORSReflection(payloadStr, input.ResponseHeaders)...)
	}

	return findings
}

// checkInjectedHeaders extracts header name/value pairs from CRLF sequences
// in the payload and checks if they appear in the response headers.
func (a *CRLFAnalyzer) checkInjectedHeaders(payload string, respHeaders http.Header) []swagger.AnalysisFinding {
	injectedHeaders := a.extractInjectedHeaders(payload)
	if len(injectedHeaders) == 0 {
		return nil
	}

	var findings []swagger.AnalysisFinding
	for _, ih := range injectedHeaders {
		headerName := http.CanonicalHeaderKey(ih.name)
		responseValues := respHeaders[headerName]
		if len(responseValues) == 0 {
			continue
		}

		// Check if any response value matches (or contains) the injected value
		for _, rv := range responseValues {
			trimmedRv := strings.TrimSpace(rv)
			trimmedIv := strings.TrimSpace(ih.value)

			exactMatch := strings.EqualFold(trimmedRv, trimmedIv)
			isSetCookie := strings.EqualFold(ih.name, "Set-Cookie")
			var substringMatch bool
			if isSetCookie {
				partsRv := strings.Split(trimmedRv, ";")
				partsIv := strings.Split(trimmedIv, ";")
				if len(partsRv) > 0 && len(partsIv) > 0 {
					cookiePartRv := strings.TrimSpace(partsRv[0])
					cookiePartIv := strings.TrimSpace(partsIv[0])
					substringMatch = strings.EqualFold(cookiePartRv, cookiePartIv) || strings.HasPrefix(strings.ToLower(cookiePartRv), strings.ToLower(cookiePartIv)+"=")
				}
			} else {
				substringMatch = len(trimmedIv) >= 4 && strings.Contains(strings.ToLower(trimmedRv), strings.ToLower(trimmedIv))
			}

			if exactMatch || substringMatch {
				ruleID := "swazz/crlf-injection"
				message := fmt.Sprintf("CRLF header injection confirmed: header '%s: %s' was injected into the HTTP response.", ih.name, ih.value)

				// Distinguish Set-Cookie injection specifically
				if strings.EqualFold(ih.name, "Set-Cookie") {
					message = fmt.Sprintf("Set-Cookie injection via CRLF: injected cookie '%s' found in response.", ih.value)
				}

				findings = append(findings, swagger.AnalysisFinding{
					RuleID:   ruleID,
					Level:    "error",
					Message:  message,
					Evidence: fmt.Sprintf("Injected header found in response — %s: %s", headerName, rv),
				})
				break // one finding per injected header is enough
			}
		}
	}

	return findings
}

var payloadNormalizer = strings.NewReplacer(
	"%u000d", "%0d",
	"%u000D", "%0D",
	"%u000a", "%0a",
	"%u000A", "%0A",
	"%E5%98%8D", "%0D",
	"%e5%98%8d", "%0d",
	"%E5%98%8A", "%0A",
	"%e5%98%8a", "%0a",
	"\u560d", "\r",
	"\u560a", "\n",
)

var suspiciousOrigins = []string{
	"evil.com",
	"attacker.com",
	"null",
}

var crlfReplacer = strings.NewReplacer("\r\n", "\n", "\r", "\n")

// injectedHeader represents a header name/value pair extracted from a CRLF payload.
type injectedHeader struct {
	name  string
	value string
}

// extractInjectedHeaders parses CRLF payloads to find header name: value pairs.
// It handles both raw CRLF (\r\n) and URL-encoded CRLF (%0d%0a) sequences.
func (a *CRLFAnalyzer) extractInjectedHeaders(payload string) []injectedHeader {
	// Normalize alternative/unicode CRLF representations to standard percent encoding or raw CRLF
	normalizedPayload := payloadNormalizer.Replace(payload)

	var results []injectedHeader

	// Strategy 1: Split on raw CRLF sequences (\r\n, \r, \n)
	results = append(results, a.parseHeadersFromLines(splitOnCRLF(normalizedPayload))...)

	// Strategy 2a: Path-decode the payload and split on CRLF (preserves +)
	decodedPath, err := url.PathUnescape(normalizedPayload)
	if err == nil && decodedPath != normalizedPayload {
		results = append(results, a.parseHeadersFromLines(splitOnCRLF(decodedPath))...)

		// Try to decode it twice (for double URL-encoded payloads)
		doubleDecodedPath, err2 := url.PathUnescape(decodedPath)
		if err2 == nil && doubleDecodedPath != decodedPath {
			results = append(results, a.parseHeadersFromLines(splitOnCRLF(doubleDecodedPath))...)
		}
	}

	// Strategy 2b: Query-decode the payload and split on CRLF (decodes + to space)
	decodedQuery, err := url.QueryUnescape(normalizedPayload)
	if err == nil && decodedQuery != normalizedPayload {
		results = append(results, a.parseHeadersFromLines(splitOnCRLF(decodedQuery))...)

		// Try to decode it twice (for double URL-encoded payloads)
		doubleDecodedQuery, err2 := url.QueryUnescape(decodedQuery)
		if err2 == nil && doubleDecodedQuery != decodedQuery {
			results = append(results, a.parseHeadersFromLines(splitOnCRLF(doubleDecodedQuery))...)
		}
	}

	return deduplicateHeaders(results)
}

// parseHeadersFromLines matches each line against the header pattern regex.
func (a *CRLFAnalyzer) parseHeadersFromLines(lines []string) []injectedHeader {
	var results []injectedHeader

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		matches := a.headerInjectionRe.FindStringSubmatch(line)
		if len(matches) == 3 {
			results = append(results, injectedHeader{
				name:  matches[1],
				value: matches[2],
			})
		}
	}

	return results
}

// checkCORSReflection checks if the Access-Control-Allow-Origin header reflects
// an attacker-controlled value from the payload.
func (a *CRLFAnalyzer) checkCORSReflection(payload string, respHeaders http.Header) []swagger.AnalysisFinding {
	acaoValues := respHeaders["Access-Control-Allow-Origin"]
	if len(acaoValues) == 0 {
		return nil
	}

	payloadLower := strings.ToLower(payload)

	for _, acao := range acaoValues {
		acaoLower := strings.ToLower(strings.TrimSpace(acao))

		// Check if ACAO reflects a suspicious origin that was in the payload
		for _, origin := range suspiciousOrigins {
			var match bool
			if origin == "null" {
				match = payloadLower == "null" && acaoLower == "null"
			} else if strings.Contains(payloadLower, origin) {
				if u, err := url.Parse(acao); err == nil && u.Host != "" {
					hostname := strings.ToLower(u.Hostname())
					match = hostname == origin || strings.HasSuffix(hostname, "."+origin)
				} else {
					match = acaoLower == origin || strings.HasSuffix(acaoLower, "."+origin)
				}
			}
			if match {
				return []swagger.AnalysisFinding{{
					RuleID:   "swazz/header-injection",
					Level:    "warning",
					Message:  fmt.Sprintf("CORS misconfiguration: Access-Control-Allow-Origin reflects attacker-controlled value '%s'.", acao),
					Evidence: fmt.Sprintf("Access-Control-Allow-Origin: %s (payload contained '%s')", acao, origin),
				}}
			}
		}
	}

	return nil
}

// splitOnCRLF splits a string on any combination of \r\n, \r, or \n sequences.
// The first segment (before the first CRLF) is excluded since it's the original
// value — only lines after CRLF injections are of interest.
func splitOnCRLF(s string) []string {
	// Normalize line endings to standard \n (LF)
	normalized := crlfReplacer.Replace(s)

	parts := strings.Split(normalized, "\n")
	if len(parts) <= 1 {
		return nil
	}
	// Skip the first element — it's the content before the CRLF injection point
	return parts[1:]
}

// deduplicateHeaders removes duplicate injected headers by name (case-insensitive).
func deduplicateHeaders(headers []injectedHeader) []injectedHeader {
	seen := make(map[string]bool, len(headers))
	var unique []injectedHeader
	for _, h := range headers {
		key := strings.ToLower(h.name) + ":" + strings.ToLower(h.value)
		if !seen[key] {
			seen[key] = true
			unique = append(unique, h)
		}
	}
	return unique
}
