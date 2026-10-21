// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"swazz-engine/internal/swagger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeProxy answers every request itself, as a forward proxy would after fetching the target, and
// counts the connections it accepts and closes.
type fakeProxy struct {
	*httptest.Server
	opened, closed atomic.Int32
	requests       atomic.Int32
}

func newFakeProxy(t *testing.T) *fakeProxy {
	t.Helper()
	p := &fakeProxy{}
	p.Server = httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.requests.Add(1)
		_, _ = w.Write([]byte(`{"via":"proxy"}`))
	}))
	p.Config.ConnState = func(_ net.Conn, s http.ConnState) {
		switch s {
		case http.StateNew:
			p.opened.Add(1)
		case http.StateClosed, http.StateHijacked:
			p.closed.Add(1)
		}
	}
	p.Start()
	t.Cleanup(p.Close)
	return p
}

func proxiedRunner(t *testing.T, allowPrivate bool, proxies ...string) *Runner {
	t.Helper()
	r := New(&swagger.Config{
		BaseURL:  "http://target.example",
		Security: swagger.SecurityConfig{AllowPrivateIPs: allowPrivate},
		Settings: swagger.Settings{TimeoutMs: 5000, ProxyList: proxies},
	}, nil)
	t.Cleanup(r.Close)
	return r
}

func getVia(t *testing.T, r *Runner) *swagger.FuzzResult {
	t.Helper()
	res := r.executeRequest(context.Background(), "http://target.example", "/items", "/items", "GET", nil, nil, nil, swagger.ProfileRandom, nil, nil, "")
	require.NotNil(t, res)
	return res
}

// Requests through a proxy share its connections instead of each opening one.
func TestProxyClient_ReusesConnections(t *testing.T) {
	proxy := newFakeProxy(t)
	r := proxiedRunner(t, true, proxy.URL)

	for range 5 {
		res := getVia(t, r)
		require.Equal(t, 200, res.Status, res.Error)
	}
	assert.EqualValues(t, 5, proxy.requests.Load(), "every request went through the proxy")
	assert.EqualValues(t, 1, proxy.opened.Load(), "one connection to the proxy, reused")
}

// The rotation takes the proxies in turn, and each keeps its own connection.
func TestProxyClient_OnePerProxy(t *testing.T) {
	a, b := newFakeProxy(t), newFakeProxy(t)
	r := proxiedRunner(t, true, a.URL, b.URL)

	for range 6 {
		res := getVia(t, r)
		require.Equal(t, 200, res.Status, res.Error)
	}
	assert.EqualValues(t, 3, a.requests.Load())
	assert.EqualValues(t, 3, b.requests.Load())
	assert.EqualValues(t, 1, a.opened.Load())
	assert.EqualValues(t, 1, b.opened.Load())
}

// Close releases the connections the proxy clients keep.
func TestProxyClient_CloseReleasesConnections(t *testing.T) {
	proxy := newFakeProxy(t)
	r := proxiedRunner(t, true, proxy.URL)
	require.Equal(t, 200, getVia(t, r).Status)
	assert.EqualValues(t, 0, proxy.closed.Load(), "kept idle for the next request")

	r.Close()
	assert.Eventually(t, func() bool { return proxy.closed.Load() == 1 }, 2*time.Second, 10*time.Millisecond)
}

// The proxy client copies the runner's transport, dial guard included: without private
// addresses allowed, a proxy on one is refused like a target on one would be.
func TestProxyClient_KeepsTheDialGuard(t *testing.T) {
	proxy := newFakeProxy(t)
	r := proxiedRunner(t, false, proxy.URL)

	res := getVia(t, r)
	assert.Equal(t, 0, res.Status)
	assert.NotEmpty(t, res.Error)
	assert.EqualValues(t, 0, proxy.requests.Load(), "nothing reached the proxy")
}

// A proxy that is not a usable URL fails the request; it never goes out without the proxy.
func TestProxyClient_UnusableProxyFailsClosed(t *testing.T) {
	var direct atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { direct.Add(1) }))
	t.Cleanup(target.Close)

	for _, proxy := range []string{
		"http://user:s3cret@bad host:80",
		"127.0.0.1:8080",         // no scheme
		"ftp://proxy.example:21", // not a proxy scheme
		"http://",                // no host
	} {
		r := proxiedRunner(t, true, proxy)
		res := r.executeRequest(context.Background(), target.URL, "/items", "/items", "GET", nil, nil, nil, swagger.ProfileRandom, nil, nil, "")
		require.NotNil(t, res)
		assert.Equal(t, 0, res.Status, proxy)
		assert.Contains(t, res.Error, "proxy #1", proxy)
		assert.NotContains(t, res.Error, "s3cret", "the error does not repeat the proxy URL")
	}
	assert.EqualValues(t, 0, direct.Load(), "no request bypassed the proxy")
}

func TestParseProxyURL(t *testing.T) {
	for _, ok := range []string{"http://p:3128", "https://p:443", "socks5://u:p@p:1080", "socks5h://p:1080"} {
		u, err := parseProxyURL(ok, 0)
		require.NoError(t, err, ok)
		assert.NotEmpty(t, u.Host)
	}
	_, err := parseProxyURL("p:3128", 2)
	assert.EqualError(t, err, "proxy #3 needs an http, https or socks5 scheme")
}

// A client the runner was given with a transport a proxy cannot be set on still gets the proxies,
// through a guarded default transport.
func TestProxyClient_CustomRoundTripper(t *testing.T) {
	proxy := newFakeProxy(t)
	r := New(&swagger.Config{
		BaseURL:  "http://target.example",
		Security: swagger.SecurityConfig{AllowPrivateIPs: true},
		Settings: swagger.Settings{TimeoutMs: 5000, ProxyList: []string{proxy.URL}},
	}, &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Error("the request skipped the proxy")
		return nil, http.ErrHandlerTimeout
	})})
	t.Cleanup(r.Close)

	res := getVia(t, r)
	assert.Equal(t, 200, res.Status, res.Error)
	assert.EqualValues(t, 1, proxy.requests.Load())
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }
