package security

import (
	"context"
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

func TestConfigureTransport_Nil(t *testing.T) {
	// Should not panic
	ConfigureTransport(nil)
}

type mockRoundTripper struct {
	called bool
}

func (m *mockRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	m.called = true
	return nil, nil
}

func TestWrapWithSSRFProtection(t *testing.T) {
	t.Run("Allow Private True", func(t *testing.T) {
		mockRt := &mockRoundTripper{}
		rt := WrapWithSSRFProtection(mockRt, true)
		if rt != mockRt {
			t.Error("expected original RoundTripper when allowPrivate is true")
		}
	})

	t.Run("Nil RoundTripper", func(t *testing.T) {
		rt := WrapWithSSRFProtection(nil, false)
		if rt == nil {
			t.Fatal("expected non-nil RoundTripper wrapper when passing nil")
		}
	})

	t.Run("Standard Transport Cloned", func(t *testing.T) {
		tr := &http.Transport{}
		rt := WrapWithSSRFProtection(tr, false)
		if rt == tr {
			t.Error("expected a cloned transport, not the original instance")
		}
		cloned, ok := rt.(*http.Transport)
		if !ok {
			t.Fatalf("expected cloned to be *http.Transport, got %T", rt)
		}
		if cloned.DialContext == nil {
			t.Error("expected DialContext to be overridden")
		}
	})

	t.Run("Non Standard RoundTripper wrapped", func(t *testing.T) {
		mockRt := &mockRoundTripper{}
		rt := WrapWithSSRFProtection(mockRt, false)
		if rt == mockRt {
			t.Error("expected mockRoundTripper to be wrapped, not returned directly")
		}
	})

	t.Run("Wrapped Transport Dial Private IP", func(t *testing.T) {
		tr := &http.Transport{}
		rt := WrapWithSSRFProtection(tr, false)
		cloned := rt.(*http.Transport)
		_, err := cloned.DialContext(context.Background(), "tcp", "127.0.0.1:80")
		if err == nil {
			t.Fatal("expected DialContext to fail for loopback IP")
		}
		if !strings.Contains(err.Error(), "blocked by SSRF policy") {
			t.Errorf("expected SSRF block error, got: %v", err)
		}
	})

	t.Run("Wrapped Transport Dial Invalid Host", func(t *testing.T) {
		tr := &http.Transport{}
		rt := WrapWithSSRFProtection(tr, false)
		cloned := rt.(*http.Transport)
		_, err := cloned.DialContext(context.Background(), "tcp", "non-existent-host-xyz.invalid:80")
		if err == nil {
			t.Fatal("expected dial to invalid host to fail")
		}
	})

	t.Run("Wrapped Transport with Original Dial Context", func(t *testing.T) {
		calledOrig := false
		tr := &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				calledOrig = true
				return nil, net.UnknownNetworkError("test")
			},
		}
		rt := WrapWithSSRFProtection(tr, false)
		cloned := rt.(*http.Transport)
		// Dialing a public IP to trigger the original dialer
		_, _ = cloned.DialContext(context.Background(), "tcp", "1.1.1.1:80")
		if !calledOrig {
			t.Error("expected the original dialer to be called for public IP dial")
		}
	})

	t.Run("Wrapped Transport Dial Public IP Literal", func(t *testing.T) {
		tr := &http.Transport{}
		rt := WrapWithSSRFProtection(tr, false)
		cloned := rt.(*http.Transport)
		// 1.1.1.1 is public, connection might fail but dialer branch is covered
		_, _ = cloned.DialContext(context.Background(), "tcp", "1.1.1.1:80")
	})

	t.Run("Wrapped Transport Dial Private Hostname", func(t *testing.T) {
		tr := &http.Transport{}
		rt := WrapWithSSRFProtection(tr, false)
		cloned := rt.(*http.Transport)
		// localhost resolves to loopback (private)
		_, err := cloned.DialContext(context.Background(), "tcp", "localhost:80")
		if err == nil {
			t.Fatal("expected dial to private hostname to fail")
		}
		if !strings.Contains(err.Error(), "blocked by SSRF policy") {
			t.Errorf("expected SSRF block error, got: %v", err)
		}
	})

	t.Run("NewSSRFProtectedTransport Dial Hostname", func(t *testing.T) {
		rt := NewSSRFProtectedTransport(false)
		tr := rt.(*http.Transport)
		_, err := tr.DialContext(context.Background(), "tcp", "localhost:80")
		if err == nil {
			t.Fatal("expected dial to private hostname to fail")
		}
		if !strings.Contains(err.Error(), "blocked by SSRF policy") {
			t.Errorf("expected SSRF block error, got: %v", err)
		}
	})

	t.Run("NewSSRFProtectedTransport Dial Public IP Literal", func(t *testing.T) {
		rt := NewSSRFProtectedTransport(false)
		tr := rt.(*http.Transport)
		_, _ = tr.DialContext(context.Background(), "tcp", "1.1.1.1:80")
	})
}



