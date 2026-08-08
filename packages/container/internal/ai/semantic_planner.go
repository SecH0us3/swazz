// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package ai

import (
	"context"
	"encoding/json"
	"fmt"

	"swazz-engine/internal/logger"
	"swazz-engine/internal/swagger"
)

type SemanticPlanner struct {
	client *GatewayClient
}

func NewSemanticPlanner(gatewayURL, cfAigToken, apiKey string) *SemanticPlanner {
	return &SemanticPlanner{
		client: NewGatewayClient(gatewayURL, cfAigToken, apiKey),
	}
}

// ExtractSemanticFormats scans a swagger Config for parameter formats and semantic types.
func (p *SemanticPlanner) ExtractSemanticFormats(cfg *swagger.Config) map[string]string {
	result := make(map[string]string)
	if cfg == nil {
		return result
	}
	for _, ep := range cfg.Endpoints {
		extractParams(ep.PathParams, result)
		extractParams(ep.QueryParams, result)
		extractParams(ep.HeaderParams, result)
		extractSchemaProps(ep.Schema.Properties, result)
	}
	return result
}

// GeneratePreScanPayloads dispatches a pre-scan schema analysis request to Gemini / OpenAI via Cloudflare AI Gateway.
func (p *SemanticPlanner) GeneratePreScanPayloads(ctx context.Context, schemaSummary string) ([]string, error) {
	if p.client == nil || p.client.gatewayURL == "" {
		return nil, fmt.Errorf("ai_gateway_url is empty")
	}

	logger.Info("[AI] 📤 Executing Pre-Scan LLM schema analysis via Cloudflare AI Gateway (%s)...", p.client.gatewayURL)

	userPrompt := fmt.Sprintf("Analyze this OpenAPI schema and generate 5 targeted edge-case fuzzing payload values as JSON array of strings:\n%s", schemaSummary)

	respText, err := p.client.ChatCompletion(ctx, "", userPrompt)
	if err != nil {
		logger.Warn("[AI] ⚠️ Pre-Scan LLM request failed: %v", err)
		return nil, err
	}

	if respText == "" {
		return nil, nil
	}

	var payloads []string
	_ = json.Unmarshal([]byte(respText), &payloads)
	logger.Info("[AI] ✅ Pre-Scan LLM analysis complete: generated %d custom payload templates", len(payloads))
	return payloads, nil
}

func parseGatewayError(statusCode int, body []byte) error {
	var data map[string]interface{}
	if err := json.Unmarshal(body, &data); err == nil {
		if errArray, ok := data["error"].([]interface{}); ok && len(errArray) > 0 {
			if firstErr, ok := errArray[0].(map[string]interface{}); ok {
				if msg, ok := firstErr["message"].(string); ok && msg != "" {
					return fmt.Errorf("AI Gateway error %d: %s", statusCode, msg)
				}
			}
		}
		if errObj, ok := data["error"].(map[string]interface{}); ok {
			if msg, ok := errObj["message"].(string); ok && msg != "" {
				return fmt.Errorf("AI Gateway error %d: %s", statusCode, msg)
			}
		}
	}
	return fmt.Errorf("AI Gateway error %d: %s", statusCode, string(body))
}

func parseGatewayResponse(body []byte, isGemini bool) ([]string, error) {
	var data map[string]interface{}
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, err
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

	if contentText == "" {
		return nil, nil
	}

	var payloads []string
	_ = json.Unmarshal([]byte(contentText), &payloads)
	return payloads, nil
}

func extractParams(params map[string]*swagger.SchemaProperty, result map[string]string) {
	for name, prop := range params {
		if prop != nil && prop.Format != "" {
			result[name] = prop.Format
		}
	}
}

func extractSchemaProps(props map[string]*swagger.SchemaProperty, result map[string]string) {
	for name, prop := range props {
		if prop != nil && prop.Format != "" {
			result[name] = prop.Format
		}
	}
}
