// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"swazz-engine/internal/ai"
)

func (r *Runner) runPreScanLLM(ctx context.Context) {
	if !r.config.Settings.UseLLMPrepass {
		return
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	googleKey := os.Getenv("GOOGLE_API_KEY")
	if googleKey == "" {
		googleKey = os.Getenv("OPENAI_API_KEY")
	}

	planner := ai.NewSemanticPlanner(r.config.Settings.AIGatewayURL, r.config.Settings.CFAigToken, googleKey)

	var summaryBuilder strings.Builder
	for _, ep := range r.config.Endpoints {
		summaryBuilder.WriteString(fmt.Sprintf("Endpoint: %s %s\n", ep.Method, ep.Path))
		for pName, pProp := range ep.PathParams {
			if pProp != nil {
				summaryBuilder.WriteString(fmt.Sprintf("  PathParam: %s (%s, %s)\n", pName, pProp.Type, pProp.Format))
			}
		}
		for pName, pProp := range ep.QueryParams {
			if pProp != nil {
				summaryBuilder.WriteString(fmt.Sprintf("  QueryParam: %s (%s, %s)\n", pName, pProp.Type, pProp.Format))
			}
		}
		for pName, pProp := range ep.HeaderParams {
			if pProp != nil {
				summaryBuilder.WriteString(fmt.Sprintf("  Header: %s (%s, %s)\n", pName, pProp.Type, pProp.Format))
			}
		}
		for pName, pProp := range ep.Schema.Properties {
			if pProp != nil {
				summaryBuilder.WriteString(fmt.Sprintf("  BodyField: %s (%s, %s)\n", pName, pProp.Type, pProp.Format))
			}
		}
	}

	customPayloads, err := planner.GeneratePreScanPayloads(timeoutCtx, summaryBuilder.String())
	if err != nil {
		r.logWarn("[AI] ⚠️ Pre-Scan LLM Batching failed: %v", err)
		return
	}

	if len(customPayloads) > 0 {
		if r.config.Dictionaries == nil {
			r.config.Dictionaries = make(map[string][]any)
		}
		anyPayloads := make([]any, len(customPayloads))
		for i, p := range customPayloads {
			anyPayloads[i] = p
		}
		r.config.Dictionaries["custom_llm"] = anyPayloads
		r.logInfo("[AI] ✅ Registered %d custom LLM payloads into fuzzing dictionary", len(customPayloads))
	}
}
