// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package safenet

import (
	"fmt"
	"log"
	"net/netip"
	"strings"
	"sync/atomic"
)

// Trusted proxies are the private addresses a run may dial as its HTTP proxy (Settings.ProxyList)
// while private addresses are otherwise blocked: a local intercepting proxy such as Burp or ZAP
// on 127.0.0.1:8080. Only the runner's operator sets them, on the command line
// (--trusted-proxy); a scan's configuration can name a proxy but never make one trusted.
//
// Invariants: an address is exempt from the private-address check only when it is, exactly, an
// IP and port the operator listed, and only for the dial to a run's proxy; a proxy given by
// hostname is never exempt, since its name could resolve elsewhere. Targets are never exempt: a
// request sent through a trusted proxy goes out only if its target host resolves to public
// addresses only (runner/proxy.go), the check the runner would have made dialing it directly.
//
// Non-goals: the proxy resolves the target itself when it forwards the request, so a name it
// resolves differently from the runner (a DNS answer that changed since the runner's check, which
// it remembers for a minute; or another resolver, hosts file or split-horizon DNS on the proxy's
// machine) reaches whatever the proxy can reach. Every job on the runner may use a trusted proxy,
// so trust one only on a runner the operator alone uses.
var trustedProxies atomic.Pointer[map[netip.AddrPort]struct{}]

// TrustProxies sets the trusted proxies from entries of the form ip:port (IPv6 as [ip]:port),
// each possibly a comma-separated list. It fails, and trusts nothing new, on the first entry
// that is not an IP literal with a port.
func TrustProxies(entries []string) error {
	set := make(map[netip.AddrPort]struct{})
	for _, entry := range entries {
		for _, raw := range strings.Split(entry, ",") {
			raw = strings.TrimSpace(raw)
			if raw == "" {
				continue
			}
			ap, ok := parseProxyAddr(raw)
			if !ok {
				return fmt.Errorf("trusted proxy %q must be an IP address and port, such as 127.0.0.1:8080 or [::1]:8080", raw)
			}
			set[ap] = struct{}{}
		}
	}
	if len(set) == 0 {
		trustedProxies.Store(nil)
		return nil
	}
	log.Printf("WARNING: --trusted-proxy: requests may go through %d proxy address(es) on a private network", len(set))
	trustedProxies.Store(&set)
	return nil
}

// IsTrustedProxy reports whether addr, an address as a transport dials it (host:port), is one
// of the trusted proxies. Both sides go through parseProxyAddr, so 127.0.0.1 and its
// IPv4-mapped form compare equal, and a hostname never matches.
func IsTrustedProxy(addr string) bool {
	set := trustedProxies.Load()
	if set == nil {
		return false
	}
	ap, ok := parseProxyAddr(addr)
	if !ok {
		return false
	}
	_, trusted := (*set)[ap]
	return trusted
}

// parseProxyAddr parses ip:port into its canonical form (an IPv4-mapped IPv6 address becomes
// IPv4). It refuses hostnames, zones, and port 0.
func parseProxyAddr(s string) (netip.AddrPort, bool) {
	ap, err := netip.ParseAddrPort(s)
	if err != nil || ap.Port() == 0 || ap.Addr().Zone() != "" {
		return netip.AddrPort{}, false
	}
	return netip.AddrPortFrom(ap.Addr().Unmap(), ap.Port()), true
}
