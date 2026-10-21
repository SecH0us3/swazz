// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package security

import (
	"context"
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

// SSRFDialContext returns the dial function every protocol executor must connect through: unless
// allowPrivate is set, it refuses any target that is, or resolves to, a private or reserved
// address (IsPrivateIP). HTTP gets it through NewSSRFProtectedTransport and
// WrapWithSSRFProtection; WebSocket and gRPC, which do not go through an http.Transport of the
// runner, take it directly, so no protocol reaches an address the HTTP one may not.
func SSRFDialContext(allowPrivate bool) DialFunc {
	base := newDialer().DialContext
	if allowPrivate {
		return base
	}
	return guardDial(base)
}

// guardDial wraps base so it only ever connects to public addresses. A hostname is resolved once,
// every resolved address is checked, and the connection goes to a checked address, never to the
// name again, so a DNS answer that changes between the check and the dial (rebinding) cannot
// slip a private address through.
func guardDial(base DialFunc) DialFunc {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			host = addr
		}

		// Check if host is an IP literal
		if ip := net.ParseIP(host); ip != nil {
			if IsPrivateIP(ip) {
				return nil, fmt.Errorf("request blocked by SSRF policy: target resolves to private IP")
			}
			return base(ctx, network, addr)
		}

		// Resolve host
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
				return nil, fmt.Errorf("request blocked by SSRF policy: target resolves to private IP")
			}
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
		return nil, fmt.Errorf("failed to connect to any resolved IPs: %w", lastErr)
	}
}

// NewSSRFProtectedTransport returns an http.RoundTripper that blocks access to private IP addresses.
// It resolves hostnames and verifies all returned IPs before initiating a connection.
func NewSSRFProtectedTransport(allowPrivate bool) http.RoundTripper {
	if allowPrivate {
		return http.DefaultTransport
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
