package security

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"time"
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

// IsPrivateIP checks if the given IP address is loopback, link-local, private (RFC 1918 / RFC 4193), or unspecified.
func IsPrivateIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsPrivate() || ip.IsUnspecified()
}

// NewSSRFProtectedTransport returns an http.RoundTripper that blocks access to private IP addresses.
// It resolves hostnames and verifies all returned IPs before initiating a connection.
func NewSSRFProtectedTransport(allowPrivate bool) http.RoundTripper {
	if allowPrivate {
		return http.DefaultTransport
	}

	t := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				host = addr
			}

			dialer := &net.Dialer{
				Timeout:   30 * time.Second,
				KeepAlive: 30 * time.Second,
			}

			// Check if host is an IP literal
			if ip := net.ParseIP(host); ip != nil {
				if IsPrivateIP(ip) {
					return nil, fmt.Errorf("request blocked by SSRF policy: target resolves to private IP")
				}
				return dialer.DialContext(ctx, network, addr)
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
				targetAddr := net.JoinHostPort(ip.String(), port)
				conn, err := dialer.DialContext(ctx, network, targetAddr)
				if err == nil {
					return conn, nil
				}
				lastErr = err
			}
			return nil, fmt.Errorf("failed to connect to any resolved IPs: %w", lastErr)
		},
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
		origDial := cloned.DialContext

		cloned.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				host = addr
			}

			dialer := &net.Dialer{
				Timeout:   30 * time.Second,
				KeepAlive: 30 * time.Second,
			}

			// Check if host is an IP literal
			if ip := net.ParseIP(host); ip != nil {
				if IsPrivateIP(ip) {
					return nil, fmt.Errorf("request blocked by SSRF policy: target resolves to private IP")
				}
				if origDial != nil {
					return origDial(ctx, network, addr)
				}
				return dialer.DialContext(ctx, network, addr)
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
				targetAddr := net.JoinHostPort(ip.String(), port)
				var conn net.Conn
				if origDial != nil {
					conn, err = origDial(ctx, network, targetAddr)
				} else {
					conn, err = dialer.DialContext(ctx, network, targetAddr)
				}
				if err == nil {
					return conn, nil
				}
				lastErr = err
			}
			return nil, fmt.Errorf("failed to connect to any resolved IPs: %w", lastErr)
		}
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
