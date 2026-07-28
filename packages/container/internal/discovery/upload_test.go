package discovery

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUploadReports_CoordinatorHTTPPost(t *testing.T) {
	var receivedPayload map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "Bearer test-token", r.Header.Get("Authorization"))
		json.NewDecoder(r.Body).Decode(&receivedPayload)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	dir := t.TempDir()
	sarifPath := filepath.Join(dir, "report.sarif")
	os.WriteFile(sarifPath, []byte(`{"version":"2.1.0","runs":[]}`), 0o644)

	err := UploadReports(context.Background(), dir, UploadTarget{
		Type:           "coordinator",
		CoordinatorURL: srv.URL,
		Token:          "test-token",
	})
	require.NoError(t, err)
	assert.NotNil(t, receivedPayload)
}

func TestUploadReports_LocalCopy(t *testing.T) {
	srcDir := t.TempDir()
	dstDir := t.TempDir()

	os.WriteFile(filepath.Join(srcDir, "test.sarif"), []byte(`{}`), 0o644)
	os.WriteFile(filepath.Join(srcDir, "test.html"), []byte(`<html></html>`), 0o644)

	err := UploadReports(context.Background(), srcDir, UploadTarget{
		Type:   "local",
		Prefix: dstDir,
	})
	require.NoError(t, err)
	assert.FileExists(t, filepath.Join(dstDir, "test.sarif"))
	assert.FileExists(t, filepath.Join(dstDir, "test.html"))
}
