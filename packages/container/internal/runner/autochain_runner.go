// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"swazz-engine/internal/autochain"
	"swazz-engine/internal/swagger"
)

func (r *Runner) initAutoChain() {
	r.configMu.RLock()
	enabled := r.config.Settings.AutoChainingEnabled()
	eps := slices.Clone(r.config.Endpoints)
	rules := slices.Clone(r.config.Settings.ChainingRules)
	baseURL := r.config.BaseURL
	r.configMu.RUnlock()

	if !enabled {
		r.chainPlan = autochain.IdentityPlan(eps)
		r.chainPool = nil
		r.chainIndex = nil
		return
	}
	r.chainPlan = autochain.BuildPlan(eps, rules, baseURL)
	r.chainPool = autochain.NewPool()
	idx := make(map[string]int, len(r.chainPlan.Ordered))
	for i, ep := range r.chainPlan.Ordered {
		idx[strings.ToUpper(ep.Method)+" "+ep.Path] = i
	}
	r.chainIndex = idx
}

func (r *Runner) activeEndpoints() []swagger.EndpointConfig {
	r.configMu.RLock()
	cfgEps := r.config.Endpoints
	r.configMu.RUnlock()
	if r.chainPlan != nil && len(r.chainPlan.Ordered) == len(cfgEps) {
		return r.chainPlan.Ordered
	}
	return cfgEps
}

func (r *Runner) hasAutoChainProducerFor(originalPath, method string) bool {
	if r.chainPool == nil || r.chainPlan == nil {
		return false
	}
	epIdx, ok := r.chainIndex[strings.ToUpper(method)+" "+originalPath]
	return ok && epIdx < len(r.chainPlan.Producers) && len(r.chainPlan.Producers[epIdx]) > 0
}

// shouldPinBulkIteration pins 80% of bulk fuzzing iterations (0,1,2,3 mod 5) and leaves
// every 5th iteration (4 mod 5) unpinned so FK/path parameters still get fuzzed directly.
func shouldPinBulkIteration(iterIdx int, isSecHeaderIter bool) bool {
	if isSecHeaderIter {
		return true
	}
	return iterIdx%5 != 4
}

type sacrificialVal struct {
	coerced any
	str     string
}

// prepareEndpointPool ensures sacrificial IDs exist before DELETE or re-seeds an evicted pool.
func (r *Runner) prepareEndpointPool(ctx context.Context, epIdx int) map[string]sacrificialVal {
	if r.chainPool == nil || r.chainPlan == nil || epIdx < 0 || epIdx >= len(r.chainPlan.Bindings) {
		return nil
	}
	ep := r.chainPlan.Ordered[epIdx]
	isDelete := strings.EqualFold(ep.Method, "DELETE")
	bindings := r.chainPlan.Bindings[epIdx]
	if len(bindings) == 0 {
		return nil
	}

	var sac map[string]sacrificialVal
	for _, b := range bindings {
		if isDelete {
			if r.chainPool.LiveCount(b.PoolKey) <= 1 && b.PrimaryProd >= 0 {
				r.mintFromProducer(ctx, b.PrimaryProd)
			}
			if r.chainPool.LiveCount(b.PoolKey) > 1 {
				if val, str, ok := r.chainPool.TakeSacrificial(b.PoolKey, b.TargetSchema); ok {
					if sac == nil {
						sac = make(map[string]sacrificialVal, 2)
					}
					sac[b.PoolKey] = sacrificialVal{coerced: val, str: str}
				}
			}
			continue
		}
		if r.chainPool.LiveCount(b.PoolKey) == 0 && r.chainPool.HadEntries(b.PoolKey) && b.PrimaryProd >= 0 {
			r.mintFromProducer(ctx, b.PrimaryProd)
		}
	}
	return sac
}

func (r *Runner) mintFromProducer(ctx context.Context, prodIdx int) {
	r.waitIfPaused(ctx)
	if r.stopped() || ctx.Err() != nil || !r.chainPool.TryAcquireReseed(prodIdx) {
		return
	}
	prodEP := r.chainPlan.Ordered[prodIdx]
	safeGen := r.newGenerator(swagger.ProfileRandom, prodEP.Method+" "+prodEP.Path)
	built := buildSafePayload(prodEP, safeGen)
	r.overlayBindings(prodIdx, &built, nil)

	r.progress.totalPlanned.Add(1)
	resolvedPath := fillPathParamsFromMap(prodEP.Path, built.pathParams)
	res := r.executeGeneratedRequestPinned(
		ctx,
		r.config.BaseURL, resolvedPath, prodEP.Path, prodEP.Method,
		r.config.GlobalHeaders, r.config.Cookies,
		built.body, swagger.FuzzingProfile("BASELINE"),
		built.queryParams, built.headers, prodEP.ContentType,
		built.oobTokens, built.pinned,
	)
	r.sendStats(statsMsg{
		result:           res,
		currentIteration: 1,
		totalIterations:  1,
		endpoint:         prodEP.Method + " " + prodEP.Path,
		profile:          "BASELINE",
	})
}

