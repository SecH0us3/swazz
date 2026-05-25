package security

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"time"
)

// IsPrivateIP checks if the given IP address is loopback, link-local, or private (RFC 1918 / RFC 4193).
func IsPrivateIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsPrivate()
}

// NewSSRFProtectedTransport returns an http.RoundTripper that blocks access to private IP addresses.
// It resolves hostnames and verifies all returned IPs before initiating a connection.
func NewSSRFProtectedTransport(allowPrivate bool) http.RoundTripper {
	if allowPrivate {
		return http.DefaultTransport
	}

	return &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				host = addr
			}

			// Check if host is an IP literal
			if ip := net.ParseIP(host); ip != nil {
				if IsPrivateIP(ip) {
					return nil, fmt.Errorf("request blocked by SSRF policy: target resolves to private IP")
				}
				var d net.Dialer
				return d.DialContext(ctx, network, addr)
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

			// Connect to the first resolved IP directly to mitigate DNS rebinding
			targetAddr := net.JoinHostPort(ips[0].String(), port)
			var d net.Dialer
			return d.DialContext(ctx, network, targetAddr)
		},
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 20,
		IdleConnTimeout:     90 * time.Second,
	}
}

// NewSSRFProtectedClient returns an http.Client wrapper using the SSRF-protected transport.
func NewSSRFProtectedClient(timeout time.Duration, allowPrivate bool) *http.Client {
	return &http.Client{
		Timeout:   timeout,
		Transport: NewSSRFProtectedTransport(allowPrivate),
	}
}
