// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package agent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"swazz-engine/internal/wafcheck"
)

func sendWAFPatchToEdge(coordinatorURL, token, scanID string, report *wafcheck.PatchReport) error {
	if report == nil || len(report.Bundles) == 0 {
		return nil
	}
	baseURL := deriveHTTPBaseURL(coordinatorURL)
	if baseURL == "" {
		return fmt.Errorf("invalid coordinator URL")
	}
	u, err := url.Parse(baseURL)
	if err != nil {
		return fmt.Errorf("invalid coordinator URL: %w", err)
	}
	joinedPath, _ := url.JoinPath("/api/scans", url.PathEscape(scanID), "waf-patch")
	u.Path = joinedPath

	payloadBytes, err := json.Marshal(report)
	if err != nil {
		return err
	}
	req, err := http.NewRequest("PATCH", u.String(), bytes.NewReader(payloadBytes)) // #nosec G704
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req) // #nosec G704
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Edge API WAF patch error (status %d): %s", resp.StatusCode, string(respBody))
	}
	return nil
}
