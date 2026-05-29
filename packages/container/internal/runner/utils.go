// utils.go: General helper functions for the runner package.
// Includes path parameter handling, value truncation for previews,
// and payload merging logic.

package runner

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"swazz-engine/internal/generator"
	"swazz-engine/internal/swagger"
)

func (r *Runner) updateReplacer() {
	r.configMu.RLock()
	vars := r.config.Variables
	r.configMu.RUnlock()

	args := make([]string, 0, len(vars)*2)
	for k, v := range vars {
		args = append(args, "{{"+k+"}}", fmt.Sprintf("%v", v))
	}

	r.configMu.Lock()
	defer r.configMu.Unlock()
	if len(args) > 0 {
		r.varReplacer = strings.NewReplacer(args...)
	} else {
		r.varReplacer = nil
	}
}

func (r *Runner) subVars(input string) string {
	r.configMu.RLock()
	defer r.configMu.RUnlock()
	return r.subVarsLocked(input)
}

func (r *Runner) subVarsLocked(input string) string {
	if r.varReplacer != nil {
		return r.varReplacer.Replace(input)
	}
	return input
}

func hasFields(ep *swagger.EndpointConfig) bool {
	return (ep.Schema.Properties != nil && len(ep.Schema.Properties) > 0) ||
		(ep.PathParams != nil && len(ep.PathParams) > 0) ||
		(ep.HeaderParams != nil && len(ep.HeaderParams) > 0)
}

func isNoBodyMethod(method string) bool {
	m := strings.ToUpper(method)
	return m == "GET" || m == "HEAD" || m == "OPTIONS"
}

func fillPathParams(path string, pathParams map[string]*swagger.SchemaProperty, gen *generator.Generator) string {
	if len(pathParams) == 0 && !strings.Contains(path, "{") {
		return path
	}

	result := path
	for name, schema := range pathParams {
		placeholder := "{" + name + "}"
		if strings.Contains(result, placeholder) {
			val := capPathParam(gen.Generate(name, schema))
			result = strings.ReplaceAll(result, placeholder, url.PathEscape(val))
		}
	}

	// Handle any remaining {param} not in pathParams
	for {
		start := strings.IndexByte(result, '{')
		if start < 0 {
			break
		}
		end := strings.IndexByte(result[start:], '}')
		if end < 0 {
			break
		}
		fallbackSchema := &swagger.SchemaProperty{Type: "string"}
		val := capPathParam(gen.Generate("id", fallbackSchema))
		result = result[:start] + url.PathEscape(val) + result[start+end+1:]
	}

	return result
}

// capPathParam ensures a path parameter value is safe to embed in a URL segment.
// Practical limit: ~256 chars — beyond that the value doesn't add testing value
// and breaks URL parsers / logging infrastructure.
func capPathParam(v any) string {
	s := fmt.Sprintf("%v", v)
	const maxPathParamLen = 256
	if len(s) > maxPathParamLen {
		return s[:maxPathParamLen]
	}
	return s
}

func mergePayload(payload any, queryParams map[string]any) any {
	if payload != nil {
		return payload
	}
	return queryParams
}

// ToSSE converts a full FuzzResult into the lightweight FuzzResultSSE for SSE broadcast.
// Raw payload and responseBody are replaced by short preview strings (≤200 chars).
// ResolvedPath is capped to 200 chars to avoid megabyte URLs in the UI.
// This is the ONLY place payload content is summarised — it never reaches the browser as raw data.
func ToSSE(r *swagger.FuzzResult) *swagger.FuzzResultSSE {
	resolvedPath := r.ResolvedPath
	if len(resolvedPath) > 200 {
		resolvedPath = resolvedPath[:200] + "…"
	}
	hasHeaderInjection := false
	for _, f := range r.AnalyzerFindings {
		if f.RuleID == "swazz/crlf-injection" || f.RuleID == "swazz/header-injection" {
			hasHeaderInjection = true
			break
		}
	}

	var sseHeaders http.Header
	if hasHeaderInjection && r.ResponseHeaders != nil {
		sseHeaders = r.ResponseHeaders.Clone()
	}

	return &swagger.FuzzResultSSE{
		ID:                 r.ID,
		Endpoint:           r.Endpoint,
		ResolvedPath:       resolvedPath,
		Method:             r.Method,
		Profile:            r.Profile,
		Status:             r.Status,
		Duration:           r.Duration,
		PayloadSize:        r.PayloadSize,
		PayloadPreview:     previewAny(r.Payload, 200),
		ResponsePreview:    previewAny(r.ResponseBody, 1024),
		Error:              r.Error,
		Timestamp:          r.Timestamp,
		Retries:            r.Retries,
		ResponseSize:       r.ResponseSize,
		HasHeaderInjection: hasHeaderInjection,
		ResponseHeaders:    sseHeaders,
		AnalyzerFindings:   r.AnalyzerFindings,
	}
}

// previewAny serialises any value into a short human-readable string.
// Instead of linear truncation, it recursively processes objects and arrays
// to keep all fields visible while capping long strings and large arrays.
func previewAny(v any, maxLen int) string {
	if v == nil {
		return ""
	}
	truncated := truncateValue(v, maxLen)
	b, _ := json.Marshal(truncated)
	return string(b)
}

func truncateValue(v any, maxLen int) any {
	switch val := v.(type) {
	case string:
		if len(val) > maxLen {
			return fmt.Sprintf("%s... [truncated %d chars]", val[:maxLen], len(val)-maxLen)
		}
		return val
	case map[string]any:
		res := make(map[string]any)
		for k, v := range val {
			res[k] = truncateValue(v, maxLen)
		}
		return res
	case []any:
		if len(val) <= 2 {
			res := make([]any, len(val))
			for i, v := range val {
				res[i] = truncateValue(v, maxLen)
			}
			return res
		}
		// Truncate long arrays to 2 elements + a count note
		res := make([]any, 0, 3)
		res = append(res, truncateValue(val[0], maxLen))
		res = append(res, truncateValue(val[1], maxLen))
		res = append(res, fmt.Sprintf("... and %d more elements", len(val)-2))
		return res
	default:
		return v
	}
}
