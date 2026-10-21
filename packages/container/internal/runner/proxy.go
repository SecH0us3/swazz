// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"

	"swazz-engine/internal/security"
)

// proxiedClient returns the client for requests sent through the run's proxies
// (Settings.ProxyList): a copy of the runner's client whose transport takes the next proxy of the
// rotation for each request. Built once, its one transport keeps a pool of connections per proxy,
// so they are reused like direct ones instead of every request opening (and TLS-handshaking) a
// connection of its own; Close releases them.
//
// The transport keeps the runner's dial guard. That guard checks the address it dials, which
// through a proxy is the proxy's, never the target's: it keeps a run from reaching a private
// network through a proxy on it, not a proxy elsewhere from reaching what that proxy can reach.
func (r *Runner) proxiedClient() *http.Client {
	r.proxyOnce.Do(func() {
		var transport *http.Transport
		if base, ok := r.client.Transport.(*http.Transport); ok {
			transport = base.Clone()
		} else {
			// Not a transport a proxy can be set on: a guarded default one goes through the proxies.
			transport = http.DefaultTransport.(*http.Transport).Clone()
			security.ConfigureTransport(transport)
			transport = security.WrapWithSSRFProtection(transport, r.config.Security.AllowPrivateIPs).(*http.Transport)
		}
		transport.Proxy = func(*http.Request) (*url.URL, error) { return r.nextProxy() }
		client := *r.client
		client.Transport = transport
		r.proxyClient = &client
	})
	return r.proxyClient
}

// nextProxy returns the next proxy of the rotation. A proxy that is not a usable URL fails the
// request instead of letting it go out without one.
func (r *Runner) nextProxy() (*url.URL, error) {
	proxies := r.config.Settings.ProxyList
	if len(proxies) == 0 {
		return nil, errors.New("no proxy configured")
	}
	i := int((r.proxyTurn.Add(1) - 1) % uint32(len(proxies))) // #nosec G115 -- a proxy list is far shorter than 2^32
	return parseProxyURL(proxies[i], i)
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
