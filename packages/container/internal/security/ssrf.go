// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package security

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"

	"swazz-engine/internal/safenet"
)

const (
	MaxIdleConns        = 1000
	MaxIdleConnsPerHost = 1000
	IdleConnTimeout     = 90 * time.Second
)

// ConfigureTransport applies standard high-performance pool limits to a transport.
func ConfigureTransport(t *http.Transport) {
	if t == nil {
		return
	}
	t.MaxIdleConns = MaxIdleConns
	t.MaxIdleConnsPerHost = MaxIdleConnsPerHost
	t.IdleConnTimeout = IdleConnTimeout
}

// IsPrivateIP checks if the given IP address is loopback, link-local, private
// (RFC 1918 / RFC 4193), unspecified, or otherwise non-globally-routable
// (CGNAT, benchmark, multicast, reserved ranges, ...).
//
// This delegates to safenet.IsReservedOrPrivate rather than maintaining a
// second, independent CIDR list: two hand-written blocklists inevitably
// drift apart, and the gap between them is exactly the kind of SSRF bypass
// this function exists to prevent.
func IsPrivateIP(ip net.IP) bool {
	return safenet.IsReservedOrPrivate(ip)
}

// DialFunc is the signature of http.Transport.DialContext and net.Dialer.DialContext.
type DialFunc func(ctx context.Context, network, addr string) (net.Conn, error)

// newDialer is the dialer the SSRF-guarded dial functions use when not given one.
func newDialer() *net.Dialer {
	return &net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}
}

// ErrSSRFBlocked is the error, wrapped, of a connection the SSRF policy refused. A blocked target
// was never contacted: callers report it as a network error (status 0), never as a status the
// target could have answered with.
var ErrSSRFBlocked = errors.New("request blocked by SSRF policy")

// GuardedDialContext returns the dial function every protocol executor connects through when
// private addresses are not allowed: it refuses any target that is, or resolves to, a private or
// reserved address (IsPrivateIP). HTTP gets it through NewSSRFProtectedTransport and
// WrapWithSSRFProtection; WebSocket and gRPC, which do not go through an http.Transport of the
// runner, take it directly, so no protocol reaches an address the HTTP one may not.
func GuardedDialContext() DialFunc {
	return guardDial(newDialer().DialContext)
}

// ResolvePublic resolves host (a name or an IP literal) and returns its addresses, or an error
// wrapping ErrSSRFBlocked if any of them is private or reserved: one private answer blocks the
// whole host, whichever address a client would have picked.
func ResolvePublic(ctx context.Context, host string) ([]net.IP, error) {
	if ip := net.ParseIP(host); ip != nil {
		if IsPrivateIP(ip) {
			return nil, fmt.Errorf("%w: target resolves to private IP", ErrSSRFBlocked)
		}
		return []net.IP{ip}, nil
	}

	ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("failed to resolve host: %s", host)
	}
	// Check all resolved IPs to prevent DNS pinning/rebinding bypass
	for _, ip := range ips {
		if IsPrivateIP(ip) {
			return nil, fmt.Errorf("%w: target resolves to private IP", ErrSSRFBlocked)
		}
	}
	return ips, nil
}

// guardDial wraps base so it only ever connects to public addresses. A hostname is resolved once,
// every resolved address is checked (ResolvePublic), and the connection goes to a checked address,
// never to the name again, so a DNS answer that changes between the check and the dial
// (rebinding) cannot slip a private address through.
func guardDial(base DialFunc) DialFunc {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			host = addr
		}

		ips, err := ResolvePublic(ctx, host)
		if err != nil {
			return nil, err
		}

		// Connect to the resolved IPs directly to mitigate DNS rebinding.
		// We iterate over all resolved IPs to ensure connection reliability.
		var lastErr error
		for _, ip := range ips {
			conn, err := base(ctx, network, net.JoinHostPort(ip.String(), port))
			if err == nil {
				return conn, nil
			}
			lastErr = err
		}
		if net.ParseIP(host) != nil {
			return nil, lastErr
		}
		return nil, fmt.Errorf("failed to connect to any resolved IPs: %w", lastErr)
	}
}

// NewSSRFProtectedTransport returns an http.RoundTripper that blocks access to private IP addresses.
// It resolves hostnames and verifies all returned IPs before initiating a connection.
func NewSSRFProtectedTransport(allowPrivate bool) http.RoundTripper {
	if allowPrivate {
		// A clone, never http.DefaultTransport itself: callers set TLS options on what they get,
		// and on the shared one they would apply to every client in the process.
		if t, ok := http.DefaultTransport.(*http.Transport); ok {
			return t.Clone()
		}
		return &http.Transport{Proxy: http.ProxyFromEnvironment}
	}

	t := &http.Transport{
		DialContext: guardDial(newDialer().DialContext),
	}
	ConfigureTransport(t)
	return t
}

// WrapWithSSRFProtection wraps an existing RoundTripper with SSRF protection.
// If the RoundTripper is a *http.Transport, it clones it and overrides its DialContext
// to enforce SSRF filtering and prevent DNS rebinding.
func WrapWithSSRFProtection(rt http.RoundTripper, allowPrivate bool) http.RoundTripper {
	if allowPrivate {
		return rt
	}

	if rt == nil {
		return NewSSRFProtectedTransport(allowPrivate)
	}

	if t, ok := rt.(*http.Transport); ok {
		cloned := t.Clone()
		base := cloned.DialContext
		if base == nil {
			base = newDialer().DialContext
		}
		cloned.DialContext = guardDial(base)
		return cloned
	}

	// Fallback for non-standard RoundTripper
	return NewSSRFProtectedTransport(allowPrivate)
}

// NewSSRFProtectedClient returns an http.Client wrapper using the SSRF-protected transport.
func NewSSRFProtectedClient(timeout time.Duration, allowPrivate bool) *http.Client {
	return &http.Client{
		Timeout:   timeout,
		Transport: NewSSRFProtectedTransport(allowPrivate),
	}
}
