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
	"swazz-engine/internal/classifier"
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
		(ep.QueryParams != nil && len(ep.QueryParams) > 0) ||
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

	// Handle any remaining {param} not in pathParams, skipping {{param}}
	searchStart := 0
	for {
		start := strings.IndexByte(result[searchStart:], '{')
		if start < 0 {
			break
		}
		start += searchStart
		
		// Check for double brace
		if start+1 < len(result) && result[start+1] == '{' {
			searchStart = start + 2
			continue
		}
		
		end := strings.IndexByte(result[start:], '}')
		if end < 0 {
			break
		}
		
		fallbackSchema := &swagger.SchemaProperty{Type: "string"}
		val := capPathParam(gen.Generate("id", fallbackSchema))
		result = result[:start] + url.PathEscape(val) + result[start+end+1:]
		// do not advance searchStart, as string length changed
	}

	return result
}

func fillPathParamsFromMap(path string, params map[string]string) string {
	if len(params) == 0 && !strings.Contains(path, "{") {
		return path
	}

	result := path
	for name, val := range params {
		placeholder := "{" + name + "}"
		if strings.Contains(result, placeholder) {
			result = strings.ReplaceAll(result, placeholder, url.PathEscape(val))
		}
	}

	// Handle any remaining {param} not in params, skipping {{param}}
	searchStart := 0
	for {
		start := strings.IndexByte(result[searchStart:], '{')
		if start < 0 {
			break
		}
		start += searchStart
		
		// Check for double brace
		if start+1 < len(result) && result[start+1] == '{' {
			searchStart = start + 2
			continue
		}
		
		end := strings.IndexByte(result[start:], '}')
		if end < 0 {
			break
		}
		
		fallbackSchema := &swagger.SchemaProperty{Type: "string"}
		gen := generator.New(nil, swagger.ProfileRandom, swagger.DefaultSettings())
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

	// Map OWASPCategory for a safe copy of AnalyzerFindings
	var findingsCopy []swagger.AnalysisFinding
	if r.AnalyzerFindings != nil {
		findingsCopy = make([]swagger.AnalysisFinding, len(r.AnalyzerFindings))
		for i, f := range r.AnalyzerFindings {
			f.OWASPCategory = classifier.OWASPCategories(f.RuleID)
			findingsCopy[i] = f
		}
	}

	// Determine overall OWASPCategory for the FuzzResult without mutating r
	ruleID := classifier.RuleIDForResult(r)
	overallCategory := classifier.OWASPCategories(ruleID)

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
		RequestHeaders:     r.RequestHeaders,
		AnalyzerFindings:   findingsCopy,
		Identity:           r.Identity,
		OWASPCategory:      overallCategory,
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

func (r *Runner) updateStateReplacerLocked() {
	args := make([]string, 0, len(r.state)*2)
	for k, v := range r.state {
		args = append(args, "{{"+k+"}}", v)
	}
	if len(args) > 0 {
		r.stateReplacer = strings.NewReplacer(args...)
	} else {
		r.stateReplacer = nil
	}
}

func (r *Runner) subStateVars(input string) string {
	if !strings.Contains(input, "{{") {
		return input
	}

	r.stateMu.RLock()
	replacer := r.stateReplacer
	r.stateMu.RUnlock()

	if replacer != nil {
		return replacer.Replace(input)
	}
	return input
}

func (r *Runner) subStateVarsAny(v any) any {
	r.stateMu.RLock()
	defer r.stateMu.RUnlock()
	if r.stateReplacer == nil {
		return v
	}
	return subVarsRecursive(v, r.stateReplacer)
}

func subVarsRecursive(v any, replacer *strings.Replacer) any {
	switch val := v.(type) {
	case string:
		if !strings.Contains(val, "{{") || replacer == nil {
			return val
		}
		return replacer.Replace(val)
	case map[string]any:
		res := make(map[string]any, len(val))
		for k, v := range val {
			res[k] = subVarsRecursive(v, replacer)
		}
		return res
	case []any:
		res := make([]any, len(val))
		for i, v := range val {
			res[i] = subVarsRecursive(v, replacer)
		}
		return res
	default:
		return v
	}
}
