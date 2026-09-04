// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package classifier

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestToAuditResultItems(t *testing.T) {
	findings := []*Finding{
		{
			RuleID:   "swazz/sql-error-leak",
			Method:   "GET",
			Status:   200,
			Duration: 55,
			Payload:  "' OR 1=1--",
		},
		{
			RuleID:   "swazz/cors-misconfig", // unmapped, should be skipped
			Method:   "OPTIONS",
			Status:   200,
			Duration: 10,
			Payload:  "https://evil.com",
		},
		{
			RuleID:   "swazz/prototype-pollution",
			Method:   "POST",
			Status:   200,
			Duration: 120,
			Payload:  map[string]any{"__proto__": map[string]any{"admin": true}},
		},
		nil, // nil finding should be skipped
		{
			RuleID:   "swazz/jwt-tampering",
			Method:   "POST",
			Status:   200,
			Duration: 30,
			Payload:  nil,
		},
	}

	items := ToAuditResultItems(findings)
	assert.Len(t, items, 3)

	// First item: SQL Injection
	assert.Equal(t, "SQL Injection", items[0].Category)
	assert.Equal(t, "' OR 1=1--", items[0].Payload)
	assert.Equal(t, "GET", items[0].Method)
	assert.Equal(t, 200, items[0].Status)
	assert.Equal(t, int64(55), items[0].ResponseTimeMs)

	// Second item: Prototype Pollution (JSON Body)
	assert.Equal(t, "Prototype Pollution (JSON Body)", items[1].Category)
	assert.Contains(t, items[1].Payload, "__proto__")
	assert.Equal(t, "POST", items[1].Method)
	assert.Equal(t, 200, items[1].Status)
	assert.Equal(t, int64(120), items[1].ResponseTimeMs)

	// Third item: JWT Attack (Header) with nil payload
	assert.Equal(t, "JWT Attack (Header)", items[2].Category)
	assert.Equal(t, "", items[2].Payload)
	assert.Equal(t, "POST", items[2].Method)
	assert.Equal(t, 200, items[2].Status)
	assert.Equal(t, int64(30), items[2].ResponseTimeMs)
}

func TestToAuditResultItems_Empty(t *testing.T) {
	items := ToAuditResultItems(nil)
	assert.Empty(t, items)

	items = ToAuditResultItems([]*Finding{})
	assert.Empty(t, items)
}

func TestToAuditResultItems_All17Mappings(t *testing.T) {
	assert.Len(t, findingCategoryMap, 17)
	for ruleID, cat := range findingCategoryMap {
		f := []*Finding{
			{
				RuleID:   ruleID,
				Method:   "GET",
				Status:   200,
				Duration: 10,
				Payload:  "test-payload",
			},
		}
		items := ToAuditResultItems(f)
		assert.Len(t, items, 1, "rule %s should be mapped", ruleID)
		assert.Equal(t, cat, items[0].Category)
	}
}
