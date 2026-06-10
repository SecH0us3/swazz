// payload_builder.go: Encapsulates all payload and header construction logic
// for both the baseline phase and the main fuzzing iteration loop.
//
// Both phases previously duplicated the same if-isBodyMethod / combinedProps
// pattern. This file gives that logic a single home and a clear vocabulary:
//
//   - buildSafePayload — deterministic "valid" payload used for baselines,
//     rate-limit probes, and the body during security-header iterations.
//   - buildFuzzPayload — returns a fuzzed payload attempt; callers are
//     responsible for the dedup retry loop.
//   - buildHeaders — constructs the generated-header map from an endpoint's
//     HeaderParams schema.

package runner

import (
	"fmt"
	"math/rand/v2"

	"swazz-engine/internal/generator"
	"swazz-engine/internal/swagger"
)

// generatedPayload is the result of a single payload-building attempt.
type generatedPayload struct {
	body        map[string]any
	queryParams map[string]any
	headers     map[string]string
}

// buildSafePayload constructs a deterministic, valid payload for the given
// endpoint using the supplied safe generator. It is used for baseline requests,
// rate-limit probes, and security-header iterations where the body must be
// structurally valid to isolate header-level behaviour.
func buildSafePayload(ep swagger.EndpointConfig, safeGen *generator.Generator) generatedPayload {
	if ep.Example != nil {
		return buildFromExample(ep, safeGen)
	}
	if !hasFields(&ep) {
		return generatedPayload{}
	}
	return buildFromSchema(ep, safeGen)
}

// buildFuzzPayload constructs a single fuzz-payload attempt using the fuzz
// generator for body/query and (optionally) the safe generator for headers
// during security-header iterations. The caller owns the dedup retry loop.
func buildFuzzPayload(
	ep swagger.EndpointConfig,
	gen *generator.Generator,
	safeGen *generator.Generator,
	isSecHeaderIter bool,
	isRandom bool,
) generatedPayload {
	if !hasFields(&ep) {
		return generatedPayload{headers: buildHeaders(ep, selectGen(gen, safeGen, isSecHeaderIter))}
	}

	isBody := !isNoBodyMethod(ep.Method)
	out := generatedPayload{}

	bodyGen := selectGen(gen, safeGen, isSecHeaderIter)

	if isBody {
		if len(ep.Schema.Properties) > 0 || ep.Schema.Type == "array" || ep.Schema.Type == "object" {
			if isRandom && rand.Float64() < 0.15 {
				out.body = map[string]any{}
			} else {
				out.body = bodyGen.BuildObject(&ep.Schema)
			}
		}
		if len(ep.QueryParams) > 0 {
			qpSchema := objectSchema(ep.QueryParams)
			out.queryParams = bodyGen.BuildObject(qpSchema)
		}
	} else {
		// GET / HEAD / OPTIONS: combine schema + query props into query string.
		combined := mergeProps(ep.Schema.Properties, ep.QueryParams)
		if len(combined) > 0 {
			out.queryParams = bodyGen.BuildObject(objectSchema(combined))
		}
	}

	out.headers = buildHeaders(ep, selectGen(gen, safeGen, isSecHeaderIter))
	return out
}

// buildHeaders generates a string map from an endpoint's HeaderParams schema.
// Returns nil (not an empty map) when there are no header params, so callers
// can skip the injection step entirely.
func buildHeaders(ep swagger.EndpointConfig, gen *generator.Generator) map[string]string {
	if len(ep.HeaderParams) == 0 {
		return nil
	}
	headerObj := gen.BuildObject(objectSchema(ep.HeaderParams))
	out := make(map[string]string, len(headerObj))
	for k, v := range headerObj {
		out[k] = fmt.Sprintf("%v", v)
	}
	return out
}

// ─── private helpers ────────────────────────────────────────────────────────

// selectGen returns gen when it should produce fuzz payloads and safeGen when
// we are in a security-header iteration (body must stay valid).
func selectGen(gen, safeGen *generator.Generator, isSecHeaderIter bool) *generator.Generator {
	if isSecHeaderIter {
		return safeGen
	}
	return gen
}

// buildFromExample constructs a payload from an endpoint's pre-defined Example
// value. Header params are still generated from schema.
func buildFromExample(ep swagger.EndpointConfig, safeGen *generator.Generator) generatedPayload {
	out := generatedPayload{}
	isBody := !isNoBodyMethod(ep.Method)
	if isBody {
		out.body, _ = ep.Example.(map[string]any)
	} else {
		out.queryParams, _ = ep.Example.(map[string]any)
	}
	out.headers = buildHeaders(ep, safeGen)
	return out
}

// buildFromSchema constructs a safe payload from the endpoint's schema
// definitions. Used for baseline requests when no Example is provided.
func buildFromSchema(ep swagger.EndpointConfig, safeGen *generator.Generator) generatedPayload {
	out := generatedPayload{}
	isBody := !isNoBodyMethod(ep.Method)

	if isBody {
		if len(ep.Schema.Properties) > 0 || ep.Schema.Type == "array" || ep.Schema.Type == "object" {
			out.body = safeGen.BuildObject(&ep.Schema)
		}
		if len(ep.QueryParams) > 0 {
			out.queryParams = safeGen.BuildObject(objectSchema(ep.QueryParams))
		}
	} else {
		combined := mergeProps(ep.Schema.Properties, ep.QueryParams)
		if len(combined) > 0 {
			out.queryParams = safeGen.BuildObject(objectSchema(combined))
		}
	}
	out.headers = buildHeaders(ep, safeGen)
	return out
}

// objectSchema wraps a property map into a minimal SchemaProperty of type
// "object", which is what generator.BuildObject expects.
func objectSchema(props map[string]*swagger.SchemaProperty) *swagger.SchemaProperty {
	return &swagger.SchemaProperty{
		Type:       "object",
		Properties: props,
	}
}

// mergeProps returns a new map that is the union of a and b.
// Keys in b overwrite keys in a.
func mergeProps(a, b map[string]*swagger.SchemaProperty) map[string]*swagger.SchemaProperty {
	if len(a) == 0 && len(b) == 0 {
		return nil
	}
	out := make(map[string]*swagger.SchemaProperty, len(a)+len(b))
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		out[k] = v
	}
	return out
}
