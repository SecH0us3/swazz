// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseDiscoverFlags(t *testing.T) {
	// 1. Defaults
	opts, err := parseDiscoverFlags([]string{})
	require.NoError(t, err)
	assert.Equal(t, 5, opts.Concurrency)
	assert.Equal(t, 10, opts.Iterations)
	assert.Equal(t, []string{"kube-system", "kube-public", "kube-node-lease"}, opts.ExcludeNamespaces)
	assert.Equal(t, []string{"BOUNDARY", "MALICIOUS"}, opts.Profiles)
	assert.False(t, opts.DryRun)

	// 2. Custom values
	opts, err = parseDiscoverFlags([]string{
		"-namespace", "default,prod",
		"-exclude-namespace", "test-ns",
		"-concurrency", "8",
		"-profiles", "RANDOM",
		"-iterations", "25",
		"-dry-run",
		"-sarif",
		"-html",
		"-json",
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"default", "prod"}, opts.Namespaces)
	assert.Equal(t, []string{"test-ns"}, opts.ExcludeNamespaces)
	assert.Equal(t, 8, opts.Concurrency)
	assert.Equal(t, []string{"RANDOM"}, opts.Profiles)
	assert.Equal(t, 25, opts.Iterations)
	assert.True(t, opts.DryRun)
	assert.True(t, opts.SARIF)
	assert.True(t, opts.HTML)
	assert.True(t, opts.JSON)

	// 3. Validation errors
	_, err = parseDiscoverFlags([]string{"-concurrency", "0"})
	assert.Error(t, err)

	_, err = parseDiscoverFlags([]string{"-iterations", "-1"})
	assert.Error(t, err)
}

func TestRunDiscoverCLIErr_NotInCluster(t *testing.T) {
	// When run outside K8s cluster, InClusterConfig should return error
	err := runDiscoverCLIErr([]string{"-dry-run"})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to get in-cluster K8s config")
}
