// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz

package security

import (
	"context"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestIsPrivateIP(t *testing.T) {
	assert.True(t, IsPrivateIP(net.ParseIP("127.0.0.1")))
	assert.True(t, IsPrivateIP(net.ParseIP("10.1.2.3")))
	assert.True(t, IsPrivateIP(net.ParseIP("192.168.1.1")))
	assert.True(t, IsPrivateIP(net.ParseIP("0.0.0.0")))
	
	assert.False(t, IsPrivateIP(net.ParseIP("8.8.8.8")))
	assert.False(t, IsPrivateIP(net.ParseIP("1.1.1.1")))
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

	// Test invalid host (trigger error)
	_, err = tr.DialContext(context.Background(), "tcp", "invalid-domain-that-does-not-exist.local:80")
	assert.Error(t, err)

	// Test unresolvable
	_, err = tr.DialContext(context.Background(), "tcp", "localhost.localdomain:80")
	// depending on system, it might resolve to loopback or fail to resolve
	if err != nil {
		if !strings.Contains(err.Error(), "no such host") && !strings.Contains(err.Error(), "blocked by SSRF policy") {
			t.Errorf("Unexpected error: %v", err)
		}
	}
}

func TestWrapWithSSRFProtection(t *testing.T) {
	trAllowed := WrapWithSSRFProtection(nil, true)
	assert.Nil(t, trAllowed)

	trDefault := WrapWithSSRFProtection(nil, false).(*http.Transport)
	assert.NotNil(t, trDefault.DialContext)

	origTr := &http.Transport{}
	wrapped := WrapWithSSRFProtection(origTr, false).(*http.Transport)
	assert.NotNil(t, wrapped.DialContext)
	// wrapped.DialContext is overriding origTr.DialContext (which is nil here)
	
	// test DialContext with literal
	_, err := wrapped.DialContext(context.Background(), "tcp", "127.0.0.1:80")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "SSRF policy")
	
	_, err = wrapped.DialContext(context.Background(), "tcp", "10.0.0.1:80")
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
}
