// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package wafcheck

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"swazz-engine/internal/safenet"
	"swazz-engine/internal/swagger"
)

const DefaultEndpoint = "https://waf.secmy.app"

// maxResponseBytes caps how much of a third-party response we buffer into memory.
const maxResponseBytes = 10 << 20

// readBody reads a WAF-checker API response: for a non-2xx status, an error made from the start
// of the body (see parseAPIError); otherwise the body, failing when it is larger than
// maxResponseBytes rather than handing a cut-off document to the JSON decoder.
func readBody(label string, resp *http.Response) ([]byte, error) {
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, safenet.MaxErrorBodyBytes))
		return nil, parseAPIError(label, resp.StatusCode, errBody)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("failed to read %s response: %w", label, err)
	}
	if len(body) > maxResponseBytes {
		return nil, fmt.Errorf("%s response is larger than %d bytes", label, maxResponseBytes)
	}
	return body, nil
}

// parseAPIError renders a non-2xx response from the WAF-checker API as an error,
// preferring the structured {error, message} body when present. The text comes from the
// API, so it goes through safenet.ReadErrorBody (capped, control characters removed).
func parseAPIError(label string, statusCode int, body []byte) error {
	clean := func(s string) string { return safenet.ReadErrorBody(strings.NewReader(s)) }
	var errResp struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if jsonErr := json.Unmarshal(body, &errResp); jsonErr == nil {
		if errResp.Error != "" && errResp.Message != "" {
			return fmt.Errorf("%s API error (%d): %s - %s", label, statusCode, clean(errResp.Error), clean(errResp.Message))
		}
		if errResp.Error != "" {
			return fmt.Errorf("%s API error (%d): %s", label, statusCode, clean(errResp.Error))
		}
		if errResp.Message != "" {
			return fmt.Errorf("%s API error (%d): %s", label, statusCode, clean(errResp.Message))
		}
	}
	return fmt.Errorf("%s API error with status %d: %s", label, statusCode, clean(string(body)))
}

// The detection DTOs live in internal/swagger so that the shared types package does not
// have to depend on this HTTP client package. These aliases keep call sites readable.
type (
	Detection           = swagger.WAFDetection
	BypassOpportunities = swagger.WAFBypassOpportunities
	Result              = swagger.WAFCheckResult
)

type Client struct {
	endpoint string
	client   *http.Client
}

// NewClient creates a client for the WAF-checker API. An empty endpoint defaults to DefaultEndpoint.
func NewClient(endpoint string) *Client {
	if endpoint == "" {
		endpoint = DefaultEndpoint
	}
	return &Client{
		endpoint: strings.TrimRight(endpoint, "/"),
		client:   &http.Client{Timeout: 15 * time.Second},
	}
}

// Detect calls GET {endpoint}/api/waf-detect?url=<targetURL>.
//
// detectBypassOpportunities (server-side inside waf-checker) issues several
// additional live probe requests directly to the target domain from Cloudflare's
// network, not from swazz's runner. This is why this must be called once per scan
// (domain-level), never per-endpoint.
func (c *Client) Detect(ctx context.Context, targetURL string) (*Result, error) {
	u, err := url.Parse(c.endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid WAF check endpoint: %w", err)
	}

	joinedPath, err := url.JoinPath(u.Path, "/api/waf-detect")
	if err != nil {
		return nil, fmt.Errorf("failed to build WAF check URL path: %w", err)
	}
	u.Path = joinedPath

	q := u.Query()
	q.Set("url", targetURL)
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil) // #nosec G704
	if err != nil {
		return nil, fmt.Errorf("failed to create WAF check request: %w", err)
	}

	resp, err := c.client.Do(req) // #nosec G704
	if err != nil {
		return nil, fmt.Errorf("WAF check request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := readBody("WAF check", resp)
	if err != nil {
		return nil, err
	}

	var res Result
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, fmt.Errorf("failed to decode WAF check response JSON: %w", err)
	}

	return &res, nil
}
