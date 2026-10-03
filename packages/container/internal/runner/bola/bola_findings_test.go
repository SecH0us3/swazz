// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package bola

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/swagger"
)

func TestFindings_IsIDParam(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		param    string
		expected bool
	}{
		{name: "exact id lowercase", param: "id", expected: true},
		{name: "exact id uppercase", param: "ID", expected: true},
		{name: "exact id mixed case", param: "Id", expected: true},
		{name: "exact uuid lowercase", param: "uuid", expected: true},
		{name: "exact uuid uppercase", param: "UUID", expected: true},
		{name: "suffix id camelCase (userId)", param: "userId", expected: true},
		{name: "suffix id snake_case (user_id)", param: "user_id", expected: true},
		{name: "suffix id uppercase (account_ID)", param: "account_ID", expected: true},
		{name: "suffix id with prefix (tenant_id)", param: "tenant_id", expected: true},
		{name: "plain name", param: "name", expected: false},
		{name: "plain title", param: "title", expected: false},
		{name: "contains id not as suffix (identity)", param: "identity", expected: false},
		{name: "contains id not as suffix (identifier)", param: "identifier", expected: false},
		{name: "empty string", param: "", expected: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.expected, isIDParam(tc.param))
		})
	}
}

func TestFindings_FirstPathParam(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		templatePath string
		expected     string
	}{
		{
			name:         "two path params returns first",
			templatePath: "/users/{id}/posts/{postId}",
			expected:     "id",
		},
		{
			name:         "single path param",
			templatePath: "/api/v1/items/{item_id}",
			expected:     "item_id",
		},
		{
			name:         "param at root segment",
			templatePath: "{category}/items",
			expected:     "category",
		},
		{
			name:         "no path param present",
			templatePath: "/api/v1/users/profile",
			expected:     "",
		},
		{
			name:         "empty braces in segment",
			templatePath: "/api/{}/profile",
			expected:     "",
		},
		{
			name:         "root path slash",
			templatePath: "/",
			expected:     "",
		},
		{
			name:         "empty string",
			templatePath: "",
			expected:     "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.expected, firstPathParam(tc.templatePath))
		})
	}
}

func TestFindings_BolaThreshold(t *testing.T) {
	t.Parallel()

	t.Run("configured threshold is returned", func(t *testing.T) {
		settings := swagger.Settings{BOLASimilarityThreshold: 0.92}
		assert.Equal(t, 0.92, bolaThreshold(settings))
	})

	t.Run("unset threshold defaults to package default 0.85", func(t *testing.T) {
		settings := swagger.Settings{}
		assert.Equal(t, 0.85, bolaThreshold(settings))
		assert.Equal(t, defaultBOLAThreshold, bolaThreshold(settings))
	})

	t.Run("negative threshold defaults to package default 0.85", func(t *testing.T) {
		settings := swagger.Settings{BOLASimilarityThreshold: -0.1}
		assert.Equal(t, defaultBOLAThreshold, bolaThreshold(settings))
	})
}

func TestFindings_FormatIdentityName(t *testing.T) {
	t.Parallel()

	tests := []struct {
		input    string
		expected string
	}{
		{input: "UserB", expected: "User B"},
		{input: "userb", expected: "User B"},
		{input: "USERB", expected: "User B"},
		{input: "UserA", expected: "UserA"},
		{input: "Alice", expected: "Alice"},
		{input: "Anonymous", expected: "Anonymous"},
		{input: "", expected: ""},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			assert.Equal(t, tc.expected, formatIdentityName(tc.input))
		})
	}
}

