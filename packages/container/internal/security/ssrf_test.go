package security

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestIsPrivateIP(t *testing.T) {
	tests := []struct {
		ip       string
		expected bool
	}{
		// IPv4 Private (RFC 1918)
		{"10.0.0.1", true},
		{"172.16.31.254", true},
		{"192.168.1.15", true},

		// IPv4 Loopback
		{"127.0.0.1", true},
		{"127.255.255.255", true},

		// IPv4 Unspecified
		{"0.0.0.0", true},

		// IPv4 Link-Local
		{"169.254.1.1", true},

		// IPv4 Public
		{"1.1.1.1", false},
		{"8.8.8.8", false},
		{"185.199.108.153", false},

		// IPv6 Loopback
		{"::1", true},

		// IPv6 Unspecified
		{"::", true},

		// IPv6 Unique Local
		{"fc00::1", true},
		{"fdff::ffff", true},

		// IPv6 Link-Local
		{"fe80::1", true},

		// IPv6 Public
		{"2606:4700:4700::1111", false},
	}

	for _, tc := range tests {
		ip := net.ParseIP(tc.ip)
		if ip == nil {
			t.Fatalf("failed to parse IP: %s", tc.ip)
		}
		res := IsPrivateIP(ip)
		if res != tc.expected {
			t.Errorf("IsPrivateIP(%s) = %v; want %v", tc.ip, res, tc.expected)
		}
	}
}

func TestSSRFProtectedClient(t *testing.T) {
	// Start a local test server
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	t.Run("SSRF Block Enabled", func(t *testing.T) {
		client := NewSSRFProtectedClient(2*time.Second, false)
		_, err := client.Get(ts.URL)
		if err == nil {
			t.Fatal("expected request to local server to be blocked, but it succeeded")
		}
		if !strings.Contains(err.Error(), "blocked by SSRF policy") {
			t.Errorf("expected SSRF block error, got: %v", err)
		}
	})

	t.Run("SSRF Block Disabled", func(t *testing.T) {
		client := NewSSRFProtectedClient(2*time.Second, true)
		resp, err := client.Get(ts.URL)
		if err != nil {
			t.Fatalf("expected request to local server to succeed when SSRF check is disabled: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("expected 200 OK, got: %d", resp.StatusCode)
		}
	})
}

func TestSSRFProtectedClient_InvalidHost(t *testing.T) {
	client := NewSSRFProtectedClient(2*time.Second, false)
	_, err := client.Get("http://non-existent-hostname-xyz-123456.com")
	if err == nil {
		t.Fatal("expected request to invalid host to fail")
	}
}

func TestSSRFProtectedClient_IPLiteralBlock(t *testing.T) {
	client := NewSSRFProtectedClient(2*time.Second, false)
	_, err := client.Get("http://127.0.0.1:9999")
	if err == nil {
		t.Fatal("expected request to localhost IP literal to fail")
	}
	if !strings.Contains(err.Error(), "blocked by SSRF policy") {
		t.Errorf("expected SSRF block error, got: %v", err)
	}
}
