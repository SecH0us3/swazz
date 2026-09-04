// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package classifier

import (
	"encoding/json"
	"fmt"

	"swazz-engine/internal/wafcheck"
)

var findingCategoryMap = map[string]string{
	"swazz/sql-error-leak":             "SQL Injection",
	"swazz/time-based-sqli":            "SQL Injection",
	"swazz/reflected-xss":              "XSS",
	"swazz/cmdi-leak":                  "Command Injection",
	"swazz/time-based-cmdi":            "Command Injection",
	"swazz/rce-leak":                   "Command Injection",
	"swazz/path-traversal-leak":        "Path Traversal",
	"swazz/ssrf-cloud-metadata":        "SSRF",
	"swazz/nosql-injection":            "NoSQL Injection",
	"swazz/xxe-leak":                   "XXE",
	"swazz/ssti-leak":                  "SSTI",
	"swazz/header-injection":           "CRLF Injection",
	"swazz/graphql-introspection-leak": "GraphQL Injection",
	"swazz/graphql-field-suggestion":   "GraphQL Injection",
	"swazz/graphql-complexity-limit":   "GraphQL Injection",
	"swazz/jwt-tampering":              "JWT Attack (Header)",
	"swazz/prototype-pollution":        "Prototype Pollution (JSON Body)",
}

func stringifyPayload(p any) string {
	if p == nil {
		return ""
	}
	if s, ok := p.(string); ok {
		return s
	}
	b, err := json.Marshal(p)
	if err == nil {
		return string(b)
	}
	return fmt.Sprintf("%v", p)
}

// ToAuditResultItems converts findings with a known category mapping into
// wafcheck.AuditResultItem for virtual-patch generation. Unmapped findings are skipped.
func ToAuditResultItems(findings []*Finding) []wafcheck.AuditResultItem {
	var items []wafcheck.AuditResultItem
	for _, f := range findings {
		if f == nil {
			continue
		}
		cat, ok := findingCategoryMap[f.RuleID]
		if !ok {
			continue
		}
		items = append(items, wafcheck.AuditResultItem{
			Category:       cat,
			Payload:        stringifyPayload(f.Payload),
			Method:         f.Method,
			Status:         f.Status,
			ResponseTimeMs: f.Duration,
		})
	}
	return items
}
