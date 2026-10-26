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

	"swazz-engine/internal/safenet"
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

// trustProxies trusts the given proxies (safenet.TrustProxies) for the rest of the test.
func trustProxies(t *testing.T, entries ...string) {
	t.Helper()
	require.NoError(t, safenet.TrustProxies(entries))
	t.Cleanup(func() { _ = safenet.TrustProxies(nil) })
}

// trustedProxyRunner is a runner without private addresses allowed, whose requests go through
// the given proxies; client is the runner's client (nil for the CLI's default).
func trustedProxyRunner(t *testing.T, client *http.Client, proxies ...string) *Runner {
	t.Helper()
	r := New(&swagger.Config{
		BaseURL:  "http://93.184.216.34",
		Settings: swagger.Settings{TimeoutMs: 5000, ProxyList: proxies},
	}, client)
	t.Cleanup(r.Close)
	return r
}

func getTarget(t *testing.T, r *Runner, target string) *swagger.FuzzResult {
	t.Helper()
	res := r.executeRequest(context.Background(), target, "/items", "/items", "GET", nil, nil, nil, swagger.ProfileRandom, nil, nil, "")
	require.NotNil(t, res)
	return res
}

// A proxy the operator trusted is reached at a private address while private addresses are
// otherwise blocked, through the CLI's guarded client and the agent's safenet client alike. (The
// target is a public IP literal, so its check needs no DNS.)
func TestProxyClient_TrustedPrivateProxy(t *testing.T) {
	for _, tc := range []struct {
		name   string
		client *http.Client
	}{
		{"cli", nil},
		{"agent", safenet.NewSafeHTTPClient(5 * time.Second)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			proxy := newFakeProxy(t)
			trustProxies(t, proxy.Listener.Addr().String())
			r := trustedProxyRunner(t, tc.client, proxy.URL)

			res := getTarget(t, r, "http://93.184.216.34")
			require.Equal(t, 200, res.Status, res.Error)
			assert.EqualValues(t, 1, proxy.requests.Load())
		})
	}
}

// Through a trusted proxy the target is still checked: a private one never reaches the proxy.
func TestProxyClient_TrustedProxyChecksTheTarget(t *testing.T) {
	proxy := newFakeProxy(t)
	trustProxies(t, proxy.Listener.Addr().String())
	r := trustedProxyRunner(t, nil, proxy.URL)

	for _, target := range []string{"http://127.0.0.1:6379", "http://169.254.169.254", "http://[::1]"} {
		res := getTarget(t, r, target)
		assert.Equal(t, 0, res.Status, target)
		assert.Contains(t, res.Error, "trusted proxy", target)
	}
	assert.EqualValues(t, 0, proxy.requests.Load(), "nothing reached the proxy")
}

// A Host header picks the host a proxy forwards a plain-HTTP request to, so it is checked too.
func TestProxyClient_TrustedProxyChecksTheHostHeader(t *testing.T) {
	proxy := newFakeProxy(t)
	trustProxies(t, proxy.Listener.Addr().String())
	r := trustedProxyRunner(t, nil, proxy.URL)

	for _, host := range []string{"169.254.169.254", "127.0.0.1:6379", "[::1]:80"} {
		res := r.executeRequest(context.Background(), "http://93.184.216.34", "/items", "/items", "GET", map[string]string{"Host": host}, nil, nil, swagger.ProfileRandom, nil, nil, "")
		require.NotNil(t, res)
		assert.Equal(t, 0, res.Status, host)
	}
	assert.EqualValues(t, 0, proxy.requests.Load(), "nothing reached the proxy")

	res := r.executeRequest(context.Background(), "http://93.184.216.34", "/items", "/items", "GET", map[string]string{"Host": "93.184.216.35"}, nil, nil, swagger.ProfileRandom, nil, nil, "")
	require.NotNil(t, res)
	assert.Equal(t, 200, res.Status, res.Error)
}

func TestHostOnly(t *testing.T) {
	for in, want := range map[string]string{
		"example.com":      "example.com",
		"example.com:8080": "example.com",
		"127.0.0.1:6379":   "127.0.0.1",
		"[::1]:80":         "::1",
		"[::1]":            "::1",
	} {
		assert.Equal(t, want, hostOnly(in), in)
	}
}

// With private addresses allowed, a trusted proxy may take a private target like any proxy.
func TestProxyClient_TrustedProxyWithPrivateAllowed(t *testing.T) {
	proxy := newFakeProxy(t)
	trustProxies(t, proxy.Listener.Addr().String())
	r := proxiedRunner(t, true, proxy.URL)

	res := getTarget(t, r, "http://127.0.0.1:6379")
	require.Equal(t, 200, res.Status, res.Error)
}

// Trust is for the listed address only: a proxy at another private port, or named by a
// hostname, is still refused.
func TestProxyClient_TrustIsExact(t *testing.T) {
	proxy := newFakeProxy(t)
	_, port, err := net.SplitHostPort(proxy.Listener.Addr().String())
	require.NoError(t, err)
	trustProxies(t, "127.0.0.1:1")

	for _, url := range []string{proxy.URL, "http://localhost:" + port} {
		r := trustedProxyRunner(t, nil, url)
		res := getTarget(t, r, "http://93.184.216.34")
		assert.Equal(t, 0, res.Status, url)
	}
	assert.EqualValues(t, 0, proxy.requests.Load(), "nothing reached the proxy")
}

// A trusted proxy's address is trusted only as a proxy: a scan that targets it directly is
// blocked like any other private target.
func TestProxyClient_TrustedProxyIsNotATrustedTarget(t *testing.T) {
	proxy := newFakeProxy(t)
	trustProxies(t, proxy.Listener.Addr().String())
	r := trustedProxyRunner(t, nil)

	res := getTarget(t, r, proxy.URL)
	assert.Equal(t, 0, res.Status)
	assert.EqualValues(t, 0, proxy.requests.Load())
}

func TestProxyDialAddr(t *testing.T) {
	for raw, want := range map[string]string{
		"http://127.0.0.1:8080": "127.0.0.1:8080",
		"http://127.0.0.1":      "127.0.0.1:80",
		"https://[::1]":         "[::1]:443",
		"socks5://10.0.0.1":     "10.0.0.1:1080",
	} {
		u, err := parseProxyURL(raw, 0)
		require.NoError(t, err)
		assert.Equal(t, want, proxyDialAddr(u), raw)
	}
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

// One unusable entry fails every proxied request, not every Nth: a bad list is not quietly half
// used, and nothing goes out without a proxy.
func TestProxyClient_OneBadEntryFailsEveryRequest(t *testing.T) {
	proxy := newFakeProxy(t)
	r := proxiedRunner(t, true, proxy.URL, "proxy.example:3128")
	for range 4 {
		res := getVia(t, r)
		assert.Equal(t, 0, res.Status)
		assert.Contains(t, res.Error, "proxy #2")
	}
	assert.EqualValues(t, 0, proxy.requests.Load())
}

// Close may run while a worker builds the proxy client (go test -race).
func TestProxyClient_CloseDuringFirstUse(t *testing.T) {
	proxy := newFakeProxy(t)
	r := proxiedRunner(t, true, proxy.URL)
	done := make(chan struct{})
	go func() {
		defer close(done)
		r.proxiedClient()
	}()
	r.Close()
	<-done
}
