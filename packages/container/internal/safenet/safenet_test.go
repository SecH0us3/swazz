package safenet

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIsBlocked_PrivateRanges(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		ip      string
		blocked bool
	}{
		// RFC 1918 — 10.0.0.0/8
		{"10.0.0.1", "10.0.0.1", true},
		{"10.255.255.255", "10.255.255.255", true},

		// RFC 1918 — 172.16.0.0/12
		{"172.16.0.1", "172.16.0.1", true},
		{"172.31.255.255", "172.31.255.255", true},
		{"172.15.255.255 is public", "172.15.255.255", false},
		{"172.32.0.0 is public", "172.32.0.0", false},

		// RFC 1918 — 192.168.0.0/16
		{"192.168.0.1", "192.168.0.1", true},
		{"192.168.255.255", "192.168.255.255", true},

		// Loopback
		{"127.0.0.1", "127.0.0.1", true},
		{"127.255.255.255", "127.255.255.255", true},

		// Link-local (cloud metadata)
		{"169.254.169.254 metadata", "169.254.169.254", true},
		{"169.254.0.1", "169.254.0.1", true},

		// Public IPs — must NOT be blocked
		{"8.8.8.8 Google DNS", "8.8.8.8", false},
		{"1.1.1.1 Cloudflare", "1.1.1.1", false},
		{"93.184.216.34 example.com", "93.184.216.34", false},

		// IPv6 loopback
		{"::1 loopback", "::1", true},

		// IPv6 link-local
		{"fe80::1", "fe80::1", true},
		{"fe80::dead:beef", "fe80::dead:beef", true},

		// IPv6 public — must NOT be blocked
		{"2001:4860:4860::8888 Google", "2001:4860:4860::8888", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ip := net.ParseIP(tt.ip)
			require.NotNil(t, ip, "failed to parse IP %s", tt.ip)
			assert.Equal(t, tt.blocked, IsBlocked(ip))
		})
	}
}

func TestSafeDialContext_BlocksPrivateIP(t *testing.T) {
	t.Parallel()

	dial := SafeDialContext(5 * time.Second)
	ctx := context.Background()

	// 127.0.0.1 is always resolvable via localhost
	_, err := dial(ctx, "tcp", "127.0.0.1:80")
	require.Error(t, err)

	var blocked *ErrBlockedAddress
	assert.True(t, errors.As(err, &blocked), "expected ErrBlockedAddress, got: %T", err)
	assert.Equal(t, "127.0.0.1", blocked.Host)
}

func TestSafeDialContext_BlocksMetadataEndpoint(t *testing.T) {
	t.Parallel()

	dial := SafeDialContext(5 * time.Second)
	ctx := context.Background()

	_, err := dial(ctx, "tcp", "169.254.169.254:80")
	require.Error(t, err)

	var blocked *ErrBlockedAddress
	assert.True(t, errors.As(err, &blocked))
}

func TestSafeDialContext_InvalidAddress(t *testing.T) {
	t.Parallel()

	dial := SafeDialContext(5 * time.Second)
	ctx := context.Background()

	_, err := dial(ctx, "tcp", "no-port")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid address")
}

func TestErrBlockedAddress_Message(t *testing.T) {
	t.Parallel()

	err := &ErrBlockedAddress{Host: "evil.internal", IP: net.ParseIP("10.0.0.5")}
	msg := err.Error()
	assert.Contains(t, msg, "evil.internal")
	assert.Contains(t, msg, "10.0.0.5")
	assert.Contains(t, msg, "blocked")
}

func TestNewSafeHTTPClient_NotNil(t *testing.T) {
	t.Parallel()

	client := NewSafeHTTPClient(10 * time.Second)
	require.NotNil(t, client)
	assert.Equal(t, 10*time.Second, client.Timeout)
	require.NotNil(t, client.Transport)
}

func TestBlockedCIDRs_Initialised(t *testing.T) {
	t.Parallel()

	// We expect exactly 9 CIDR entries from init()
	assert.Len(t, blockedCIDRs, 9)
}
