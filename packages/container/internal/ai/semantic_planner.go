package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"swazz-engine/internal/logger"
	"swazz-engine/internal/swagger"
)

type SemanticPlanner struct {
	gatewayURL string
	cfAigToken string
	apiKey     string
	model      string
	client     *http.Client
}

func NewSemanticPlanner(gatewayURL, cfAigToken, apiKey string) *SemanticPlanner {
	return &SemanticPlanner{
		gatewayURL: strings.TrimSuffix(gatewayURL, "/"),
		cfAigToken: cfAigToken,
		apiKey:     apiKey,
		model:      "gemini-2.5-flash",
		client:     &http.Client{Timeout: 30 * time.Second},
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
	if p.gatewayURL == "" {
		return nil, fmt.Errorf("ai_gateway_url is empty")
	}

	logger.Info("[AI] 📤 Executing Pre-Scan LLM schema analysis via Cloudflare AI Gateway (%s)...", p.gatewayURL)

	userPrompt := fmt.Sprintf("Analyze this OpenAPI schema and generate 5 targeted edge-case fuzzing payload values as JSON array of strings:\n%s", schemaSummary)

	var targetURL string
	var reqBody []byte
	var err error

	isGemini := strings.Contains(p.gatewayURL, "google-ai-studio") || strings.Contains(p.gatewayURL, "googleapis.com") || strings.Contains(p.gatewayURL, "gemini")

	if isGemini {
		targetURL = fmt.Sprintf("%s/v1beta/models/%s:generateContent", p.gatewayURL, p.model)
		payload := map[string]interface{}{
			"contents": []map[string]interface{}{
				{
					"role": "user",
					"parts": []map[string]string{
						{"text": userPrompt},
					},
				},
			},
		}
		reqBody, err = json.Marshal(payload)
	} else {
		targetURL = fmt.Sprintf("%s/chat/completions", p.gatewayURL)
		payload := map[string]interface{}{
			"model": "gpt-4o-mini",
			"messages": []map[string]string{
				{"role": "user", "content": userPrompt},
			},
		}
		reqBody, err = json.Marshal(payload)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", targetURL, bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if isGemini && p.apiKey != "" {
		req.Header.Set("x-goog-api-key", p.apiKey)
	} else if p.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.apiKey)
	}

	if p.cfAigToken != "" {
		req.Header.Set("cf-aig-authorization", "Bearer "+p.cfAigToken)
	}

	resp, err := p.client.Do(req)
	if err != nil {
		logger.Warn("[AI] ⚠️ Pre-Scan LLM request failed: %v", err)
		return nil, fmt.Errorf("failed to call AI Gateway: %w", err)
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		gwErr := parseGatewayError(resp.StatusCode, respBytes)
		logger.Warn("[AI] ⚠️ Pre-Scan LLM error response: %v", gwErr)
		return nil, gwErr
	}

	payloads, parseErr := parseGatewayResponse(respBytes, isGemini)
	if parseErr == nil {
		logger.Info("[AI] ✅ Pre-Scan LLM analysis complete: generated %d custom payload templates", len(payloads))
	}
	return payloads, parseErr
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
