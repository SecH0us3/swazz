// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package classifier

import (
	"testing"

	"swazz-engine/internal/swagger"
)

func TestRuleIDForResult(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		result *swagger.FuzzResult
		want   string
	}{
		{"timeout maps to swazz/timeout", &swagger.FuzzResult{Status: 0, Error: "request timed out after 10s"}, "swazz/timeout"},
		{"other transport error maps to network-error", &swagger.FuzzResult{Status: 0, Error: "connection refused"}, "swazz/network-error"},
		{"empty error with zero status maps to network-error", &swagger.FuzzResult{Status: 0}, "swazz/network-error"},
		{"http status is formatted", &swagger.FuzzResult{Status: 500}, "swazz/status-500"},
		{"ok status is formatted too", &swagger.FuzzResult{Status: 200}, "swazz/status-200"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := RuleIDForResult(c.result); got != c.want {
				t.Errorf("RuleIDForResult() = %q, want %q", got, c.want)
			}
		})
	}
}
