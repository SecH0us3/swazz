package discovery

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

// UploadTarget defines where scan reports should be sent.
type UploadTarget struct {
	Type           string // "coordinator", "local"
	Prefix         string // local output directory
	CoordinatorURL string // Swazz Coordinator API URL
	Token          string // Auth token for coordinator
}

// UploadReports sends all report files from reportDir to the configured target.
func UploadReports(ctx context.Context, reportDir string, target UploadTarget) error {
	entries, err := os.ReadDir(reportDir)
	if err != nil {
		return fmt.Errorf("reading report directory: %w", err)
	}

	var reportFiles []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if ext == ".sarif" || ext == ".html" || ext == ".json" {
			reportFiles = append(reportFiles, filepath.Join(reportDir, e.Name()))
		}
	}

	if len(reportFiles) == 0 {
		return nil
	}

	switch target.Type {
	case "coordinator":
		return uploadToCoordinator(ctx, reportFiles, target)
	case "local":
		return copyToLocal(reportFiles, target.Prefix)
	default:
		return fmt.Errorf("unknown upload target type: %s", target.Type)
	}
}

func uploadToCoordinator(ctx context.Context, files []string, target UploadTarget) error {
	client := &http.Client{Timeout: 3 * time.Minute}

	baseURL, err := url.Parse(target.CoordinatorURL)
	if err != nil {
		return fmt.Errorf("invalid coordinator URL: %w", err)
	}
	baseURL.Path = path.Join(baseURL.Path, "api", "discovery", "reports")
	uploadURL := baseURL.String()

	for _, path := range files {
		data, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("reading %s: %w", path, err)
		}

		var content any
		if strings.ToLower(filepath.Ext(path)) == ".html" {
			content = string(data)
		} else {
			content = json.RawMessage(data)
		}

		payload := map[string]any{
			"filename": filepath.Base(path),
			"content":  content,
		}
		body, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("marshaling payload for %s: %w", path, err)
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, uploadURL, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		if target.Token != "" {
			req.Header.Set("Authorization", "Bearer "+target.Token)
		}

		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("uploading %s: %w", filepath.Base(path), err)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()

		if resp.StatusCode >= 300 {
			return fmt.Errorf("coordinator returned %d for %s", resp.StatusCode, filepath.Base(path))
		}
	}
	return nil
}

func copyToLocal(files []string, destDir string) error {
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return fmt.Errorf("creating destination directory: %w", err)
	}

	for _, src := range files {
		data, err := os.ReadFile(src)
		if err != nil {
			return fmt.Errorf("reading %s: %w", src, err)
		}
		dst := filepath.Join(destDir, filepath.Base(src))
		if err := os.WriteFile(dst, data, 0o644); err != nil {
			return fmt.Errorf("writing %s: %w", dst, err)
		}
	}
	return nil
}
