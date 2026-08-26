// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"swazz-engine/internal/generator"
	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/swagger"
)

// fuzzEndpoint runs all iterations for a single endpoint × profile combination.
func (r *Runner) fuzzEndpoint(
	ctx context.Context,
	profileIdx int,
	profile swagger.FuzzingProfile,
	epIdx int,
	endpoint swagger.EndpointConfig,
	gen *generator.Generator,
	safeGen *generator.Generator,
	iterToSkip int,
) {
	endpoints := r.config.Endpoints
	epKey := fmt.Sprintf("%s %s", endpoint.Method, endpoint.Path)

	r.progress.currentEndpoint.Store(epKey)
	r.progress.completedEndpoints.Store(int32(len(endpoints) + profileIdx*len(endpoints) + epIdx)) // #nosec G115
	r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})

	if r.config.Settings.ActiveParameterFuzzing {
		fields := collectTargetFields(&endpoint)
		if len(fields) > 0 {
			r.runActiveParameterFuzzing(ctx, profileIdx, profile, epIdx, endpoint, gen, safeGen, fields, iterToSkip)
			return
		}
	}

	effectiveIter := calcEffectiveIterations(profile, r.config.Settings, &endpoint)
	maxPayload := calcMaxPayloadSize(profile, r.config.Settings)
	enableDedup := profile == swagger.ProfileRandom

	var wg sync.WaitGroup
	seenHashes := make(map[uint32]bool)
	delay := time.Duration(r.config.Settings.DelayBetweenRequestMs) * time.Millisecond

	for i := range effectiveIter {
		if i < iterToSkip {
			continue
		}
		if r.stopped() {
			break
		}

		isSecHeaderIter := isSecurityHeaderIteration(gen, profile, i)
		built, payloadHash, isDuplicate := r.buildFuzzIteration(
			endpoint, gen, safeGen, isSecHeaderIter, maxPayload, enableDedup, seenHashes,
		)
		if isDuplicate {
			r.progress.totalPlanned.Add(-1)
			continue
		}
		if enableDedup {
			seenHashes[payloadHash] = true
		}

		// Inject security-test headers if we are in a header-fuzzing iteration.
		if isSecHeaderIter {
			if secHeaders := gen.GenerateSecurityHeaders(); secHeaders != nil {
				if built.headers == nil {
					built.headers = make(map[string]string, len(secHeaders))
				}
				for k, v := range secHeaders {
					built.headers[k] = v
				}
			}
		}

		r.waitIfPaused()
		if r.stopped() {
			break
		}

		if err := r.limiter.Acquire(ctx); err != nil {
			break
		}
		wg.Add(1)

		go func(it int, p any, qp map[string]any, gh map[string]string, pp map[string]string) {
			defer r.limiter.Release()
			defer wg.Done()

			resolvedPath := fillPathParamsFromMap(endpoint.Path, pp)
			result := r.executeRequest(
				ctx,
				r.config.BaseURL, resolvedPath, endpoint.Path, endpoint.Method,
				r.config.GlobalHeaders, r.config.Cookies,
				p, profile, qp, gh,
				endpoint.ContentType,
			)

			if len(result.AnalyzerFindings) > 0 {
				for fi := range result.AnalyzerFindings {
					if result.AnalyzerFindings[fi].ID == "" {
						result.AnalyzerFindings[fi].ID = uuid.New().String()
					}
				}
			}

			if profile == swagger.ProfileRandom && result.Status >= 200 && result.Status < 300 {
				r.recordSizeBaseline(endpoint.Method, endpoint.Path, result.ResponseSize)
				r.recordTimeBaseline(endpoint.Method, endpoint.Path, result.Duration)
			}

			r.statsChan <- statsMsg{
				result:           result,
				currentIteration: it + 1,
				totalIterations:  effectiveIter,
				endpoint:         epKey,
				profile:          string(profile),
			}
			r.Broadcast(Event{Type: EventResult, Data: result})

			if result.Status >= 200 && result.Status < 300 {
				r.resultsMu.Lock()
				r.allResults = append(r.allResults, result)
				r.resultsMu.Unlock()
			}
		}(i, built.body, built.queryParams, built.headers, built.pathParams)

		if delay > 0 {
			time.Sleep(delay)
		}
	}

	wg.Wait()

	r.progress.completedEndpoints.Store(int32(len(endpoints) + profileIdx*len(endpoints) + epIdx + 1)) // #nosec G115
	r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})
}

// buildFuzzIteration generates one payload attempt, enforces the size cap and
// dedup check, and returns the result along with its hash and whether it was a
// duplicate. The caller owns the outer retry loop via effectiveIter.
func (r *Runner) buildFuzzIteration(
	endpoint swagger.EndpointConfig,
	gen, safeGen *generator.Generator,
	isSecHeaderIter bool,
	maxPayloadSize int,
	enableDedup bool,
	seenHashes map[uint32]bool,
) (built generatedPayload, hash uint32, duplicate bool) {
	const maxRetries = 10
	hash = payloads.HashStr("empty")

	if !hasFields(&endpoint) {
		// No fields to generate — only headers differ per iteration.
		built = generatedPayload{headers: buildHeaders(endpoint, selectGen(gen, safeGen, isSecHeaderIter))}
		if enableDedup {
			duplicate = seenHashes[hash]
		}
		return built, hash, duplicate
	}

	for range maxRetries {
		attempt := buildFuzzPayload(endpoint, gen, safeGen, isSecHeaderIter, enableDedup)

		// Size check via buffer pool.
		buf := bufPool.Get().(*bytes.Buffer)
		buf.Reset()
		var encErr error
		payloadMap := make(map[string]any)
		if attempt.body != nil {
			payloadMap["body"] = attempt.body
		}
		if attempt.queryParams != nil {
			payloadMap["queryParams"] = attempt.queryParams
		}
		if attempt.pathParams != nil {
			payloadMap["pathParams"] = attempt.pathParams
		}
		if len(payloadMap) > 0 {
			encErr = json.NewEncoder(buf).Encode(payloadMap)
		} else {
			buf.WriteByte('{')
			buf.WriteByte('}')
		}

		if encErr != nil || buf.Len() > maxPayloadSize {
			bufPool.Put(buf)
			continue
		}

		b := buf.Bytes()
		if len(b) > 0 && b[len(b)-1] == '\n' {
			b = b[:len(b)-1]
		}
		hash = payloads.HashBytes(b)
		bufPool.Put(buf)

		if enableDedup && seenHashes[hash] {
			continue
		}

		return attempt, hash, false
	}

	// All retries exhausted — treat as duplicate to skip.
	return generatedPayload{}, hash, true
}

// isSecurityHeaderIteration reports whether iteration i should use a safe
// body payload and inject security-test headers instead of fuzzing the body.
func isSecurityHeaderIteration(gen *generator.Generator, profile swagger.FuzzingProfile, i int) bool {
	if profile != swagger.ProfileMalicious {
		return false
	}
	return i >= gen.BodyIterations()
}
