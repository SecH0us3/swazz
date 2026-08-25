// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"swazz-engine/internal/logger"
	"swazz-engine/internal/triage"
)

func logDebug(format string, v ...interface{}) {
	logger.Debug(format, v...)
}

func logInfo(format string, v ...interface{}) {
	logger.Info(format, v...)
}

func logWarn(format string, v ...interface{}) {
	logger.Warn(format, v...)
}

func logError(format string, v ...interface{}) {
	logger.Error(format, v...)
}

func inferOOBServerURL(coordinatorURL string) string {
	return deriveHTTPBaseURL(coordinatorURL)
}

func deriveHTTPBaseURL(coordinatorURL string) string {
	if coordinatorURL == "" {
		return ""
	}
	u, err := url.Parse(coordinatorURL)
	if err != nil || u.Host == "" {
		return ""
	}
	if u.Scheme == "ws" {
		u.Scheme = "http"
	} else if u.Scheme == "wss" {
		u.Scheme = "https"
	}

	// Strip known router endpoints if they were passed
	if idx := strings.Index(u.Path, "/api/runners/connect"); idx > -1 {
		u.Path = u.Path[:idx]
	} else if idx := strings.Index(u.Path, "/api/"); idx > -1 {
		u.Path = u.Path[:idx]
	}
	u.Path = strings.TrimSuffix(u.Path, "/")
	u.RawQuery = ""
	return u.String()
}

func deriveTelemetryURL(coordURL string) string {
	if coordURL == "" {
		return "https://swazz.secmy.app/api/telemetry/scans/increment"
	}
	u, err := url.Parse(coordURL)
	if err != nil || u.Host == "" {
		return "https://swazz.secmy.app/api/telemetry/scans/increment"
	}
	if u.Scheme == "ws" {
		u.Scheme = "http"
	} else if u.Scheme == "wss" {
		u.Scheme = "https"
	}
	u.Path = "/api/telemetry/scans/increment"
	u.RawQuery = ""
	return u.String()
}

func IncrementGlobalScanTelemetry(telemetryURL string, disableTelemetry bool) {
	if disableTelemetry {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		defer cancel()

		req, err := http.NewRequestWithContext(ctx, "POST", telemetryURL, strings.NewReader("{}")) // #nosec G704
		if err != nil {
			logWarn("Warning: Failed to report telemetry scan count: %v. You can disable telemetry using --disable-telemetry or SWAZZ_DISABLE_TELEMETRY=true.", err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "Swazz/1.0 (+https://github.com/SecH0us3/swazz)")

		resp, err := http.DefaultClient.Do(req) // #nosec G704
		if err != nil {
			logWarn("Warning: Failed to report telemetry scan count: %v. You can disable telemetry using --disable-telemetry or SWAZZ_DISABLE_TELEMETRY=true.", err)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			logWarn("Warning: Failed to report telemetry scan count: HTTP status %d. You can disable telemetry using --disable-telemetry or SWAZZ_DISABLE_TELEMETRY=true.", resp.StatusCode)
		}
	}()
}

func sendTriageBatchToEdge(coordinatorURL, token, scanID string, results []*triage.TriageResult) error {
	if len(results) == 0 {
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
	joinedPath, _ := url.JoinPath("/api/scans", url.PathEscape(scanID), "findings", "ai-triage")
	u.Path = joinedPath
	apiURL := u.String()

	var updates []map[string]interface{}
	for _, tr := range results {
		for _, fid := range tr.FindingIDs {
			updates = append(updates, map[string]interface{}{
				"finding_id":     fid,
				"ai_status":      tr.AIStatus,
				"ai_relevance":   tr.AIRelevance,
				"ai_explanation": tr.AIExplanation,
				"ai_confidence":  tr.AIConfidence,
			})
		}
	}

	payloadBytes, err := json.Marshal(map[string]interface{}{
		"updates": updates,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequest("PATCH", apiURL, bytes.NewReader(payloadBytes)) // #nosec G704
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
		return fmt.Errorf("Edge API batch triage error (status %d): %s", resp.StatusCode, string(respBody))
	}

	return nil
}
