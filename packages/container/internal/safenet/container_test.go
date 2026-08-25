// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)

package safenet

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsRunningInContainer(t *testing.T) {
	// 1. When CLOUDFLARE_APPLICATION_ID is set, should report true
	t.Setenv("CLOUDFLARE_APPLICATION_ID", "app-12345")
	assert.True(t, IsRunningInContainer())

	// 2. When unset, executes file / cgroup checks
	t.Setenv("CLOUDFLARE_APPLICATION_ID", "")
	_ = IsRunningInContainer()
}

func TestAssertRunningInContainer_Bypass(t *testing.T) {
	origAllow := AllowLocalNetwork
	defer func() { AllowLocalNetwork = origAllow }()

	// 1. allowBypass = true
	AllowLocalNetwork = false
	AssertRunningInContainer(true)
	assert.True(t, AllowLocalNetwork)

	// 2. SWAZZ_DEV = "1"
	AllowLocalNetwork = false
	t.Setenv("SWAZZ_DEV", "1")
	AssertRunningInContainer(false)
	assert.True(t, AllowLocalNetwork)
}
