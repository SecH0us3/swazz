package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"swazz-engine/internal/generator"
	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/swagger"
)

type targetField struct {
	Location string                   // "body", "query", "header", "path"
	Path     []string                 // e.g. ["user", "name"]
	Schema   *swagger.SchemaProperty
}

// collectTargetFields lists all scalar and array properties that are fuzzable.
func collectTargetFields(ep *swagger.EndpointConfig) []targetField {
	var fields []targetField

	// Body properties
	if !isNoBodyMethod(ep.Method) {
		var collectBody func(path []string, schema *swagger.SchemaProperty)
		collectBody = func(path []string, schema *swagger.SchemaProperty) {
			if schema == nil {
				return
			}
			if schema.Type == "object" && len(schema.Properties) > 0 {
				for k, prop := range schema.Properties {
					collectBody(append(path, k), prop)
				}
			} else {
				fields = append(fields, targetField{
					Location: "body",
					Path:     path,
					Schema:   schema,
				})
			}
		}
		if ep.Schema.Type == "object" && len(ep.Schema.Properties) > 0 {
			for k, prop := range ep.Schema.Properties {
				collectBody([]string{k}, prop)
			}
		} else if ep.Schema.Type != "" {
			fields = append(fields, targetField{
				Location: "body",
				Path:     []string{},
				Schema:   &ep.Schema,
			})
		}
	}

	// Query params
	for k, prop := range ep.QueryParams {
		fields = append(fields, targetField{
			Location: "query",
			Path:     []string{k},
			Schema:   prop,
		})
	}

	// Header params
	for k, prop := range ep.HeaderParams {
		fields = append(fields, targetField{
			Location: "header",
			Path:     []string{k},
			Schema:   prop,
		})
	}

	// Path params
	for k, prop := range ep.PathParams {
		fields = append(fields, targetField{
			Location: "path",
			Path:     []string{k},
			Schema:   prop,
		})
	}

	return fields
}

// clonePayload deep-clones generatedPayload.
func clonePayload(p generatedPayload) generatedPayload {
	out := generatedPayload{}
	if p.body != nil {
		out.body = cloneMap(p.body)
	}
	if p.queryParams != nil {
		out.queryParams = cloneMap(p.queryParams)
	}
	if p.headers != nil {
		out.headers = make(map[string]string, len(p.headers))
		for k, v := range p.headers {
			out.headers[k] = v
		}
	}
	if p.pathParams != nil {
		out.pathParams = make(map[string]string, len(p.pathParams))
		for k, v := range p.pathParams {
			out.pathParams[k] = v
		}
	}
	return out
}

func cloneMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		if subMap, ok := v.(map[string]any); ok {
			out[k] = cloneMap(subMap)
		} else if subSlice, ok := v.([]any); ok {
			out[k] = cloneSlice(subSlice)
		} else {
			out[k] = v
		}
	}
	return out
}

func cloneSlice(s []any) []any {
	out := make([]any, len(s))
	for i, v := range s {
		if subMap, ok := v.(map[string]any); ok {
			out[i] = cloneMap(subMap)
		} else if subSlice, ok := v.([]any); ok {
			out[i] = cloneSlice(subSlice)
		} else {
			out[i] = v
		}
	}
	return out
}

// setNestedValue places value at path inside map m.
func setNestedValue(m map[string]any, path []string, value any) {
	if len(path) == 0 {
		return
	}
	curr := m
	for i := 0; i < len(path)-1; i++ {
		k := path[i]
		next, exists := curr[k]
		if !exists {
			nextMap := make(map[string]any)
			curr[k] = nextMap
			curr = nextMap
		} else if nextMap, ok := next.(map[string]any); ok {
			curr = nextMap
		} else {
			nextMap := make(map[string]any)
			curr[k] = nextMap
			curr = nextMap
		}
	}
	curr[path[len(path)-1]] = value
}