func TestFindings_GetPathPrefix(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		path     string
		expected string
	}{
		{
			name:     "path with param segments",
			path:     "/api/goods/{id}",
			expected: "/api/goods",
		},
		{
			name:     "path with multiple params and trailing parts",
			path:     "/api/goods/{id}/sub/{subId}",
			expected: "/api/goods",
		},
		{
			name:     "path without path params",
			path:     "/api/v1/goods",
			expected: "/api/v1/goods",
		},
		{
			name:     "path param at start",
			path:     "/{tenant}/api",
			expected: "",
		},
		{
			name:     "empty string",
			path:     "",
			expected: "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.expected, getPathPrefix(tc.path))
		})
	}
}

func TestFindings_ArePrefixesRelated(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		p1       string
		p2       string
		expected bool
	}{
		{
			name:     "related prefixes sharing first 2 segments",
			p1:       "/api/users",
			p2:       "/api/users/profile",
			expected: true,
		},
		{
			name:     "related prefixes sharing first 2 segments among 3",
			p1:       "/api/v1/users",
			p2:       "/api/v1/orders",
			expected: true,
		},
		{
			name:     "related single segment prefix",
			p1:       "/health",
			p2:       "/health",
			expected: true,
		},
		{
			name:     "unrelated second segment",
			p1:       "/api/users",
			p2:       "/api/orders",
			expected: false,
		},
		{
			name:     "unrelated first segment",
			p1:       "/v1/users",
			p2:       "/v2/users",
			expected: false,
		},
		{
			name:     "empty p1",
			p1:       "",
			p2:       "/api/users",
			expected: false,
		},
		{
			name:     "empty p2",
			p1:       "/api/users",
			p2:       "",
			expected: false,
		},
		{
			name:     "both empty",
			p1:       "",
			p2:       "",
			expected: false,
		},
		{
			name:     "root slashes only",
			p1:       "/",
			p2:       "/",
			expected: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.expected, arePrefixesRelated(tc.p1, tc.p2))
		})
	}
}

func TestFindings_MergeUniqueStrings(t *testing.T) {
	t.Parallel()

	t.Run("empty inputs produce empty output", func(t *testing.T) {
		res := mergeUniqueStrings(nil, nil)
		assert.Empty(t, res)
	})

	t.Run("disjoint slices are combined without loss", func(t *testing.T) {
		a := []string{"alpha", "beta"}
		b := []string{"gamma", "delta"}
		res := mergeUniqueStrings(a, b)
		assert.Len(t, res, 4)
		for _, s := range []string{"alpha", "beta", "gamma", "delta"} {
			assert.Contains(t, res, s)
		}
	})

	t.Run("overlapping slices are deduplicated", func(t *testing.T) {
		a := []string{"id", "userId", "email"}
		b := []string{"email", "name", "id"}
		res := mergeUniqueStrings(a, b)
		assert.Len(t, res, 4)
		for _, s := range []string{"id", "userId", "email", "name"} {
			assert.Contains(t, res, s)
		}
	})

	t.Run("internal duplicates in input are removed", func(t *testing.T) {
		a := []string{"item", "item"}
		b := []string{"item"}
		res := mergeUniqueStrings(a, b)
		assert.Equal(t, []string{"item"}, res)
	})
}

func TestFindings_ContainsFold(t *testing.T) {
	t.Parallel()

	list := []string{"Authorization", "X-Custom-Token", "Cookie"}

	t.Run("case insensitive match returns true", func(t *testing.T) {
		assert.True(t, containsFold(list, "authorization"))
		assert.True(t, containsFold(list, "AUTHORIZATION"))
		assert.True(t, containsFold(list, "cookie"))
		assert.True(t, containsFold(list, "Cookie"))
	})

	t.Run("missing element returns false", func(t *testing.T) {
		assert.False(t, containsFold(list, "X-Api-Key"))
		assert.False(t, containsFold(list, "auth"))
	})

	t.Run("empty slice returns false", func(t *testing.T) {
		assert.False(t, containsFold(nil, "Authorization"))
	})
}

