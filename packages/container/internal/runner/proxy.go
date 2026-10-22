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
// The list is read and checked once, when the client is built. One unusable entry fails every
// proxied request with the same error: a request never goes out without a proxy, and a run with a
// bad list does not quietly send part of its traffic through the good ones.
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
			// Only a client given to New with private addresses allowed keeps a transport a proxy
			// cannot be set on (New guards every other one in an *http.Transport). Its requests
			// go through the proxies on a default transport rather than around them.
			transport = &http.Transport{}
			if def, ok := http.DefaultTransport.(*http.Transport); ok {
				transport = def.Clone()
			}
			security.ConfigureTransport(transport)
		}

		r.configMu.RLock()
		proxies, err := parseProxyList(r.config.Settings.ProxyList)
		r.configMu.RUnlock()
		if err != nil {
			r.logError("Proxy list: %v; every request sent through the proxies fails", err)
		}
		transport.Proxy = func(*http.Request) (*url.URL, error) {
			if err != nil {
				return nil, err
			}
			i := int((r.proxyTurn.Add(1) - 1) % uint32(len(proxies))) // #nosec G115 -- a proxy list is far shorter than 2^32
			return proxies[i], nil
		}
		client := *r.client
		client.Transport = transport
		r.proxyClient.Store(&client)
	})
	return r.proxyClient.Load()
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
