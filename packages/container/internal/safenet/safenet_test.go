// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz

package safenet

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestIsBlocked(t *testing.T) {
	// Must mock AllowLocalNetwork to false for strict testing
	orig := AllowLocalNetwork
	AllowLocalNetwork = false
	defer func() { AllowLocalNetwork = orig }()

	assert.True(t, IsBlocked(net.ParseIP("127.0.0.1")))
	assert.True(t, IsBlocked(net.ParseIP("10.0.0.5")))
	assert.True(t, IsBlocked(net.ParseIP("192.168.1.1")))
	assert.True(t, IsBlocked(net.ParseIP("169.254.169.254")))
	assert.True(t, IsBlocked(net.ParseIP("::1")))

	// Should not block external IPs
	assert.False(t, IsBlocked(net.ParseIP("8.8.8.8")))
	assert.False(t, IsBlocked(net.ParseIP("1.1.1.1")))
}

func TestIsReservedOrPrivate_NilFailsClosed(t *testing.T) {
	// net.IPNet.Contains(nil) returns false for every network, so without an
	// explicit nil check a failed parse/resolve would read as "safe to dial".
	assert.True(t, IsReservedOrPrivate(nil))
}

func TestIsReservedOrPrivate_IANASpecialPurposeRanges(t *testing.T) {
	assert.True(t, IsReservedOrPrivate(net.ParseIP("192.0.0.1")))    // IETF Protocol Assignments / DS-Lite
	assert.True(t, IsReservedOrPrivate(net.ParseIP("192.0.2.1")))    // TEST-NET-1
	assert.True(t, IsReservedOrPrivate(net.ParseIP("198.51.100.1"))) // TEST-NET-2
	assert.True(t, IsReservedOrPrivate(net.ParseIP("203.0.113.1")))  // TEST-NET-3
	assert.True(t, IsReservedOrPrivate(net.ParseIP("192.88.99.1")))  // 6to4 relay anycast
	assert.True(t, IsReservedOrPrivate(net.ParseIP("2001:db8::1")))  // IPv6 documentation
	assert.True(t, IsReservedOrPrivate(net.ParseIP("64:ff9b::1")))   // NAT64 well-known prefix
	assert.True(t, IsReservedOrPrivate(net.ParseIP("64:ff9b:1::1"))) // NAT64 local-use prefix

	// Still not blocking real public IPs after the additions.
	assert.False(t, IsReservedOrPrivate(net.ParseIP("8.8.8.8")))
	assert.False(t, IsReservedOrPrivate(net.ParseIP("2001:4860:4860::8888")))
}

func TestIsBlocked_Allowed(t *testing.T) {
	orig := AllowLocalNetwork
	AllowLocalNetwork = true
	defer func() { AllowLocalNetwork = orig }()

	// Should not block anything if AllowLocalNetwork is true
	assert.False(t, IsBlocked(net.ParseIP("127.0.0.1")))
	assert.False(t, IsBlocked(net.ParseIP("10.0.0.5")))
}

func TestSafeDialContext_Blocked(t *testing.T) {
	orig := AllowLocalNetwork
	AllowLocalNetwork = false
	defer func() { AllowLocalNetwork = orig }()

	dialer := SafeDialContext(5 * time.Second)
	_, err := dialer(context.Background(), "tcp", "127.0.0.1:80")
	assert.Error(t, err)

	var blockedErr *ErrBlockedAddress
	assert.ErrorAs(t, err, &blockedErr)
	assert.Contains(t, err.Error(), "private/reserved address")
	assert.Equal(t, "127.0.0.1", blockedErr.Host)
}

func TestSafeDialContext_Allowed(t *testing.T) {
	orig := AllowLocalNetwork
	AllowLocalNetwork = true
	defer func() { AllowLocalNetwork = orig }()

	dialer := SafeDialContext(5 * time.Second)
	// It will try to dial 127.0.0.1 on a random closed port, which will fail with connection refused, not ErrBlockedAddress
	_, err := dialer(context.Background(), "tcp", "127.0.0.1:40001")
	assert.Error(t, err)
	// var blockedErr *ErrBlockedAddress
	importErrors := false
	_ = importErrors
	// we just want to ensure it's not a blocked error
	_, ok := err.(*ErrBlockedAddress)
	assert.False(t, ok)
}

func TestSafeDialContext_InvalidAddressAndDNS(t *testing.T) {
	orig := AllowLocalNetwork
	AllowLocalNetwork = false
	defer func() { AllowLocalNetwork = orig }()

	dialer := SafeDialContext(5 * time.Second)

	// 1. Invalid address format
	_, err := dialer(context.Background(), "tcp", "invalid-address-without-port")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "missing port")
}

func TestNewSafeHTTPClient(t *testing.T) {
	client := NewSafeHTTPClient(5 * time.Second)
	assert.NotNil(t, client)
	assert.Equal(t, 5*time.Second, client.Timeout)
	assert.NotNil(t, client.Transport)
}
