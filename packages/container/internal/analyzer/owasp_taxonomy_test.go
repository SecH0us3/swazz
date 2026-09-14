// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// canonicalOWASP2025 mirrors OWASP_CATEGORIES_METADATA in
// packages/web/src/components/OWASPTop10/OWASPTop10.tsx. The dashboard buckets a
// finding by matching the "Axx:2025" prefix, so a category emitted with the old
// 2021 numbering (Injection A03, Security Misconfiguration A05, Cryptographic
// Failures A02) is silently filed under the wrong 2025 card.
var canonicalOWASP2025 = map[string]bool{
	"A01:2025 Broken Access Control":                 true,
	"A02:2025 Security Misconfiguration":             true,
	"A03:2025 Software Supply Chain Failures":        true,
	"A04:2025 Cryptographic Failures":                true,
	"A05:2025 Injection":                             true,
	"A06:2025 Insecure Design":                       true,
	"A07:2025 Authentication Failures":               true,
	"A08:2025 Software or Data Integrity Failures":   true,
	"A09:2025 Security Logging & Alerting Failures":  true,
	"A10:2025 Mishandling of Exceptional Conditions": true,
}

var owaspLiteralRx = regexp.MustCompile(`"(A\d{2}:\d{4}[^"]*)"`)

// TestAnalyzerOWASPCategoriesAreCanonical guards against analyzers emitting
// OWASP Top 10 categories that the dashboard and reports cannot map.
func TestAnalyzerOWASPCategoriesAreCanonical(t *testing.T) {
	dirs := []string{".", filepath.Join("..", "differential"), filepath.Join("..", "runner")}

	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatalf("read dir %s: %v", dir, err)
		}
		for _, e := range entries {
			name := e.Name()
			if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
				continue
			}
			path := filepath.Join(dir, name)
			data, err := os.ReadFile(path) // #nosec G304 -- test-local source file
			if err != nil {
				t.Fatalf("read %s: %v", path, err)
			}
			for _, m := range owaspLiteralRx.FindAllStringSubmatch(string(data), -1) {
				if !canonicalOWASP2025[m[1]] {
					t.Errorf("%s emits non-canonical OWASP category %q; expected one of the OWASP Top 10 2025 titles", path, m[1])
				}
			}
		}
	}
}
