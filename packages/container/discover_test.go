package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestParseDiscoverFlags(t *testing.T) {
	args := []string{
		"--namespace", "prod,staging",
		"--exclude-namespace", "kube-system",
		"--concurrency", "3",
		"--profiles", "BOUNDARY,MALICIOUS",
		"--output-dir", "/tmp/reports",
		"--upload-to", "local",
		"--upload-path", "/data/reports",
		"--sarif",
	}

	opts, err := parseDiscoverFlags(args)
	assert.NoError(t, err)
	assert.Equal(t, []string{"prod", "staging"}, opts.Namespaces)
	assert.Equal(t, []string{"kube-system"}, opts.ExcludeNamespaces)
	assert.Equal(t, 3, opts.Concurrency)
	assert.Equal(t, []string{"BOUNDARY", "MALICIOUS"}, opts.Profiles)
	assert.Equal(t, "/tmp/reports", opts.OutputDir)
	assert.Equal(t, "local", opts.UploadTo)
	assert.True(t, opts.SARIF)
}
