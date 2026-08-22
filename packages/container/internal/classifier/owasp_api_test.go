// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package classifier

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEvaluateOWASPAPI_ContextualWeights(t *testing.T) {
	t.Run("BOLA on ID path gives API1:2023 with weight 1.0", func(t *testing.T) {
		ctx := &ClassificationContext{
			RuleID:   "swazz/bola-idor",
			Endpoint: "/api/v1/users/{id}/profile",
			Method:   "GET",
		}
		matches := EvaluateOWASPAPI(ctx)
		require.NotEmpty(t, matches)
		assert.Equal(t, "API1:2023 Broken Object Level Authorization", matches[0].Category)
		assert.Equal(t, 1.0, matches[0].Weight)
		assert.Equal(t, "CERTAIN", matches[0].Confidence)
		assert.Equal(t, "CWE-639", matches[0].CWE)
	})

	t.Run("No rate limit on /auth/login prioritizes API6:2023 Business Flows over API4", func(t *testing.T) {
		ctx := &ClassificationContext{
			RuleID:   "swazz/no-rate-limit",
			Endpoint: "/api/auth/login",
			Method:   "POST",
		}
		matches := EvaluateOWASPAPI(ctx)
		require.Len(t, matches, 2)
		// First item must be API6:2023 (Sensitive Business Flow) with higher weight
		assert.Equal(t, "API6:2023 Unrestricted Access to Sensitive Business Flows", matches[0].Category)
		assert.Equal(t, 0.96, matches[0].Weight)
		assert.Equal(t, "CERTAIN", matches[0].Confidence)
		assert.Equal(t, "CWE-799", matches[0].CWE)

		// Second item is API4:2023 (Unrestricted Resource Consumption) with lower weight
		assert.Equal(t, "API4:2023 Unrestricted Resource Consumption", matches[1].Category)
		assert.Equal(t, 0.65, matches[1].Weight)
	})

	t.Run("No rate limit on general /api/products gives API4:2023 with high weight", func(t *testing.T) {
		ctx := &ClassificationContext{
			RuleID:   "swazz/no-rate-limit",
			Endpoint: "/api/products",
			Method:   "GET",
		}
		matches := EvaluateOWASPAPI(ctx)
		require.Len(t, matches, 1)
		assert.Equal(t, "API4:2023 Unrestricted Resource Consumption", matches[0].Category)
		assert.Equal(t, 0.95, matches[0].Weight)
		assert.Equal(t, "CWE-770", matches[0].CWE)
	})

	t.Run("Unauthorized access on /admin path prioritizes API5:2023 BFLA", func(t *testing.T) {
		ctx := &ClassificationContext{
			RuleID:   "swazz/unauthorized-access",
			Endpoint: "/api/admin/users/delete",
			Method:   "DELETE",
		}
		matches := EvaluateOWASPAPI(ctx)
		require.NotEmpty(t, matches)
		assert.Equal(t, "API5:2023 Broken Function Level Authorization", matches[0].Category)
		assert.Equal(t, 0.98, matches[0].Weight)
		assert.Equal(t, "CWE-285", matches[0].CWE)
	})

	t.Run("SQL injection maps to API10:2023 Unsafe Consumption", func(t *testing.T) {
		ctx := &ClassificationContext{
			RuleID:   "swazz/sql-error-leak",
			Endpoint: "/api/search",
			Method:   "GET",
		}
		matches := EvaluateOWASPAPI(ctx)
		require.NotEmpty(t, matches)
		assert.Equal(t, "API10:2023 Unsafe Consumption of APIs", matches[0].Category)
		assert.Equal(t, 1.0, matches[0].Weight)
		assert.Equal(t, "CWE-89", matches[0].CWE)
	})

	t.Run("SSRF OOB interaction maps to API7:2023 SSRF", func(t *testing.T) {
		ctx := &ClassificationContext{
			RuleID:   "swazz/oob-interaction",
			Endpoint: "/api/webhook/test",
			Method:   "POST",
		}
		matches := EvaluateOWASPAPI(ctx)
		require.NotEmpty(t, matches)
		assert.Equal(t, "API7:2023 Server Side Request Forgery", matches[0].Category)
		assert.Equal(t, 1.0, matches[0].Weight)
		assert.Equal(t, "CWE-918", matches[0].CWE)
	})

	t.Run("CORS and Security headers map to API8:2023 Security Misconfiguration", func(t *testing.T) {
		ctx := &ClassificationContext{
			RuleID:   "swazz/cors-misconfig",
			Endpoint: "/api/data",
			Method:   "GET",
		}
		matches := EvaluateOWASPAPI(ctx)
		require.NotEmpty(t, matches)
		assert.Equal(t, "API8:2023 Security Misconfiguration", matches[0].Category)
		assert.Equal(t, "CWE-16", matches[0].CWE)
	})
}

func TestOWASPAPICategoriesAndCWEHelpers(t *testing.T) {
	cats := OWASPAPICategories("swazz/time-based-cmdi", "POST", "/api/exec", "")
	assert.Contains(t, cats, "API10:2023 Unsafe Consumption of APIs")

	cwes := CWEIdentifiers("swazz/time-based-cmdi", "POST", "/api/exec", "")
	assert.Contains(t, cwes, "CWE-78")

	nilCats := OWASPAPICategories("", "", "", "")
	assert.Nil(t, nilCats)
}
