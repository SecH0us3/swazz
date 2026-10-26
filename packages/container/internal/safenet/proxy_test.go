// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package safenet

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTrustProxies(t *testing.T) {
	t.Cleanup(func() { _ = TrustProxies(nil) })

	require.NoError(t, TrustProxies([]string{"127.0.0.1:8080, [::1]:8081", "10.0.0.5:3128"}))
	for _, addr := range []string{"127.0.0.1:8080", "[::ffff:127.0.0.1]:8080", "[::1]:8081", "10.0.0.5:3128"} {
		assert.True(t, IsTrustedProxy(addr), addr)
	}
	for _, addr := range []string{"127.0.0.1:8081", "localhost:8080", "127.0.0.2:8080", "[::1]:8080", "127.0.0.1", "", "garbage"} {
		assert.False(t, IsTrustedProxy(addr), addr)
	}

	require.NoError(t, TrustProxies([]string{""}))
	assert.False(t, IsTrustedProxy("127.0.0.1:8080"))
}

// An entry that is not an IP literal with a port fails, and the previous list stays.
func TestTrustProxies_RejectsNonLiterals(t *testing.T) {
	t.Cleanup(func() { _ = TrustProxies(nil) })
	require.NoError(t, TrustProxies([]string{"127.0.0.1:8080"}))

	for _, bad := range []string{"localhost:8080", "127.0.0.1", "127.0.0.1:0", "[fe80::1%eth0]:8080", "http://127.0.0.1:8080", "127.0.0.1:8080,burp:8080"} {
		assert.Error(t, TrustProxies([]string{bad}), bad)
	}
	assert.True(t, IsTrustedProxy("127.0.0.1:8080"))
}
