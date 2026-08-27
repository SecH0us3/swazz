// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package differential

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/google/uuid"
	"swazz-engine/internal/swagger"
)

// RunnerContext abstracts runner dependencies for the differential phase.
type RunnerContext interface {
	Config() *swagger.Config
	LogDebug(format string, args ...any)
	LogInfo(format string, args ...any)
	LogWarn(format string, args ...any)
	LogError(format string, args ...any)

	BroadcastProgress()
	BroadcastResult(res *swagger.FuzzResult)

	UpdateProgressProfile(profile string)
	UpdateProgressEndpoint(epKey string)
	AddTotalEndpoints(n int32)
	AddCompletedEndpoints(n int32)
	AddTotalPlanned(n int64)

	SendStat(res *swagger.FuzzResult, currentIteration, totalIterations int)

	RLockConfig()
	RUnlockConfig()

	ExecuteAuthSequence(ctx context.Context, seq []swagger.AuthStep, headers map[string]string, cookies map[string]string) (map[string]string, map[string]string, error)
	ExecuteRequest(ctx context.Context, baseURL, resolvedPath, epPath, method string,
		globalHeaders map[string]string, globalCookies map[string]string,
		body any, profile swagger.FuzzingProfile, queryParams map[string]any,
		headers map[string]string, contentType string) *swagger.FuzzResult

	LimiterAcquire(ctx context.Context) error
	LimiterRelease()
}

// Phase orchestrates differential AST analysis and cross-identity verification.
type Phase struct {
	ctx       RunnerContext
	harvester *ChainHarvester
}

// NewPhase creates a new differential analysis phase orchestrator.
func NewPhase(ctx RunnerContext) *Phase {
	return &Phase{
		ctx:       ctx,
		harvester: NewChainHarvester(),
	}
}

// Harvester returns the stateful entity harvester for this phase.
func (p *Phase) Harvester() *ChainHarvester {
	return p.harvester
}

