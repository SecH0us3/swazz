// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"bytes"
	"fmt"
	"strings"
	"swazz-engine/internal/sstistore"
	"swazz-engine/internal/swagger"
)

// SSTIAnalyzer flags template expressions the target evaluated. Store holds the run's randomized
// expressions (sstistore); without one only the fixed 7*7 and 7+'7' probes are recognised.
type SSTIAnalyzer struct {
	Store *sstistore.Store
}

var sstiRawExprBytes = map[string][]byte{
	"7*7":   []byte("7*7"),
	"7+'7'": []byte("7+'7'"),
}

var sstiEvalValBytes = map[string][]byte{
	"7*7":   []byte("49"),
	"7+'7'": []byte("77"),
}

func (a *SSTIAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if input.Profile != swagger.ProfileMalicious {
		return nil
	}

	sentStrings := input.sentStrings()
	if len(sentStrings) == 0 {
		return nil
	}

	var findings []swagger.AnalysisFinding

	for _, payloadStr := range sentStrings {
		if payloadStr == "" {
			continue
		}

		// First, check dynamic store
		if ctx, ok := a.Store.Get(payloadStr); ok {
			evalValBytes := []byte(ctx.Expected)
			rawExprBytes := []byte(ctx.RawExpr)
			allowGrouping := !strings.Contains(ctx.RawExpr, "'")
			if matchesEvaluatedNumber(input.ResponseBody, evalValBytes, allowGrouping) && !bytes.Contains(input.ResponseBody, rawExprBytes) {
				findings = append(findings, swagger.AnalysisFinding{
					RuleID:           "swazz/ssti-leak",
					Level:            "error",
					Message:          fmt.Sprintf("SSTI math expression '%s' evaluated to '%s' in the response without raw expression reflection.", ctx.RawExpr, ctx.Expected),
					Evidence:         fmt.Sprintf("Payload: %s | Evaluated: %s", payloadStr, ctx.Expected),
					OWASPAPICategory: []string{"API8:2023 Security Misconfiguration"},
					OWASPCategory:    []string{"A05:2025 Injection"},
					CWEIDs:           []string{"CWE-1336"},
				})
			}
			continue
		}

		// Fallback for static/non-registered payloads
		for rawExpr, rawExprBytes := range sstiRawExprBytes {
			if strings.Contains(payloadStr, rawExpr) {
				evalValBytes := sstiEvalValBytes[rawExpr]
				if hasStandaloneNumber(input.ResponseBody, evalValBytes) && !bytes.Contains(input.ResponseBody, rawExprBytes) {
					evalVal := string(evalValBytes)
					findings = append(findings, swagger.AnalysisFinding{
						RuleID:           "swazz/ssti-leak",
						Level:            "error",
						Message:          fmt.Sprintf("SSTI math expression '%s' evaluated to '%s' in the response without raw expression reflection.", rawExpr, evalVal),
						Evidence:         fmt.Sprintf("Payload: %s | Evaluated: %s", payloadStr, evalVal),
						OWASPAPICategory: []string{"API8:2023 Security Misconfiguration"},
						OWASPCategory:    []string{"A05:2025 Injection"},
						CWEIDs:           []string{"CWE-1336"},
					})
					break
				}
			}
		}
	}

	return findings
}

var thousandSeparators = [][]byte{
	[]byte(","),
	[]byte(" "),
	[]byte("\u00a0"),
	[]byte("\u202f"),
	[]byte("."),
}

func matchesEvaluatedNumber(body, evalValBytes []byte, allowGrouping bool) bool {
	if hasStandaloneNumber(body, evalValBytes) {
		return true
	}
	// Java FreeMarker and similar locale-aware engines format integers >= 1000 with
	// grouping separators (e.g. "28,497,417"). Pre-filter on the trailing 3 digits
	// and format into a stack buffer so non-matching responses incur zero allocations.
	if allowGrouping && len(evalValBytes) >= 4 && bytes.Contains(body, evalValBytes[len(evalValBytes)-3:]) {
		var buf [64]byte
		for _, sep := range thousandSeparators {
			if grouped := appendFormattedThousands(buf[:0], evalValBytes, sep); grouped != nil && hasStandaloneGroupedNumber(body, grouped, sep) {
				return true
			}
		}
	}
	return false
}

