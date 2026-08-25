// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestMaskSensitiveArgs(t *testing.T) {
	assert.Nil(t, maskSensitiveArgs(nil))

	empty := make(map[string]any)
	assert.Empty(t, maskSensitiveArgs(empty))

	input := map[string]any{
		"username":      "alice",
		"password":      "secret123",
		"bearer_token":  "xyz-token",
		"session_id":    "sess_abc",
		"csrf_token":    "csrf-value",
		"credentials":   map[string]any{"raw": "cert-data"},
		"public_field":  12345,
		"is_admin":      false,
		"nested": map[string]any{
			"api_key":   "sk-123456",
			"safe_data": "visible",
			"details": map[string]any{
				"private_note": "private-val",
				"normal":       "hello",
			},
		},
	}

	masked := maskSensitiveArgs(input)
	assert.Equal(t, "alice", masked["username"])
	assert.Equal(t, "[REDACTED]", masked["password"])
	assert.Equal(t, "[REDACTED]", masked["bearer_token"])
	assert.Equal(t, "[REDACTED]", masked["session_id"])
	assert.Equal(t, "[REDACTED]", masked["csrf_token"])
	assert.Equal(t, "[REDACTED]", masked["credentials"])
	assert.Equal(t, 12345, masked["public_field"])
	assert.Equal(t, false, masked["is_admin"])

	nested, ok := masked["nested"].(map[string]any)
	assert.True(t, ok)
	assert.Equal(t, "[REDACTED]", nested["api_key"])
	assert.Equal(t, "visible", nested["safe_data"])

	details, ok := nested["details"].(map[string]any)
	assert.True(t, ok)
	assert.Equal(t, "[REDACTED]", details["private_note"])
	assert.Equal(t, "hello", details["normal"])
}

func TestGetRandomUserAgent(t *testing.T) {
	ua := getRandomUserAgent()
	assert.NotEmpty(t, ua)
	assert.True(t, slices.Contains(userAgents, ua))
}

func TestProxyRotation(t *testing.T) {
	proxies := []string{"http://proxy1:8080", "http://proxy2:8080"}

	p1 := getNextProxy(proxies)
	p2 := getNextProxy(proxies)
	p3 := getNextProxy(proxies)

	assert.NotEmpty(t, p1)
	assert.NotEmpty(t, p2)
	assert.NotEmpty(t, p3)
	assert.Equal(t, "", getNextProxy(nil))
	assert.Equal(t, "", getNextProxy([]string{}))
}
