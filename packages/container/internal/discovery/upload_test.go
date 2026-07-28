package discovery

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUploadReports_CoordinatorHTTPPost_Sarif(t *testing.T) {
	var receivedPayload map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/api/discovery/reports", r.URL.Path)
		assert.Equal(t, "Bearer test-token", r.Header.Get("Authorization"))
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))

		err := json.NewDecoder(r.Body).Decode(&receivedPayload)
		assert.NoError(t, err)
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
	assert.Equal(t, "report.sarif", receivedPayload["filename"])
}

func TestUploadReports_CoordinatorHTTPPost_HTML(t *testing.T) {
	var receivedBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/api/discovery/reports", r.URL.Path)

		var err error
		receivedBody, err = io.ReadAll(r.Body)
		assert.NoError(t, err)

		var payload map[string]any
		err = json.Unmarshal(receivedBody, &payload)
		assert.NoError(t, err, "HTML report upload payload must be valid JSON")
		assert.Equal(t, "report.html", payload["filename"])
		assert.Equal(t, "<html><body><h1>Scan Results</h1></body></html>", payload["content"])
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	dir := t.TempDir()
	htmlPath := filepath.Join(dir, "report.html")
	os.WriteFile(htmlPath, []byte(`<html><body><h1>Scan Results</h1></body></html>`), 0o644)

	err := UploadReports(context.Background(), dir, UploadTarget{
		Type:           "coordinator",
		CoordinatorURL: srv.URL,
	})
	require.NoError(t, err)
	assert.NotEmpty(t, receivedBody)
}

func TestUploadReports_CoordinatorServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	dir := t.TempDir()
	sarifPath := filepath.Join(dir, "report.sarif")
	os.WriteFile(sarifPath, []byte(`{}`), 0o644)

	err := UploadReports(context.Background(), dir, UploadTarget{
		Type:           "coordinator",
		CoordinatorURL: srv.URL,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "coordinator returned 500")
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

func TestUploadReports_UnknownTargetType(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "test.sarif"), []byte(`{}`), 0o644)

	err := UploadReports(context.Background(), dir, UploadTarget{
		Type: "unknown_target",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown upload target type: unknown_target")
}

func TestUploadReports_MissingDirectory(t *testing.T) {
	err := UploadReports(context.Background(), "/non/existent/path/for/test", UploadTarget{
		Type: "local",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "reading report directory")
}

func TestUploadReports_NoReportFiles(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "readme.txt"), []byte("not a report"), 0o644)

	err := UploadReports(context.Background(), dir, UploadTarget{
		Type: "coordinator",
	})
	require.NoError(t, err)
}
