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
	"math"
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
	maxPayload := r.config.Settings.PayloadSizeCap()
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
			mergeSecurityHeaders(&built, gen)
		}

		r.waitIfPaused(ctx)
		if r.stopped() || ctx.Err() != nil {
			break
		}

		if err := r.limiter.Acquire(ctx); err != nil {
			break
		}
		wg.Add(1)

		it, p, qp, gh, pp, ot := i, built.body, built.queryParams, built.headers, built.pathParams, built.oobTokens
		r.goWorker(func() {
			defer r.limiter.Release()
			defer wg.Done()

			resolvedPath := fillPathParamsFromMap(endpoint.Path, pp)
			result := r.executeGeneratedRequest(
				ctx,
				r.config.BaseURL, resolvedPath, endpoint.Path, endpoint.Method,
				r.config.GlobalHeaders, r.config.Cookies,
				p, profile, qp, gh,
				endpoint.ContentType, ot,
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

			// A result of a run that has ended (a worker finalise gave up waiting for) is dropped
			// whole: not counted, streamed or kept.
			if !r.sendStats(statsMsg{
				result:           result,
				currentIteration: it + 1,
				totalIterations:  effectiveIter,
				endpoint:         epKey,
				profile:          string(profile),
			}) {
				return
			}
			r.Broadcast(Event{Type: EventResult, Data: result})

			if result.Status >= 200 && result.Status < 300 {
				r.retainResult(result)
			}
		})

		if delay > 0 {
			time.Sleep(delay)
		}
	}

	wg.Wait()

	r.progress.completedEndpoints.Store(int32(len(endpoints) + profileIdx*len(endpoints) + epIdx + 1)) // #nosec G115
	r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})
}

func mergeSecurityHeaders(built *generatedPayload, gen *generator.Generator) {
	secHeaders := gen.GenerateSecurityHeaders()
	built.oobTokens = append(built.oobTokens, gen.TakeOOBTokens()...)
	if secHeaders == nil {
		return
	}
	if built.headers == nil {
		// Safe to alias: GenerateSecurityHeaders returns a newly allocated map per call.
		built.headers = secHeaders
		return
	}
	for k, v := range secHeaders {
		built.headers[k] = v
	}
}

type payloadField struct {
	key     string
	present bool
	val     any
}

func payloadFields(p generatedPayload) [3]payloadField {
	return [3]payloadField{
		{key: "body", present: p.body != nil, val: p.body},
		{key: "pathParams", present: p.pathParams != nil, val: p.pathParams},
		{key: "queryParams", present: p.queryParams != nil, val: p.queryParams},
	}
}

// sizedPayloadHash hashes the payload's JSON encoding, which also decides whether it fits: fits is
// false when the encoding is over maxBytes. A payload whose encoding cannot fit is rejected before
// it is encoded, since encoding a multi-megabyte boundary string only to discard it dominated a
// scan's allocations.
func sizedPayloadHash(p generatedPayload, maxBytes int) (hash uint32, fits bool) {
	if lo, _ := payloadEncodedBounds(p, maxBytes); lo > maxBytes {
		return 0, false
	}

	buf := bufPool.Get().(*bytes.Buffer)
	defer PutBuffer(buf)
	buf.Reset()

	if err := encodePayloadFields(buf, p); err != nil {
		return 0, false
	}
	b := buf.Bytes()
	if len(b) > maxBytes {
		return 0, false
	}
	return payloads.HashBytes(b), true
}

func encodePayloadFields(buf *bytes.Buffer, p generatedPayload) error {
	buf.WriteByte('{')
	enc := json.NewEncoder(buf)
	hasPrev := false
	for _, f := range payloadFields(p) {
		if !f.present {
			continue
		}
		if hasPrev {
			buf.WriteByte(',')
		}
		buf.WriteByte('"')
		buf.WriteString(f.key)
		buf.WriteString(`":`)
		if err := enc.Encode(f.val); err != nil {
			return err
		}
		buf.Truncate(buf.Len() - 1) // strip json.Encoder's trailing '\n'
		hasPrev = true
	}
	buf.WriteByte('}')
	return nil
}

// payloadFits reports whether p's JSON encoding fits within maxBytes without
// allocating or hashing when the bounds walk already decides, or by encoding
// into a pooled buffer without hashing when the upper bound is loose.
func payloadFits(p generatedPayload, maxBytes int) bool {
	lo, hi := payloadEncodedBounds(p, maxBytes)
	if lo > maxBytes {
		return false
	}
	if hi <= maxBytes {
		return true
	}

	buf := bufPool.Get().(*bytes.Buffer)
	defer PutBuffer(buf)
	buf.Reset()

	if err := encodePayloadFields(buf, p); err != nil {
		return false
	}
	return buf.Len() <= maxBytes
}