// buildMutatedPayload clones baseline payload and mutates the specified targetField.
func buildMutatedPayload(
	baseline generatedPayload,
	field targetField,
	gen *generator.Generator,
) generatedPayload {
	mutated := clonePayload(baseline)

	if len(field.Path) == 0 && field.Location != "body" {
		return mutated
	}

	var fieldName string
	if len(field.Path) > 0 {
		fieldName = field.Path[len(field.Path)-1]
	}
	fuzzedVal := gen.Generate(fieldName, field.Schema)

	switch field.Location {
	case "body":
		if len(field.Path) == 0 {
			// Body is a primitive/array, replace completely if we can
			if mapVal, ok := fuzzedVal.(map[string]any); ok {
				mutated.body = mapVal
			} else {
				// Fallback: put primitive value in a wrapper or handle as body if supported.
				mutated.body = map[string]any{"value": fuzzedVal}
			}
		} else {
			if mutated.body == nil {
				mutated.body = make(map[string]any)
			}
			setNestedValue(mutated.body, field.Path, fuzzedVal)
		}
	case "query":
		if mutated.queryParams == nil {
			mutated.queryParams = make(map[string]any)
		}
		setNestedValue(mutated.queryParams, field.Path, fuzzedVal)
	case "header":
		if mutated.headers == nil {
			mutated.headers = make(map[string]string)
		}
		mutated.headers[field.Path[0]] = fmt.Sprintf("%v", fuzzedVal)
	case "path":
		if mutated.pathParams == nil {
			mutated.pathParams = make(map[string]string)
		}
		mutated.pathParams[field.Path[0]] = capPathParam(fuzzedVal)
	}

	return mutated
}

// hashPayload hashes fuzzed payload parameters.
func hashPayload(built generatedPayload) uint32 {
	buf := bufPool.Get().(*bytes.Buffer)
	buf.Reset()
	payloadMap := make(map[string]any)
	if built.body != nil {
		payloadMap["body"] = built.body
	}
	if built.queryParams != nil {
		payloadMap["queryParams"] = built.queryParams
	}
	if built.pathParams != nil {
		payloadMap["pathParams"] = built.pathParams
	}
	_ = json.NewEncoder(buf).Encode(payloadMap)
	payloadStr := strings.TrimSuffix(buf.String(), "\n")
	h := payloads.HashStr(payloadStr)
	bufPool.Put(buf)
	return h
}

// runActiveParameterFuzzing coordinates fuzzer execution for an endpoint using the active parameter strategy.
func (r *Runner) runActiveParameterFuzzing(
	ctx context.Context,
	profileIdx int,
	profile swagger.FuzzingProfile,
	epIdx int,
	endpoint swagger.EndpointConfig,
	gen *generator.Generator,
	safeGen *generator.Generator,
	fields []targetField,
) {
	endpoints := r.config.Endpoints
	baseIter := calcEffectiveIterations(profile, r.config.Settings, &endpoint)
	enableDedup := profile == swagger.ProfileRandom
	delay := time.Duration(r.config.Settings.DelayBetweenRequestMs) * time.Millisecond

	baseline := buildSafePayload(endpoint, safeGen)
	totalPlanned := len(fields) * baseIter

	var wg sync.WaitGroup
	seenHashes := make(map[uint32]bool)
	globalIterIdx := 0

	for _, field := range fields {
		for i := range baseIter {
			if r.stopped() {
				break
			}

			isSecHeaderIter := isSecurityHeaderIteration(gen, profile, i)

			built := buildMutatedPayload(baseline, field, selectGen(gen, safeGen, isSecHeaderIter))

			payloadHash := hashPayload(built)
			if enableDedup && seenHashes[payloadHash] {
				r.progress.totalPlanned.Add(-1)
				continue
			}
			if enableDedup {
				seenHashes[payloadHash] = true
			}

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

				if profile == swagger.ProfileRandom && result.Status >= 200 && result.Status < 300 {
					r.recordSizeBaseline(endpoint.Method, endpoint.Path, result.ResponseSize)
					r.recordTimeBaseline(endpoint.Method, endpoint.Path, result.Duration)
				}

				r.statsChan <- statsMsg{
					result:           result,
					currentIteration: it + 1,
					totalIterations:  totalPlanned,
				}
				r.Broadcast(Event{Type: EventResult, Data: result})

				if result.Status >= 200 && result.Status < 300 {
					r.resultsMu.Lock()
					r.allResults = append(r.allResults, result)
					r.resultsMu.Unlock()
				}
			}(globalIterIdx, built.body, built.queryParams, built.headers, built.pathParams)

			globalIterIdx++
			if delay > 0 {
				time.Sleep(delay)
			}
		}
	}

	wg.Wait()

	r.progress.completedEndpoints.Store(int32(len(endpoints) + profileIdx*len(endpoints) + epIdx + 1)) // #nosec G115
	r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})
}