func TestFindings_IdSourceFor(t *testing.T) {
	t.Parallel()

	d := &Detector{}

	t.Run("empty id returns Unknown", func(t *testing.T) {
		assert.Equal(t, "Unknown", d.idSourceFor(""))
	})

	t.Run("unrecorded id returns Unknown", func(t *testing.T) {
		assert.Equal(t, "Unknown", d.idSourceFor("non-existent-id"))
	})

	t.Run("recorded id returns its source endpoint", func(t *testing.T) {
		d.idSources.Store("id-12345", "/api/v1/accounts")
		assert.Equal(t, "/api/v1/accounts", d.idSourceFor("id-12345"))
	})
}

func TestFindings_BuildIDORFinding(t *testing.T) {
	t.Parallel()

	cand := &swagger.FuzzResult{Method: "GET"}

	t.Run("with targetID and paramName produces swazz/bola-idor error", func(t *testing.T) {
		f := buildIDORFinding("User B", cand, "/api/users/123", 200, "123", "id", "/api/users", 0.94)
		assert.Equal(t, "swazz/bola-idor", f.RuleID)
		assert.Equal(t, "error", f.Level)
		assert.Contains(t, f.Message, "Identity User B succeeded to access resource of Identity A.")
		assert.Contains(t, f.Evidence, "ID 123 mined from: /api/users")
		assert.Contains(t, f.Evidence, "Similarity: 0.94")
		assert.Contains(t, f.Evidence, "Endpoint: GET /api/users/123")
	})

	t.Run("with paramName but empty targetID produces swazz/bola-idor error", func(t *testing.T) {
		f := buildIDORFinding("User B", cand, "/api/items/sub", 200, "", "itemId", "", 0.88)
		assert.Equal(t, "swazz/bola-idor", f.RuleID)
		assert.Equal(t, "error", f.Level)
		assert.Contains(t, f.Message, "Identity User B succeeded to access resource of Identity A.")
	})

	t.Run("without targetID and paramName produces swazz/tenant-isolation-bypass warning", func(t *testing.T) {
		f := buildIDORFinding("User B", cand, "/api/admin/metrics", 200, "", "", "", 0.91)
		assert.Equal(t, "swazz/tenant-isolation-bypass", f.RuleID)
		assert.Equal(t, "warning", f.Level)
		assert.Contains(t, f.Message, "Tenant Isolation Bypass candidate")
		assert.Contains(t, f.Evidence, "Similarity: 0.91")
		assert.Contains(t, f.Evidence, "Endpoint: GET /api/admin/metrics")
	})
}

func TestFindings_BuildUnauthorizedFinding(t *testing.T) {
	t.Parallel()

	cand := &swagger.FuzzResult{Method: "DELETE"}

	t.Run("with targetID includes mined info", func(t *testing.T) {
		f := buildUnauthorizedFinding(cand, "/api/documents/doc-99", 204, "doc-99", "/api/documents", 0.96)
		assert.Equal(t, "swazz/unauthorized-access", f.RuleID)
		assert.Equal(t, "error", f.Level)
		assert.Contains(t, f.Message, "Unauthenticated access bypass vulnerability confirmed")
		assert.Contains(t, f.Evidence, "ID doc-99 mined from: /api/documents")
		assert.Contains(t, f.Evidence, "Endpoint: DELETE /api/documents/doc-99")
		assert.Contains(t, f.Evidence, "Similarity: 0.96")
	})

	t.Run("without targetID excludes mined info", func(t *testing.T) {
		f := buildUnauthorizedFinding(cand, "/api/public/ping", 200, "", "", 0.90)
		require.Equal(t, "swazz/unauthorized-access", f.RuleID)
		assert.Equal(t, "error", f.Level)
		assert.Contains(t, f.Message, "Unauthenticated access bypass vulnerability confirmed")
		assert.NotContains(t, f.Evidence, "mined from")
		assert.Contains(t, f.Evidence, "Endpoint: DELETE /api/public/ping")
		assert.Contains(t, f.Evidence, "Similarity: 0.90")
	})
}