func payloadEncodedBounds(p generatedPayload, limit int) (lo, hi int) {
	fields := payloadFields(p)
	count := 0
	for _, f := range fields {
		if f.present {
			count++
		}
	}
	if count == 0 {
		return 2, 2
	}
	lo = 2 + commas(count)
	hi = lo
	for _, f := range fields {
		if !f.present {
			continue
		}
		keyLen := len(f.key) + 3
		lo += keyLen
		hi += keyLen
		if lo > limit {
			return lo, hi
		}
		fLo, fHi := encodedSizeBounds(f.val, limit-lo)
		lo += fLo
		hi += fHi
		if lo > limit {
			return lo, hi
		}
	}
	return lo, hi
}

// encodedSizeBounds returns lower and upper bounds (lo, hi) on the length of v's JSON encoding
// the way json.Encoder writes it (no indentation, HTML escaping enabled). A value with lo > limit
// is guaranteed to exceed limit without encoding; a value with hi <= limit is guaranteed to fit.
// The walk stops early once lo exceeds limit.
func encodedSizeBounds(v any, limit int) (lo, hi int) {
	switch t := v.(type) {
	case nil:
		return 4, 4
	case bool:
		return 4, 5
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return 1, 20
	case float64:
		if math.IsInf(t, 0) || math.IsNaN(t) {
			return 1, max(limit, 0) + 1
		}
		return 1, 32
	case float32:
		if math.IsInf(float64(t), 0) || math.IsNaN(float64(t)) {
			return 1, max(limit, 0) + 1
		}
		return 1, 32
	case string:
		return len(t) + 2, len(t)*6 + 2
	case []string:
		if t == nil {
			return 4, 4
		}
		lo = 2 + commas(len(t))
		hi = lo
		for _, s := range t {
			lo += len(s) + 2
			hi += len(s)*6 + 2
			if lo > limit {
				return lo, hi
			}
		}
		return lo, hi
	case map[string]any:
		if t == nil {
			return 4, 4
		}
		lo = 2 + commas(len(t))
		hi = lo
		for k, item := range t {
			lo += len(k) + 3
			hi += len(k)*6 + 3
			if lo > limit {
				return lo, hi
			}
			itemLo, itemHi := encodedSizeBounds(item, limit-lo)
			lo += itemLo
			hi += itemHi
			if lo > limit {
				return lo, hi
			}
		}
		return lo, hi
	case []any:
		if t == nil {
			return 4, 4
		}
		lo = 2 + commas(len(t))
		hi = lo
		for _, item := range t {
			itemLo, itemHi := encodedSizeBounds(item, limit-lo)
			lo += itemLo
			hi += itemHi
			if lo > limit {
				return lo, hi
			}
		}
		return lo, hi
	case map[string]string:
		if t == nil {
			return 4, 4
		}
		lo = 2 + commas(len(t))
		hi = lo
		for k, item := range t {
			lo += len(k) + len(item) + 5
			hi += len(k)*6 + len(item)*6 + 5
			if lo > limit {
				return lo, hi
			}
		}
		return lo, hi
	default:
		return 1, max(limit, 0) + 1
	}
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

	if !hasFields(&endpoint) {
		// No fields to generate — only headers differ per iteration.
		built = generatedPayload{headers: buildHeaders(endpoint, selectGen(gen, safeGen, isSecHeaderIter)), oobTokens: gen.TakeOOBTokens()}
		if enableDedup {
			hash = payloads.HashStr("empty")
			duplicate = seenHashes[hash]
		}
		return built, hash, duplicate
	}

	for range maxRetries {
		attempt := buildFuzzPayload(endpoint, gen, safeGen, isSecHeaderIter, enableDedup)

		if !enableDedup {
			if !payloadFits(attempt, maxPayloadSize) {
				continue
			}
			return attempt, 0, false
		}

		h, fits := sizedPayloadHash(attempt, maxPayloadSize)
		if !fits {
			continue
		}
		if seenHashes[h] {
			continue
		}

		return attempt, h, false
	}

	// All retries exhausted — treat as duplicate to skip.
	return generatedPayload{}, 0, true
}

// isSecurityHeaderIteration reports whether iteration i should use a safe
// body payload and inject security-test headers instead of fuzzing the body.
func isSecurityHeaderIteration(gen *generator.Generator, profile swagger.FuzzingProfile, i int) bool {
	if profile != swagger.ProfileMalicious {
		return false
	}
	return i >= gen.BodyIterations()
}

// commas is how many separators a JSON object or array of n entries has.
func commas(n int) int {
	if n == 0 {
		return 0
	}
	return n - 1
}
