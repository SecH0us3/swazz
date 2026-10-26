// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"time"

	"swazz-engine/internal/safenet"
	"swazz-engine/internal/security"
)

// proxiedClient returns the client for requests sent through the run's proxies
// (Settings.ProxyList): a copy of the runner's client whose transport takes the next proxy of the
// rotation for each request. Built once, its one transport keeps a pool of connections per proxy,
// so they are reused like direct ones instead of every request opening (and TLS-handshaking) a
// connection of its own; Close releases them.
//
// The list is read and checked once, when the client is built. One unusable entry fails every
// proxied request with the same error: a request never goes out without a proxy, and a run with a
// bad list does not quietly send part of its traffic through the good ones.
//
// The transport keeps the runner's dial guard. That guard checks the address it dials, which
// through a proxy is the proxy's, never the target's: it keeps a run from reaching a private
// network through a proxy on it, not a proxy elsewhere from reaching what that proxy can reach.
// The one exception is a proxy the runner's operator trusted (safenet.TrustProxies): it is dialed
// even at a private address (trustedProxyDial), and since the guard then checks nothing, a
// request goes through it only once its target passed the check the guard would have made
// (checkTrustedProxyTarget).
func (r *Runner) proxiedClient() *http.Client {
	r.proxyOnce.Do(func() {
		var transport *http.Transport
		if base, ok := r.client.Transport.(*http.Transport); ok {
			transport = base.Clone()
		} else {
			// Only a client given to New with private addresses allowed keeps a transport a proxy
			// cannot be set on (New guards every other one in an *http.Transport). Its requests
			// go through the proxies on a default transport rather than around them.
			transport = &http.Transport{}
			if def, ok := http.DefaultTransport.(*http.Transport); ok {
				transport = def.Clone()
			}
			security.ConfigureTransport(transport)
		}

		transport.DialContext = trustedProxyDial(transport.DialContext, r.client.Timeout)

		r.configMu.RLock()
		proxies, err := parseProxyList(r.config.Settings.ProxyList)
		allowPrivate := r.config.Security.AllowPrivateIPs
		r.configMu.RUnlock()
		if err != nil {
			r.logError("Proxy list: %v; every request sent through the proxies fails", err)
		}
		transport.Proxy = func(req *http.Request) (*url.URL, error) {
			if err != nil {
				return nil, err
			}
			i := int((r.proxyTurn.Add(1) - 1) % uint32(len(proxies))) // #nosec G115 -- a proxy list is far shorter than 2^32
			if !allowPrivate {
				if err := checkTrustedProxyTarget(req, proxies[i]); err != nil {
					return nil, err
				}
			}
			return proxies[i], nil
		}
		client := *r.client
		client.Transport = transport
		r.proxyClient.Store(&client)
	})
	return r.proxyClient.Load()
}

// trustedProxyDial wraps the proxied transport's dial so the operator's trusted proxies
// (safenet.IsTrustedProxy) are dialed without the private-address check, and every other address
// through guarded as before. It is only ever set on the proxied transport, whose dials all go to
// a proxy: a target at a trusted proxy's address is still checked on the direct transport.
// timeout bounds the dial like the client's requests (30s when the client sets none).
func trustedProxyDial(guarded security.DialFunc, timeout time.Duration) security.DialFunc {
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	direct := (&net.Dialer{Timeout: timeout, KeepAlive: 30 * time.Second}).DialContext
	if guarded == nil {
		guarded = direct
	}
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		if safenet.IsTrustedProxy(addr) {
			return direct(ctx, network, addr)
		}
		return guarded(ctx, network, addr)
	}
}

// checkTrustedProxyTarget refuses a request about to go through a trusted proxy when its target
// host is, or resolves to, a private or reserved address (security.ResolvePublic): through that
// proxy nothing else would check it. Other proxies are dialed through the guard, which refuses
// one at a private address, and are left as they were.
func checkTrustedProxyTarget(req *http.Request, proxy *url.URL) error {
	if !safenet.IsTrustedProxy(proxyDialAddr(proxy)) {
		return nil
	}
	if _, err := security.ResolvePublic(req.Context(), req.URL.Hostname()); err != nil {
		return fmt.Errorf("target %s through trusted proxy: %w", req.URL.Hostname(), err)
	}
	return nil
}

// proxyDialAddr is the address the transport dials for a proxy: its host and port, or the
// scheme's default port, as net/http does.
func proxyDialAddr(u *url.URL) string {
	port := u.Port()
	if port == "" {
		switch u.Scheme {
		case "https":
			port = "443"
		case "socks5", "socks5h":
			port = "1080"
		default:
			port = "80"
		}
	}
	return net.JoinHostPort(u.Hostname(), port)
}

// parseProxyList parses every proxy of the list, or fails on the first unusable one.
func parseProxyList(raw []string) ([]*url.URL, error) {
	if len(raw) == 0 {
		return nil, errors.New("no proxy configured")
	}
	proxies := make([]*url.URL, len(raw))
	for i, p := range raw {
		u, err := parseProxyURL(p, i)
		if err != nil {
			return nil, err
		}
		proxies[i] = u
	}
	return proxies, nil
}

// parseProxyURL parses an http, https or socks5 proxy URL. Its errors name the proxy by its
// position only: the URL may carry credentials, and the error lands in results and reports.
func parseProxyURL(raw string, index int) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("proxy #%d is not a valid URL", index+1)
	}
	switch u.Scheme {
	case "http", "https", "socks5", "socks5h":
	default:
		return nil, fmt.Errorf("proxy #%d needs an http, https or socks5 scheme", index+1)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("proxy #%d has no host", index+1)
	}
	return u, nil
}
