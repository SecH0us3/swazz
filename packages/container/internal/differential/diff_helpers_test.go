// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package differential

import (
	"encoding/json"
	"testing"
)

func TestInferType(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		val  any
		want string
	}{
		{"object", map[string]any{"a": 1}, "object"},
		{"array", []any{1, 2}, "array"},
		{"string primitive", "x", "primitive"},
		{"float primitive", 1.5, "primitive"},
		{"json.Number primitive", json.Number("42"), "primitive"},
		{"bool primitive", true, "primitive"},
		{"null", nil, "null"},
		{"unknown struct", struct{}{}, "unknown"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := inferType(c.val); got != c.want {
				t.Errorf("inferType(%v) = %q, want %q", c.val, got, c.want)
			}
		})
	}
}

func TestIsCommonErrorText(t *testing.T) {
	t.Parallel()
	for _, s := range []string{
		"404 Not Found",
		"Request was UNAUTHORIZED",
		"Access Denied by policy",
		"403 Forbidden",
		"Internal Server Error occurred",
		"Bad Request: missing field",
	} {
		if !isCommonErrorText(s) {
			t.Errorf("isCommonErrorText(%q) = false, want true", s)
		}
	}
	for _, s := range []string{
		"welcome, authenticated user",
		`{"id": 1, "name": "Alice"}`,
		"",
	} {
		if isCommonErrorText(s) {
			t.Errorf("isCommonErrorText(%q) = true, want false", s)
		}
	}
}
