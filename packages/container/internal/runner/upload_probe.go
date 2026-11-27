// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"strings"

	"swazz-engine/internal/generator"
	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/swagger"
)

func isFileUploadSchema(s *swagger.SchemaProperty) bool {
	if s == nil {
		return false
	}
	return (s.Type == "string" && strings.EqualFold(s.Format, "binary")) || s.Type == "file"
}

func hasFileUploadField(s *swagger.SchemaProperty) bool {
	if s == nil {
		return false
	}
	if isFileUploadSchema(s) {
		return true
	}
	if s.Items != nil && hasFileUploadField(s.Items) {
		return true
	}
	for _, prop := range s.Properties {
		if hasFileUploadField(prop) {
			return true
		}
	}
	return false
}

func hasStaticUploadHints(ep swagger.EndpointConfig) bool {
	if len(payloads.InferFileCategories(ep.Schema.AcceptedMediaTypes, "", ep.Path)) > 0 {
		return true
	}
	if ep.Schema.Items != nil && len(payloads.InferFileCategories(ep.Schema.Items.AcceptedMediaTypes, "", ep.Path)) > 0 {
		return true
	}
	for name, prop := range ep.Schema.Properties {
		if prop == nil {
			continue
		}
		if hasFileUploadField(prop) {
			var accepted []string
			accepted = append(accepted, prop.AcceptedMediaTypes...)
			if prop.Items != nil {
				accepted = append(accepted, prop.Items.AcceptedMediaTypes...)
			}
			if len(payloads.InferFileCategories(accepted, name, ep.Path)) > 0 {
				return true
			}
		}
	}
	return false
}

func (r *Runner) applyDetectedUploadCategories(epKey string, gens ...*generator.Generator) {
	raw, ok := r.detectedUploadCategories.Load(epKey)
	if !ok {
		return
	}
	cats, ok := raw.([]payloads.FileCategory)
	if !ok || len(cats) == 0 {
		return
	}
	for _, g := range gens {
		if g != nil {
			g.SetPreferredUploadCategories(cats)
		}
	}
}

func (r *Runner) maybeProbeUploadCategories(ctx context.Context, ep swagger.EndpointConfig, epKey, resolvedPath string, built generatedPayload, baselineStatus int) {
	if baselineStatus == 0 || baselineStatus == 401 || baselineStatus == 403 || baselineStatus == 404 || baselineStatus == 405 {
		return
	}
	if isNoBodyMethod(ep.Method) || !hasFileUploadField(&ep.Schema) || hasStaticUploadHints(ep) {
		return
	}
	allCanaries := payloads.AllValidCanaries()
	// Send at most 1 representative canary per FileCategory (preferring valid_png for image).
	byCat := make(map[payloads.FileCategory]payloads.CorpusEntry)
	var catOrder []payloads.FileCategory
	for _, entry := range allCanaries {
		prev, exists := byCat[entry.Category]
		if !exists {
			byCat[entry.Category] = entry
			catOrder = append(catOrder, entry.Category)
		} else if entry.File.ProbeKind == "valid_png" && prev.File.ProbeKind != "valid_png" {
			byCat[entry.Category] = entry
		}
	}
	if len(catOrder) <= 1 {
		return
	}

	var accepted []payloads.FileCategory
	for _, cat := range catOrder {
		entry := byCat[cat]
		if r.stopped() || ctx.Err() != nil {
			return
		}
		probeBody := buildCanaryProbeBody(&ep.Schema, built.requestBody(), entry.File)
		if probeBody == nil {
			continue
		}
		res := r.executeGeneratedRequestPinned(
			ctx,
			r.config.BaseURL, resolvedPath, ep.Path, ep.Method,
			r.config.GlobalHeaders, r.config.Cookies,
			probeBody,
			swagger.FuzzingProfile("BASELINE"),
			built.queryParams,
			built.headers,
			ep.ContentType, built.oobTokens, built.pinned,
		)
		if res != nil && res.Status >= 200 && res.Status < 300 {
			accepted = append(accepted, cat)
		}
	}

	// Only narrow when the endpoint accepted a strict subset of canary categories.
	if len(accepted) > 0 && len(accepted) < len(catOrder) {
		r.detectedUploadCategories.Store(epKey, accepted)
		r.logDebug("Smart upload probing for %s detected accepted categories: %v", epKey, accepted)
	}
}

func buildCanaryProbeBody(schema *swagger.SchemaProperty, baselineBody any, canary swagger.UploadFile) any {
	if schema == nil {
		return baselineBody
	}
	if isFileUploadSchema(schema) {
		return canary
	}
	if schema.Type == "array" && isFileUploadSchema(schema.Items) {
		return []any{canary}
	}
	if schema.Type == "object" || len(schema.Properties) > 0 {
		var out map[string]any
		if m, ok := baselineBody.(map[string]any); ok && m != nil {
			out = make(map[string]any, len(m)+len(schema.Properties))
			for k, v := range m {
				out[k] = v
			}
		} else {
			out = make(map[string]any, len(schema.Properties))
		}
		for k, prop := range schema.Properties {
			if prop == nil {
				continue
			}
			if isFileUploadSchema(prop) {
				out[k] = canary
			} else if prop.Type == "array" && isFileUploadSchema(prop.Items) {
				out[k] = []any{canary}
			} else if hasFileUploadField(prop) {
				out[k] = buildCanaryProbeBody(prop, out[k], canary)
			}
		}
		return out
	}
	return baselineBody
}
