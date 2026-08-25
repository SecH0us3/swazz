// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFetchSpec_LocalFile(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "swagger.json")
	content := []byte(`{"openapi":"3.0.0","info":{"title":"Test","version":"1.0"}}`)
	require.NoError(t, os.WriteFile(filePath, content, 0600))

	data, err := fetchSpec(filePath, nil, false)
	require.NoError(t, err)
	assert.JSONEq(t, string(content), string(data))
}

func TestFetchSpec_RemoteURL(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"swagger":"2.0","info":{"title":"Remote","version":"1.0"}}`))
	}))
	defer ts.Close()

	data, err := fetchSpec(ts.URL+"/swagger.json", nil, true)
	require.NoError(t, err)
	assert.Contains(t, string(data), `"Remote"`)
}
