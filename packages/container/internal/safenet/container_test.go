// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package safenet

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsRunningInContainer_ReturnsBool(t *testing.T) {
	t.Parallel()

	// On a dev machine this will return false.
	// Inside Docker CI it will return true.
	// Either way it must not panic.
	result := IsRunningInContainer()
	assert.IsType(t, false, result)
}

func TestContainerIndicators_NotEmpty(t *testing.T) {
	t.Parallel()

	assert.NotEmpty(t, containerIndicators)
	assert.Contains(t, containerIndicators, "docker")
	assert.Contains(t, containerIndicators, "containerd")
	assert.Contains(t, containerIndicators, "kubepods")
}
