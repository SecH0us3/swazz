// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package wafcheck

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

type AuditResultItem struct {
	Category       string `json:"category"`
	Payload        string `json:"payload"`
	Method         string `json:"method"`
	Status         int    `json:"status"`
	ResponseTimeMs int64  `json:"responseTime"`
	WAFType        string `json:"wafType,omitempty"`
}

type PatchOptions struct {
	Vendor           string `json:"vendor,omitempty"`
	TargetURL        string `json:"targetUrl,omitempty"`
	IncludeTerraform bool   `json:"includeTerraform,omitempty"`
}

type PatchBundle struct {
	Vendor    string `json:"vendor"`
	Native    string `json:"native"`
	Terraform string `json:"terraform,omitempty"`
	RuleCount int    `json:"ruleCount"`
}

type PatchReport struct {
	TargetUrl     string                 `json:"targetUrl"`
	GeneratedAt   string                 `json:"generatedAt"`
	TotalBypasses int                    `json:"totalBypasses"`
	Bundles       map[string]PatchBundle `json:"bundles"`
}

type patchRequest struct {
	Results []AuditResultItem `json:"results"`
	Options PatchOptions      `json:"options"`
}

// GeneratePatches calls POST {endpoint}/api/virtual-patch. Same error-handling contract as Detect.
func (c *Client) GeneratePatches(ctx context.Context, results []AuditResultItem, options PatchOptions) (*PatchReport, error) {
	u, err := url.Parse(c.endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid WAF check endpoint: %w", err)
	}

	joinedPath, err := url.JoinPath(u.Path, "/api/virtual-patch")
	if err != nil {
		return nil, fmt.Errorf("failed to build virtual-patch URL path: %w", err)
	}
	u.Path = joinedPath

	reqBody, err := json.Marshal(patchRequest{
		Results: results,
		Options: options,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to encode virtual-patch request JSON: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(reqBody)) // #nosec G704
	if err != nil {
		return nil, fmt.Errorf("failed to create virtual-patch request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req) // #nosec G704
	if err != nil {
		return nil, fmt.Errorf("virtual-patch request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to read virtual-patch response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, parseAPIError("virtual-patch", resp.StatusCode, body)
	}

	var rep PatchReport
	if err := json.Unmarshal(body, &rep); err != nil {
		return nil, fmt.Errorf("failed to decode virtual-patch response JSON: %w", err)
	}

	return &rep, nil
}
