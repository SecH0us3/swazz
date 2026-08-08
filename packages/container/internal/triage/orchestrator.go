// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package triage

import (
	"context"
	"fmt"
	"sync"

	"swazz-engine/internal/ai"
	"swazz-engine/internal/logger"
	"swazz-engine/internal/swagger"
)

// GroupFinding holds a representative finding and all finding IDs belonging to that defect group.
type GroupFinding struct {
	DefectKey          string
	Representative     *swagger.AnalysisFinding
	Result             *swagger.FuzzResult
	AffectedFindingIDs []string
}

// TriageResult represents the classification result to be sent back to the Edge API.
type TriageResult struct {
	DefectKey     string   `json:"defect_key"`
	FindingIDs    []string `json:"finding_ids"`
	AIStatus      string   `json:"ai_status"`     // "completed" or "failed"
	AIRelevance   string   `json:"ai_relevance"`  // "True Positive" or "False Positive"
	AIExplanation string   `json:"ai_explanation"`
	AIConfidence  int      `json:"ai_confidence"`
}

// Orchestrator manages post-scan LLM false positive classification.
type Orchestrator struct {
	client      *ai.GatewayClient
	maxTriage   int
	workerCount int
}

// Confirmed rules that are high-confidence True Positives by design and skipped during triage.
var confirmedRules = map[string]bool{
	"swazz/sqli-confirmed":           true,
	"swazz/ssrf-oob":                 true,
	"swazz/path-traversal-confirmed": true,
	"swazz/rce-confirmed":            true,
}

// NewOrchestrator creates a new Smart Triage Orchestrator.
func NewOrchestrator(client *ai.GatewayClient, maxTriage int) *Orchestrator {
	if maxTriage <= 0 {
		maxTriage = 30
	}
	return &Orchestrator{
		client:      client,
		maxTriage:   maxTriage,
		workerCount: 3, // Bounded worker pool to prevent 429 rate limit spikes
	}
}

// Run executes post-scan triage across collected fuzz results.
func (o *Orchestrator) Run(ctx context.Context, results []*swagger.FuzzResult) []*TriageResult {
	if o.client == nil {
		logger.Warn("[Triage] ⚠️ AI Gateway client is nil, skipping triage")
		return nil
	}

	groups := o.GroupFindings(results)
	if len(groups) == 0 {
		logger.Info("[Triage] ℹ️ No triagable findings found")
		return nil
	}

	// Limit to maxTriage quota
	if len(groups) > o.maxTriage {
		logger.Info("[Triage] ℹ️ Enforcing scan quota: triaging top %d of %d defect groups", o.maxTriage, len(groups))
		groups = groups[:o.maxTriage]
	}

	logger.Info("[Triage] 🤖 Starting Smart Triage on %d representative defect groups using %d workers...", len(groups), o.workerCount)

	jobs := make(chan *GroupFinding, len(groups))
	for _, g := range groups {
		jobs <- g
	}
	close(jobs)

	resultsChan := make(chan *TriageResult, len(groups))
	var wg sync.WaitGroup

	for i := 0; i < o.workerCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for group := range jobs {
				if ctx.Err() != nil {
					resultsChan <- &TriageResult{
						DefectKey:     group.DefectKey,
						FindingIDs:    group.AffectedFindingIDs,
						AIStatus:      "failed",
						AIExplanation: "Triage context cancelled",
					}
					continue
				}

				res := o.triageSingleGroup(ctx, group)
				resultsChan <- res
			}
		}()
	}

	wg.Wait()
	close(resultsChan)

	var triageResults []*TriageResult
	for res := range resultsChan {
		triageResults = append(triageResults, res)
	}

	logger.Info("[Triage] ✅ Smart Triage complete: processed %d groups", len(triageResults))
	return triageResults
}

// GroupFindings groups findings by defectKey and selects the representative finding with the richest evidence.
func (o *Orchestrator) GroupFindings(results []*swagger.FuzzResult) []*GroupFinding {
	groupMap := make(map[string]*GroupFinding)
	var orderedKeys []string

	for _, res := range results {
		if res == nil {
			continue
		}
		for i := range res.AnalyzerFindings {
			finding := &res.AnalyzerFindings[i]

			// Skip confirmed high-confidence vulnerability rules
			if confirmedRules[finding.RuleID] {
				continue
			}

			defectKey := fmt.Sprintf("%s::%s %s", finding.RuleID, res.Method, res.Endpoint)
			findingID := finding.ID
			if findingID == "" {
				findingID = fmt.Sprintf("%s-%d", defectKey, i)
			}

			gf, exists := groupMap[defectKey]
			if !exists {
				gf = &GroupFinding{
					DefectKey:          defectKey,
					Representative:     finding,
					Result:             res,
					AffectedFindingIDs: []string{findingID},
				}
				groupMap[defectKey] = gf
				orderedKeys = append(orderedKeys, defectKey)
			} else {
				gf.AffectedFindingIDs = append(gf.AffectedFindingIDs, findingID)
				// Prefer finding with longer evidence field as representative
				if len(finding.Evidence) > len(gf.Representative.Evidence) {
					gf.Representative = finding
					gf.Result = res
				}
			}
		}
	}

	var groups []*GroupFinding
	for _, key := range orderedKeys {
		groups = append(groups, groupMap[key])
	}
	return groups
}

func (o *Orchestrator) triageSingleGroup(ctx context.Context, group *GroupFinding) *TriageResult {
	userPrompt := BuildPrompt(group.Representative, group.Result)
	rawResp, err := o.client.ChatCompletion(ctx, SystemPrompt, userPrompt)

	if err != nil {
		logger.Warn("[Triage] ⚠️ Failed LLM triage for %s: %v", group.DefectKey, err)
		return &TriageResult{
			DefectKey:     group.DefectKey,
			FindingIDs:    group.AffectedFindingIDs,
			AIStatus:      "failed",
			AIExplanation: fmt.Sprintf("AI Gateway error: %v", err),
		}
	}

	verdict, parseErr := ParseResponse(rawResp)
	if parseErr != nil {
		logger.Warn("[Triage] ⚠️ Failed parsing LLM response for %s: %v", group.DefectKey, parseErr)
		return &TriageResult{
			DefectKey:     group.DefectKey,
			FindingIDs:    group.AffectedFindingIDs,
			AIStatus:      "failed",
			AIExplanation: fmt.Sprintf("Parsing error: %v", parseErr),
		}
	}

	relevance := "True Positive"
	if verdict.Classification == "false_positive" {
		relevance = "False Positive"
	}

	logger.Info("[Triage] 🎯 %s -> %s (Confidence: %d%%) - %s", group.DefectKey, relevance, verdict.Confidence, verdict.Reasoning)

	return &TriageResult{
		DefectKey:     group.DefectKey,
		FindingIDs:    group.AffectedFindingIDs,
		AIStatus:      "completed",
		AIRelevance:   relevance,
		AIExplanation: verdict.Reasoning,
		AIConfidence:  verdict.Confidence,
	}
}
