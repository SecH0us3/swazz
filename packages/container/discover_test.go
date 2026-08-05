package main

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestParseDiscoverFlags(t *testing.T) {
	t.Run("explicit arguments", func(t *testing.T) {
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
		assert.Equal(t, "/data/reports", opts.UploadPath)
		assert.True(t, opts.SARIF)
	})

	t.Run("default flags", func(t *testing.T) {
		opts, err := parseDiscoverFlags([]string{})
		assert.NoError(t, err)
		assert.Nil(t, opts.Namespaces)
		assert.Equal(t, []string{"kube-system", "kube-public", "kube-node-lease"}, opts.ExcludeNamespaces)
		assert.Equal(t, 5, opts.Concurrency)
		assert.Equal(t, []string{"BOUNDARY", "MALICIOUS"}, opts.Profiles)
		assert.Equal(t, 10, opts.Iterations)
		assert.Equal(t, "/tmp/swazz-discovery", opts.OutputDir)
		assert.Equal(t, "local", opts.UploadTo)
		assert.Equal(t, "", opts.UploadPath)
		assert.Equal(t, "", opts.CoordinatorURL)
		assert.Equal(t, "", opts.CoordinatorToken)
		assert.Equal(t, "", opts.WebhookURL)
		assert.False(t, opts.SARIF)
		assert.False(t, opts.HTML)
		assert.False(t, opts.JSON)
		assert.False(t, opts.DryRun)
	})

	t.Run("coordinator upload flags", func(t *testing.T) {
		args := []string{
			"--upload-to", "coordinator",
			"--coordinator-url", "http://coordinator.internal:8080",
			"--coordinator-token", "secret-token",
		}

		opts, err := parseDiscoverFlags(args)
		assert.NoError(t, err)
		assert.Equal(t, "coordinator", opts.UploadTo)
		assert.Equal(t, "http://coordinator.internal:8080", opts.CoordinatorURL)
		assert.Equal(t, "secret-token", opts.CoordinatorToken)
		assert.Equal(t, "", opts.UploadPath)
	})

	t.Run("invalid flag", func(t *testing.T) {
		_, err := parseDiscoverFlags([]string{"--invalid-flag"})
		assert.Error(t, err)
	})

	t.Run("invalid concurrency or iterations", func(t *testing.T) {
		_, err := parseDiscoverFlags([]string{"--concurrency", "0"})
		assert.Error(t, err)

		_, err = parseDiscoverFlags([]string{"--iterations", "-5"})
		assert.Error(t, err)
	})
}

func TestMakeK8sSecretResolver(t *testing.T) {
	ctx := context.Background()

	validSecret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "mcp-token-secret",
			Namespace: "default",
		},
		Data: map[string][]byte{
			"token": []byte("super-secret-mcp-token"),
		},
	}

	secretWithoutToken := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "no-token-secret",
			Namespace: "default",
		},
		Data: map[string][]byte{
			"other-key": []byte("some-value"),
		},
	}

	fakeClient := fake.NewSimpleClientset(validSecret, secretWithoutToken)
	resolver := makeK8sSecretResolver(ctx, fakeClient)

	t.Run("secret with token key", func(t *testing.T) {
		token, err := resolver("default", "mcp-token-secret")
		require.NoError(t, err)
		assert.Equal(t, "super-secret-mcp-token", token)
	})

	t.Run("secret without token key", func(t *testing.T) {
		_, err := resolver("default", "no-token-secret")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "has no 'token' key")
	})

	t.Run("non-existent secret", func(t *testing.T) {
		_, err := resolver("default", "missing-secret")
		require.Error(t, err)
	})
}
