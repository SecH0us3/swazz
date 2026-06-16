// Package safenet provides network-level security controls for the swazz runner
// operating in shared/cloud (agent) mode. It prevents SSRF attacks by blocking
// connections to private, loopback, and link-local addresses.
package safenet

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"time"
)

// blockedCIDRs contains all private/reserved IPv4 and IPv6 ranges that must
// not be reachable from a shared runner. This prevents an attacker from using
// a crafted OpenAPI spec to scan the internal network or reach cloud metadata
// endpoints (e.g. 169.254.169.254).
var blockedCIDRs []*net.IPNet

func init() {
	cidrs := []string{
		// RFC 1918 private ranges
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",

		// Loopback
		"127.0.0.0/8",

		// Link-local (includes cloud metadata 169.254.169.254)
		"169.254.0.0/16",

		// IPv6 loopback
		"::1/128",

		// IPv6 link-local
		"fe80::/10",

		// Unspecified addresses (bypasses to localhost on many systems)
		"0.0.0.0/8",
		"::/128",
	}

	for _, cidr := range cidrs {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			panic(fmt.Sprintf("safenet: bad CIDR %q: %v", cidr, err))
		}
		blockedCIDRs = append(blockedCIDRs, network)
	}
}

// ErrBlockedAddress is returned when a dial attempt targets a blocked IP.
type ErrBlockedAddress struct {
	Host string
	IP   net.IP
}

func (e *ErrBlockedAddress) Error() string {
	return fmt.Sprintf("safenet: connection to %s (%s) blocked — target is a private/reserved address", e.Host, e.IP)
}

// IsBlocked reports whether the given IP falls into any blocked CIDR range.
func IsBlocked(ip net.IP) bool {
	// Normalize to 4-byte representation if it's an IPv4 address
	// (handles IPv4-mapped IPv6 addresses like ::ffff:127.0.0.1)
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}

	for _, network := range blockedCIDRs {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// SafeDialContext returns a DialContext function that resolves the target host
// and rejects connections to any private/reserved IP address. It wraps the
// standard net.Dialer so TLS, timeouts, and keep-alives work normally.
func SafeDialContext(timeout time.Duration) func(ctx context.Context, network, addr string) (net.Conn, error) {
	dialer := &net.Dialer{
		Timeout:   timeout,
		KeepAlive: 30 * time.Second,
	}

	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, fmt.Errorf("safenet: invalid address %q: %w", addr, err)
		}

		// Resolve hostname to IPs — we must check every resolved address
		// because a DNS response may contain both safe and unsafe entries.
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, fmt.Errorf("safenet: DNS lookup failed for %q: %w", host, err)
		}

		for _, ipAddr := range ips {
			if IsBlocked(ipAddr.IP) {
				return nil, &ErrBlockedAddress{Host: host, IP: ipAddr.IP}
			}
		}

		// All resolved IPs are safe — dial the original address.
		// We dial with the resolved IP to prevent TOCTOU DNS rebinding.
		// Use the first resolved IP.
		if len(ips) > 0 {
			safeAddr := net.JoinHostPort(ips[0].IP.String(), port)
			return dialer.DialContext(ctx, network, safeAddr)
		}

		return dialer.DialContext(ctx, network, addr)
	}
}

// NewSafeHTTPClient creates an *http.Client that blocks outbound connections
// to private/reserved subnets. Use this in agent (shared/cloud) mode instead
// of a plain &http.Client{}.
func NewSafeHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			DialContext:         SafeDialContext(timeout),
			MaxIdleConns:        100,
			IdleConnTimeout:     90 * time.Second,
			TLSHandshakeTimeout: 10 * time.Second,
		},
	}
}
