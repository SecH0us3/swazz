// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)

package security

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIsPrivateIP(t *testing.T) {
	// IPv4 Private / Loopback / Unspecified
	assert.True(t, IsPrivateIP(net.ParseIP("127.0.0.1")))
	assert.True(t, IsPrivateIP(net.ParseIP("10.1.2.3")))
	assert.True(t, IsPrivateIP(net.ParseIP("172.16.0.1")))
	assert.True(t, IsPrivateIP(net.ParseIP("192.168.1.1")))
	assert.True(t, IsPrivateIP(net.ParseIP("0.0.0.0")))
	assert.True(t, IsPrivateIP(net.ParseIP("169.254.169.254"))) // link-local / cloud metadata

	// IPv6 Private / Loopback / Link-local / Unique local
	assert.True(t, IsPrivateIP(net.ParseIP("::1")))
	assert.True(t, IsPrivateIP(net.ParseIP("fe80::1")))
	assert.True(t, IsPrivateIP(net.ParseIP("fc00::1")))
	assert.True(t, IsPrivateIP(net.ParseIP("::")))

	// Public IPs
	assert.False(t, IsPrivateIP(net.ParseIP("8.8.8.8")))
	assert.False(t, IsPrivateIP(net.ParseIP("1.1.1.1")))
	assert.False(t, IsPrivateIP(net.ParseIP("2001:4860:4860::8888")))
}

func TestConfigureTransport(t *testing.T) {
	tr := &http.Transport{}
	ConfigureTransport(tr)
	assert.Equal(t, MaxIdleConns, tr.MaxIdleConns)
	assert.Equal(t, MaxIdleConnsPerHost, tr.MaxIdleConnsPerHost)
	assert.Equal(t, IdleConnTimeout, tr.IdleConnTimeout)

	// should not panic
	ConfigureTransport(nil)
}

func TestNewSSRFProtectedTransport(t *testing.T) {
	trAllowed := NewSSRFProtectedTransport(true)
	assert.Equal(t, http.DefaultTransport, trAllowed)

	tr := NewSSRFProtectedTransport(false).(*http.Transport)
	assert.NotNil(t, tr.DialContext)

	// Test blocked IP
	_, err := tr.DialContext(context.Background(), "tcp", "127.0.0.1:80")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "SSRF policy")

	// Test blocked IP literal without port
	_, err = tr.DialContext(context.Background(), "tcp", "127.0.0.1")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "SSRF policy")

	// Test invalid host (trigger error)
	_, err = tr.DialContext(context.Background(), "tcp", "invalid-domain-that-does-not-exist.local:80")
	assert.Error(t, err)

	// Test unresolvable
	_, err = tr.DialContext(context.Background(), "tcp", "localhost.localdomain:80")
	if err != nil {
		if !strings.Contains(err.Error(), "no such host") && !strings.Contains(err.Error(), "blocked by SSRF policy") {
			t.Errorf("Unexpected error: %v", err)
		}
	}

	// Test with a local test server listening on loopback (should be blocked)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	req, err := http.NewRequestWithContext(context.Background(), "GET", ts.URL, nil)
	require.NoError(t, err)

	client := &http.Client{Transport: tr}
	_, err = client.Do(req)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "blocked by SSRF policy")
}

func TestWrapWithSSRFProtection(t *testing.T) {
	trAllowed := WrapWithSSRFProtection(nil, true)
	assert.Nil(t, trAllowed)

	dummy := &dummyRT{}
	assert.Equal(t, dummy, WrapWithSSRFProtection(dummy, true))

	trDefault := WrapWithSSRFProtection(nil, false).(*http.Transport)
	assert.NotNil(t, trDefault.DialContext)

	// origTr with custom DialContext
	origDialCalled := false
	origTr := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			origDialCalled = true
			return nil, fmt.Errorf("mock dial called")
		},
	}
	wrapped := WrapWithSSRFProtection(origTr, false).(*http.Transport)
	assert.NotNil(t, wrapped.DialContext)

	// test DialContext with literal private
	_, err := wrapped.DialContext(context.Background(), "tcp", "127.0.0.1:80")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "SSRF policy")

	_, err = wrapped.DialContext(context.Background(), "tcp", "10.0.0.1:80")
	assert.Error(t, err)

	// test DialContext with public IP literal triggering origDial
	_, err = wrapped.DialContext(context.Background(), "tcp", "8.8.8.8:53")
	assert.Error(t, err)
	assert.True(t, origDialCalled)

	// test DialContext with literal without port
	_, err = wrapped.DialContext(context.Background(), "tcp", "10.0.0.1")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "SSRF policy")

	// test DialContext without origDial
	wrappedNilDial := WrapWithSSRFProtection(&http.Transport{}, false).(*http.Transport)
	_, err = wrappedNilDial.DialContext(context.Background(), "tcp", "127.0.0.1:80")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "SSRF policy")

	// test DialContext with domain resolving to private IP
	_, err = wrappedNilDial.DialContext(context.Background(), "tcp", "localhost:80")
	if err != nil {
		assert.True(t, strings.Contains(err.Error(), "SSRF policy") || strings.Contains(err.Error(), "no such host"))
	}

	// test DialContext with unresolvable domain
	_, err = wrappedNilDial.DialContext(context.Background(), "tcp", "domain.that.does.not.exist.invalid:80")
	assert.Error(t, err)

	// test non-standard RoundTripper
	nonStd := WrapWithSSRFProtection(&dummyRT{}, false).(*http.Transport)
	assert.NotNil(t, nonStd.DialContext)
}

type dummyRT struct{}

func (d *dummyRT) RoundTrip(*http.Request) (*http.Response, error) { return nil, nil }

func TestNewSSRFProtectedClient(t *testing.T) {
	c := NewSSRFProtectedClient(5*time.Second, false)
	assert.NotNil(t, c)
	assert.Equal(t, 5*time.Second, c.Timeout)
	assert.NotNil(t, c.Transport)

	cAllowed := NewSSRFProtectedClient(10*time.Second, true)
	assert.NotNil(t, cAllowed)
	assert.Equal(t, 10*time.Second, cAllowed.Timeout)
	assert.Equal(t, http.DefaultTransport, cAllowed.Transport)
}