func (r *Runner) overlayBindings(epIdx int, built *generatedPayload, sac map[string]sacrificialVal) {
	if r.chainPool == nil || r.chainPlan == nil || epIdx < 0 || epIdx >= len(r.chainPlan.Bindings) {
		return
	}
	bindings := r.chainPlan.Bindings[epIdx]
	if len(bindings) == 0 {
		return
	}
	isDelete := strings.EqualFold(r.chainPlan.Ordered[epIdx].Method, "DELETE")
	for _, b := range bindings {
		var (
			coerced any
			strVal  string
			ok      bool
		)
		if sv, hasSac := sac[b.PoolKey]; hasSac {
			coerced, strVal, ok = sv.coerced, sv.str, true
		} else if !isDelete {
			coerced, strVal, ok = r.chainPool.GetCoerced(b.PoolKey, b.TargetSchema)
		}
		if !ok || len(b.ParamPath) == 0 {
			continue
		}
		switch b.Location {
		case autochain.LocPath:
			if built.pathParams == nil {
				built.pathParams = make(map[string]string)
			}
			built.pathParams[b.ParamPath[0]] = capPathParam(strVal)
		case autochain.LocQuery:
			if built.queryParams == nil {
				built.queryParams = make(map[string]any)
			}
			setNestedValue(built.queryParams, b.ParamPath, coerced)
		case autochain.LocHeader:
			if built.headers == nil {
				built.headers = make(map[string]string)
			}
			built.headers[b.ParamPath[0]] = fmt.Sprintf("%v", strVal)
		case autochain.LocBody:
			if built.body == nil {
				built.body = make(map[string]any)
			}
			setNestedValue(built.body, b.ParamPath, coerced)
		}
		built.pinned = append(built.pinned, autochain.PinnedBinding{
			PoolKey:   b.PoolKey,
			StrVal:    strVal,
			Location:  b.Location,
			ParamPath: slices.Clone(b.ParamPath),
		})
	}
}

func (r *Runner) harvestAutoChain(originalPath, method string, status int, profile swagger.FuzzingProfile, headers http.Header, rawBody []byte, payload, queryParams any) {
	if r.chainPool == nil || r.chainPlan == nil || status < 200 || status >= 300 {
		return
	}
	if profile != swagger.ProfileRandom && profile != swagger.FuzzingProfile("BASELINE") {
		return
	}
	epIdx, ok := r.chainIndex[strings.ToUpper(method)+" "+originalPath]
	if !ok || epIdx >= len(r.chainPlan.Producers) {
		return
	}
	rules := r.chainPlan.Producers[epIdx]
	if len(rules) == 0 {
		return
	}
	r.chainPool.HarvestResponse(rules, headers, rawBody, payload, queryParams)
}

func (r *Runner) recordAutoChainMisses(method string, status int, pinned []autochain.PinnedBinding) {
	if r.chainPool == nil || len(pinned) == 0 || strings.EqualFold(method, "DELETE") {
		return
	}
	if status != http.StatusNotFound && status != http.StatusGone {
		return
	}
	for _, pb := range pinned {
		r.chainPool.RecordMiss(pb.PoolKey, pb.StrVal)
	}
}

// seedResumeProducers warms up upstream PrimaryProd endpoints when resuming from a checkpoint
// that skipped baselinePhase.
func (r *Runner) seedResumeProducers(ctx context.Context, resumeEndpoint string) {
	if r.chainPool == nil || r.chainPlan == nil {
		return
	}
	startIdx := 0
	for i, ep := range r.chainPlan.Ordered {
		if (ep.Method + " " + ep.Path) == resumeEndpoint {
			startIdx = i
			break
		}
	}
	needed := make(map[int]bool)
	var collectAncestors func(idx int)
	collectAncestors = func(idx int) {
		for _, b := range r.chainPlan.Bindings[idx] {
			if b.PrimaryProd >= 0 && !needed[b.PrimaryProd] {
				needed[b.PrimaryProd] = true
				collectAncestors(b.PrimaryProd)
			}
		}
	}
	for i := startIdx; i < len(r.chainPlan.Ordered); i++ {
		collectAncestors(i)
	}
	if len(needed) == 0 {
		return
	}
	prodOrder := make([]int, 0, len(needed))
	for idx := range needed {
		prodOrder = append(prodOrder, idx)
	}
	slices.Sort(prodOrder)
	for _, prodIdx := range prodOrder {
		r.mintFromProducer(ctx, prodIdx)
	}
}
