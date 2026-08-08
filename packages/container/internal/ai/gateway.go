// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package ai

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
)

// GatewayClient provides a shared HTTP client for Cloudflare AI Gateway
// supporting both Gemini and OpenAI completions with exponential backoff on 429s.
type GatewayClient struct {
	gatewayURL string
	cfAigToken string
	apiKey     string
	model      string
	client     *http.Client
}

// NewGatewayClient creates a new Cloudflare AI Gateway client instance.
func NewGatewayClient(gatewayURL, cfAigToken, apiKey string) *GatewayClient {
	return &GatewayClient{
		gatewayURL: strings.TrimSuffix(gatewayURL, "/"),
		cfAigToken: cfAigToken,
		apiKey:     apiKey,
		model:      "gemini-2.0-flash",
		client:     &http.Client{Timeout: 30 * time.Second},
	}
}

// ChatCompletion sends a prompt to the AI Gateway and returns the text response.
// Implements exponential backoff on HTTP 429 rate limit errors (1s -> 2s -> 4s).
func (g *GatewayClient) ChatCompletion(ctx context.Context, systemPrompt, userPrompt string) (string, error) {
	if g.gatewayURL == "" {
		return "", fmt.Errorf("ai_gateway_url is empty")
	}

	isGemini := strings.Contains(g.gatewayURL, "google-ai-studio") ||
		strings.Contains(g.gatewayURL, "googleapis.com") ||
		strings.Contains(g.gatewayURL, "gemini")

	u, parseErr := url.Parse(g.gatewayURL)
	if parseErr != nil {
		return "", fmt.Errorf("invalid gateway URL: %w", parseErr)
	}

	var targetURL string
	var reqBody []byte
	var err error

	if isGemini {
		joinedPath, _ := url.JoinPath(u.Path, "v1beta", "models", url.PathEscape(g.model)+":generateContent")
		u.Path = joinedPath
		targetURL = u.String()
		parts := []map[string]string{}
		if systemPrompt != "" {
			parts = append(parts, map[string]string{"text": systemPrompt + "\n\n" + userPrompt})
		} else {
			parts = append(parts, map[string]string{"text": userPrompt})
		}
		payload := map[string]interface{}{
			"contents": []map[string]interface{}{
				{
					"role":  "user",
					"parts": parts,
				},
			},
		}
		reqBody, err = json.Marshal(payload)
	} else {
		joinedPath, _ := url.JoinPath(u.Path, "chat", "completions")
		u.Path = joinedPath
		targetURL = u.String()
		messages := []map[string]string{}
		if systemPrompt != "" {
			messages = append(messages, map[string]string{"role": "system", "content": systemPrompt})
		}
		messages = append(messages, map[string]string{"role": "user", "content": userPrompt})

		modelName := g.model
		if modelName == "" || modelName == "gemini-2.0-flash" {
			modelName = "mistral-small-latest"
		}

		payload := map[string]interface{}{
			"model":    modelName,
			"messages": messages,
		}
		reqBody, err = json.Marshal(payload)
	}

	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	maxRetries := 3
	backoff := 1 * time.Second

	for attempt := 0; attempt <= maxRetries; attempt++ {
		req, reqErr := http.NewRequestWithContext(ctx, "POST", targetURL, bytes.NewReader(reqBody))
		if reqErr != nil {
			return "", fmt.Errorf("failed to create request: %w", reqErr)
		}

		req.Header.Set("Content-Type", "application/json")
		if isGemini && g.apiKey != "" {
			req.Header.Set("x-goog-api-key", g.apiKey)
		} else if g.apiKey != "" {
			req.Header.Set("Authorization", "Bearer "+g.apiKey)
		}

		if g.cfAigToken != "" {
			req.Header.Set("cf-aig-authorization", "Bearer "+g.cfAigToken)
		}

		resp, doErr := g.client.Do(req)
		if doErr != nil {
			if ctx.Err() != nil {
				return "", ctx.Err()
			}
			if attempt == maxRetries {
				return "", fmt.Errorf("failed to call AI Gateway after %d retries: %w", maxRetries, doErr)
			}
			time.Sleep(backoff)
			backoff *= 2
			continue
		}

		respBytes, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if err != nil {
			return "", fmt.Errorf("failed to read AI Gateway response body: %w", err)
		}

		if resp.StatusCode == http.StatusTooManyRequests {
			if attempt < maxRetries {
				logger.Warn("[AI] ⚠️ AI Gateway 429 Rate Limit encountered, backing off for %v (attempt %d/%d)", backoff, attempt+1, maxRetries)
				time.Sleep(backoff)
				backoff *= 2
				continue
			}
		}

		if resp.StatusCode != http.StatusOK {
			gwErr := parseGatewayError(resp.StatusCode, respBytes)
			return "", gwErr
		}

		return extractResponseText(respBytes, isGemini)
	}

	return "", fmt.Errorf("exceeded max retries calling AI Gateway")
}

func extractResponseText(body []byte, isGemini bool) (string, error) {
	var data map[string]interface{}
	if err := json.Unmarshal(body, &data); err != nil {
		return "", fmt.Errorf("failed to unmarshal AI response JSON: %w", err)
	}

	var contentText string
	if isGemini {
		if candidates, ok := data["candidates"].([]interface{}); ok && len(candidates) > 0 {
			if firstCand, ok := candidates[0].(map[string]interface{}); ok {
				if content, ok := firstCand["content"].(map[string]interface{}); ok {
					if parts, ok := content["parts"].([]interface{}); ok && len(parts) > 0 {
						if firstPart, ok := parts[0].(map[string]interface{}); ok {
							contentText, _ = firstPart["text"].(string)
						}
					}
				}
			}
		}
	} else {
		if choices, ok := data["choices"].([]interface{}); ok && len(choices) > 0 {
			if firstChoice, ok := choices[0].(map[string]interface{}); ok {
				if msg, ok := firstChoice["message"].(map[string]interface{}); ok {
					contentText, _ = msg["content"].(string)
				}
			}
		}
	}

	return contentText, nil
}
