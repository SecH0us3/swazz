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
			if secHeaders := gen.GenerateSecurityHeaders(); secHeaders != nil {
				if built.headers == nil {
					built.headers = secHeaders
				} else {
					for k, v := range secHeaders {
						built.headers[k] = v
					}
				}
			}
		}

		r.waitIfPaused(ctx)
		if r.stopped() || ctx.Err() != nil {
			break
		}

		if err := r.limiter.Acquire(ctx); err != nil {
			break
		}
		wg.Add(1)

		it, p, qp, gh, pp := i, built.body, built.queryParams, built.headers, built.pathParams
		r.goWorker(func() {
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

// sizedPayloadHash hashes the payload's JSON encoding, which also decides whether it fits: fits is
// false when the encoding is over maxBytes. A payload whose encoding cannot fit is rejected before
// it is encoded, since encoding a multi-megabyte boundary string only to discard it dominated a
// scan's allocations.
func sizedPayloadHash(p generatedPayload, maxBytes int) (hash uint32, fits bool) {
	if minPayloadEncodedSize(p, maxBytes) > maxBytes {
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

	if p.body != nil {
		buf.WriteString(`"body":`)
		if err := enc.Encode(p.body); err != nil {
			return err
		}
		if buf.Len() > 0 && buf.Bytes()[buf.Len()-1] == '\n' {
			buf.Truncate(buf.Len() - 1)
		}
		hasPrev = true
	}

	if p.pathParams != nil {
		if hasPrev {
			buf.WriteByte(',')
		}
		buf.WriteString(`"pathParams":`)
		if err := enc.Encode(p.pathParams); err != nil {
			return err
		}
		if buf.Len() > 0 && buf.Bytes()[buf.Len()-1] == '\n' {
			buf.Truncate(buf.Len() - 1)
		}
		hasPrev = true
	}

	if p.queryParams != nil {
		if hasPrev {
			buf.WriteByte(',')
		}
		buf.WriteString(`"queryParams":`)
		if err := enc.Encode(p.queryParams); err != nil {
			return err
		}
		if buf.Len() > 0 && buf.Bytes()[buf.Len()-1] == '\n' {
			buf.Truncate(buf.Len() - 1)
		}
	}

	buf.WriteByte('}')
	return nil
}

// payloadFits reports whether p's JSON encoding fits within maxBytes without
// allocating or hashing when an upper bound already proves it fits.
func payloadFits(p generatedPayload, maxBytes int) bool {
	if minPayloadEncodedSize(p, maxBytes) > maxBytes {
		return false
	}
	if maxPayloadEncodedSize(p, maxBytes) <= maxBytes {
		return true
	}
	_, fits := sizedPayloadHash(p, maxBytes)
	return fits
}

func minPayloadEncodedSize(p generatedPayload, limit int) int {
	count := 0
	if p.body != nil {
		count++
	}
	if p.pathParams != nil {
		count++
	}
	if p.queryParams != nil {
		count++
	}
	if count == 0 {
		return 2
	}
	n := 2 + commas(count)
	if p.body != nil {
		n += len("body") + 3
		n += minEncodedSize(p.body, limit-n)
		if n > limit {
			return n
		}
	}
	if p.pathParams != nil {
		n += len("pathParams") + 3
		n += minEncodedSize(p.pathParams, limit-n)
		if n > limit {
			return n
		}
	}
	if p.queryParams != nil {
		n += len("queryParams") + 3
		n += minEncodedSize(p.queryParams, limit-n)
		if n > limit {
			return n
		}
	}
	return n
}

func maxPayloadEncodedSize(p generatedPayload, limit int) int {
	count := 0
	if p.body != nil {
		count++
	}
	if p.pathParams != nil {
		count++
	}
	if p.queryParams != nil {
		count++
	}
	if count == 0 {
		return 2
	}
	n := 2 + commas(count)
	if p.body != nil {
		n += len("body") + 3
		n += maxEncodedSize(p.body, limit-n)
		if n > limit {
			return n
		}
	}
	if p.pathParams != nil {
		n += len("pathParams") + 3
		n += maxEncodedSize(p.pathParams, limit-n)
		if n > limit {
			return n
		}
	}
	if p.queryParams != nil {
		n += len("queryParams") + 3
		n += maxEncodedSize(p.queryParams, limit-n)
		if n > limit {
			return n
		}
	}
	return n
}

func maxEncodedSize(v any, limit int) int {
	switch t := v.(type) {
	case nil:
		return 4
	case bool:
		return 5
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return 20
	case float64:
		if math.IsInf(t, 0) || math.IsNaN(t) {
			return limit + 1
		}
		return 24
	case float32:
		if math.IsInf(float64(t), 0) || math.IsNaN(float64(t)) {
			return limit + 1
		}
		return 24
	case string:
		return len(t)*6 + 2
	case map[string]any:
		n := 2 + commas(len(t))
		for k, item := range t {
			n += len(k)*6 + 3
			n += maxEncodedSize(item, limit-n)
			if n > limit {
				return n
			}
		}
		return n
	case []any:
		n := 2 + commas(len(t))
		for _, item := range t {
			n += maxEncodedSize(item, limit-n)
			if n > limit {
				return n
			}
		}
		return n
	case map[string]string:
		n := 2 + commas(len(t))
		for k, item := range t {
			n += len(k)*6 + len(item)*6 + 5
			if n > limit {
				return n
			}
		}
		return n
	default:
		return limit + 1
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

		if !enableDedup {
			if !payloadFits(attempt, maxPayloadSize) {
				continue
			}
			return attempt, hash, false
		}

		h, fits := sizedPayloadHash(attempt, maxPayloadSize)
		if !fits {
			continue
		}
		hash = h

		if seenHashes[hash] {
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

// minEncodedSize returns a lower bound on the length of v's JSON encoding, the way the payload
// size check encodes it (json.Encoder: no indentation). It counts only what any encoding has
// (string content, quotes, colons, commas, brackets); escaping only adds to it, so a value it puts
// above the cap is certainly above it. It stops counting once the bound exceeds limit.
func minEncodedSize(v any, limit int) int {
	switch t := v.(type) {
	case string:
		return len(t) + 2
	case map[string]any:
		n := 2 + commas(len(t))
		for k, item := range t {
			n += len(k) + 3 // quotes and colon
			n += minEncodedSize(item, limit-n)
			if n > limit {
				return n
			}
		}
		return n
	case []any:
		n := 2 + commas(len(t))
		for _, item := range t {
			n += minEncodedSize(item, limit-n)
			if n > limit {
				return n
			}
		}
		return n
	case map[string]string:
		n := 2 + commas(len(t))
		for k, item := range t {
			n += len(k) + len(item) + 5 // two pairs of quotes and a colon
			if n > limit {
				return n
			}
		}
		return n
	}
	return 1 // every JSON value takes at least one byte
}

// commas is how many separators a JSON object or array of n entries has.
func commas(n int) int {
	if n == 0 {
		return 0
	}
	return n - 1
}