func hasStandaloneGroupedNumber(body, grouped, sep []byte) bool {
	if len(grouped) == 0 {
		return false
	}
	idx := 0
	for {
		i := bytes.Index(body[idx:], grouped)
		if i == -1 {
			return false
		}
		start := idx + i
		end := start + len(grouped)

		beforeOk := start == 0 || !isASCIIDigit(body[start-1])
		if beforeOk && start > len(sep) && bytes.Equal(body[start-len(sep):start], sep) && isASCIIDigit(body[start-len(sep)-1]) {
			beforeOk = false
		}
		afterOk := end >= len(body) || !isASCIIDigit(body[end])
		if afterOk && end+len(sep) < len(body) && bytes.Equal(body[end:end+len(sep)], sep) && isASCIIDigit(body[end+len(sep)]) {
			afterOk = false
		}

		if beforeOk && afterOk && !hasHexPrefix(body, start) {
			return true
		}
		idx = start + 1
	}
}

func appendFormattedThousands(dst, digits, sep []byte) []byte {
	n := len(digits)
	if n < 4 {
		return nil
	}
	for _, b := range digits {
		if !isASCIIDigit(b) {
			return nil
		}
	}
	rem := n % 3
	if rem == 0 {
		rem = 3
	}
	dst = append(dst, digits[:rem]...)
	for i := rem; i < n; i += 3 {
		dst = append(dst, sep...)
		dst = append(dst, digits[i:i+3]...)
	}
	return dst
}

func isASCIIDigit(b byte) bool {
	return b >= '0' && b <= '9'
}

func isASCIIAlpha(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
}

func isHexByte(b byte) bool {
	return isASCIIDigit(b) || (b >= 'a' && b <= 'f') || (b >= 'A' && b <= 'F')
}

// isInsideHexToken reports whether body[start:end] is part of a longer pure-hex token
// (e.g. "90" inside UUID segment "90be" or trace ID "4f8a49c2e1"), while allowing numbers
// attached to ordinary words (e.g. "name28497417").
func isInsideHexToken(body []byte, start, end int) bool {
	lo := start
	for lo > 0 && isHexByte(body[lo-1]) {
		lo--
	}
	hi := end
	for hi < len(body) && isHexByte(body[hi]) {
		hi++
	}
	if lo == start && hi == end {
		return false
	}
	if lo > 0 && isASCIIAlpha(body[lo-1]) {
		return false
	}
	if hi < len(body) && isASCIIAlpha(body[hi]) {
		return false
	}
	return true
}

func hasHexPrefix(body []byte, start int) bool {
	if start < 2 || body[start-2] != '0' || (body[start-1] != 'x' && body[start-1] != 'X') {
		return false
	}
	return start == 2 || (!isASCIIAlpha(body[start-3]) && !isASCIIDigit(body[start-3]))
}

// hasStandaloneNumber returns true if val appears in body as a standalone number,
// i.e. not immediately adjacent to other digit characters or embedded inside a hex/UUID token.
func hasStandaloneNumber(body, val []byte) bool {
	if len(val) == 0 {
		return false
	}
	idx := 0
	for {
		i := bytes.Index(body[idx:], val)
		if i == -1 {
			return false
		}
		start := idx + i
		end := start + len(val)

		beforeOk := start == 0 || !isASCIIDigit(body[start-1])
		afterOk := end >= len(body) || !isASCIIDigit(body[end])

		if beforeOk && afterOk && !hasHexPrefix(body, start) && !isInsideHexToken(body, start, end) {
			return true
		}
		idx = start + 1
	}
}