// Run executes the differential analysis phase if enabled in settings.
func (p *Phase) Run(ctx context.Context, results []*swagger.FuzzResult) []*swagger.FuzzResult {
	if !p.ctx.Config().Settings.DifferentialAnalysisEnabled() {
		return nil
	}

	p.ctx.UpdateProgressProfile("DIFFERENTIAL")
	p.ctx.LogInfo("Running Differential Analysis & Stateful Cross-Identity verification phase...")

	// 1. Ingest all 2xx/201 responses from the main fuzzing run
	p.ctx.RLockConfig()
	endpoints := make([]swagger.EndpointConfig, len(p.ctx.Config().Endpoints))
	copy(endpoints, p.ctx.Config().Endpoints)
	identitiesConfig := p.ctx.Config().AuthIdentities
	p.ctx.RUnlockConfig()

	for _, res := range results {
		bodyBytes := responseBodyToBytes(res.ResponseBody)
		if res.Status >= 200 && res.Status < 300 && len(bodyBytes) > 0 {
			for _, ep := range endpoints {
				if ep.Path == res.Endpoint && strings.EqualFold(ep.Method, res.Method) {
					p.harvester.RecordCreation(ep, bodyBytes, res.Status, "UserA")
					break
				}
			}
		}
	}

	harvested := p.harvester.GetHarvestedResources()
	if len(harvested) == 0 {
		p.ctx.LogDebug("Differential Analysis: No stateful entities harvested from 2xx responses.")
		return nil
	}

	p.ctx.LogInfo("Differential Analysis: Harvested %d stateful entities. Generating cross-identity chains...", len(harvested))

	// 2. Authenticate alternate identities
	identityHeaders := make(map[string]map[string]string)
	identityCookies := make(map[string]map[string]string)
	var identityNames []string

	for name, id := range identitiesConfig {
		identityNames = append(identityNames, name)
		if len(id.AuthSequence) > 0 {
			h, c, err := p.ctx.ExecuteAuthSequence(ctx, id.AuthSequence, id.Headers, id.Cookies)
			if err != nil {
				p.ctx.LogError("Differential Analysis: Failed to authenticate identity %s: %v", name, err)
			} else {
				identityHeaders[name] = h
				identityCookies[name] = c
			}
		} else {
			identityHeaders[name] = id.Headers
			identityCookies[name] = id.Cookies
		}
	}

	// 3. Build cross-identity probe candidates
	candidates := p.harvester.BuildCrossIdentityCandidates(endpoints, identityNames)
	if len(candidates) == 0 {
		p.ctx.LogDebug("Differential Analysis: No dependent endpoints matched harvested entities.")
		return nil
	}

	p.ctx.AddTotalPlanned(int64(len(candidates)))

	// 4. Concurrently probe candidates
	var findings []*swagger.FuzzResult
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, cand := range candidates {
		if err := p.ctx.LimiterAcquire(ctx); err != nil {
			break
		}
		wg.Add(1)

		go func(c ProbeCandidate) {
			defer p.ctx.LimiterRelease()
			defer wg.Done()

			var reqHeaders map[string]string
			var reqCookies map[string]string

			if c.ProbeIdentity == "Anonymous" {
				reqHeaders = make(map[string]string)
				reqCookies = make(map[string]string)
			} else {
				reqHeaders = copyHeaders(identityHeaders[c.ProbeIdentity])
				reqCookies = copyHeaders(identityCookies[c.ProbeIdentity])
			}

			probeRes := p.ctx.ExecuteRequest(
				ctx,
				p.ctx.Config().BaseURL,
				c.ResolvedPath,
				c.TargetEndpoint.Path,
				c.TargetEndpoint.Method,
				reqHeaders,
				reqCookies,
				nil,
				swagger.FuzzingProfile("DIFFERENTIAL"),
				nil,
				nil,
				c.TargetEndpoint.ContentType,
			)

			if probeRes == nil {
				return
			}

			probeBytes := responseBodyToBytes(probeRes.ResponseBody)

			// Perform AST comparison against baseline
			if probeRes.Status >= 200 && probeRes.Status < 300 && len(probeBytes) > 0 {
				probeFp, err := ExtractFingerprint(probeBytes)
				if err == nil {
					diff := CompareFingerprints(c.BaselineFingerprint, probeFp)

					var analysisFinding *swagger.AnalysisFinding

					if diff.IsProbableBOLA {
						ruleID := "swazz/differential-bola-idor"
						if c.ProbeIdentity == "Anonymous" {
							ruleID = "swazz/differential-unauthorized-access"
						}
						analysisFinding = &swagger.AnalysisFinding{
							ID:      uuid.New().String(),
							RuleID:  ruleID,
							Level:   "error",
							Message: fmt.Sprintf("BOLA/IDOR confirmed via Differential Analysis. Identity %s retrieved entity '%s' (creator: %s) on %s %s with %0.1f%% structural match.", c.ProbeIdentity, c.HarvestedID, c.CreatorIdentity, c.TargetEndpoint.Method, c.ResolvedPath, diff.Similarity*100),
							Evidence: fmt.Sprintf("Baseline Root: %s (%d fields), Probe Root: %s (%d fields), Structural Similarity: %0.2f",
								c.BaselineFingerprint.RootType, c.BaselineFingerprint.FieldCount, probeFp.RootType, probeFp.FieldCount, diff.Similarity),
							OWASPCategory:    []string{"A01:2021-Broken Access Control"},
							OWASPAPICategory: []string{"API1:2023 Broken Object Level Authorization"},
							CWEIDs:           []string{"CWE-284", "CWE-639"},
						}
					} else if diff.IsSchemaLeak {
						analysisFinding = &swagger.AnalysisFinding{
							ID:      uuid.New().String(),
							RuleID:  "swazz/differential-schema-drift",
							Level:   "error",
							Message: fmt.Sprintf("Schema Drift / Privilege Escalation detected on %s %s. Unexpected sensitive fields exposed: %v", c.TargetEndpoint.Method, c.ResolvedPath, diff.AddedFields),
							Evidence: fmt.Sprintf("Added sensitive fields: %s", strings.Join(diff.AddedFields, ", ")),
							OWASPCategory:    []string{"A01:2021-Broken Access Control"},
							OWASPAPICategory: []string{"API3:2023 Broken Object Property Level Authorization"},
							CWEIDs:           []string{"CWE-200", "CWE-915"},
						}
					}

					if analysisFinding != nil {
						probeRes.AnalyzerFindings = append(probeRes.AnalyzerFindings, *analysisFinding)
						mu.Lock()
						findings = append(findings, probeRes)
						mu.Unlock()
						p.ctx.BroadcastResult(probeRes)
					}
				}
			}
		}(cand)
	}

	wg.Wait()
	p.ctx.LogInfo("Differential Analysis complete. Identified %d confirmed findings.", len(findings))
	return findings
}

func responseBodyToBytes(body any) []byte {
	if body == nil {
		return nil
	}
	switch v := body.(type) {
	case []byte:
		return v
	case string:
		return []byte(v)
	default:
		return nil
	}
}

func copyHeaders(h map[string]string) map[string]string {
	if h == nil {
		return make(map[string]string)
	}
	out := make(map[string]string, len(h))
	for k, v := range h {
		out[k] = v
	}
	return out
}
