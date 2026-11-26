// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"regexp"
	"sort"
	"strings"
	"sync"

	"swazz-engine/internal/generator"
	"swazz-engine/internal/swagger"
)

const (
	defaultRequiredPinProbability = 0.85
	maxRequiredJSONInspectBytes   = 16 * 1024
	maxRequiredTextInspectBytes   = 4 * 1024
	behavioralOmitThreshold       = 2
)

var (
	htmlTagStripRe = regexp.MustCompile(`<[^>]+>`)
	// Pattern A: "Missing parameter 'csrf'", "Required field: username", "empty param token"
	missingPrefixRe = regexp.MustCompile(`(?i)\b(?:missing|required|empty|blank|absent|null)\s+(?:required\s+)?(?:parameter|param|field|key|property|argument|input|value|token)?\s*[:=]?\s*['"\x60]?([a-zA-Z0-9_.\-]{1,64})['"\x60]?`)
	// Pattern B: "'csrf' is required", "username cannot be empty", "password is missing"
	missingSuffixRe = regexp.MustCompile(`(?i)['"\x60]?([a-zA-Z0-9_.\-]{1,64})['"\x60]?\s+(?:is\s+required|is\s+missing|cannot\s+be\s+(?:empty|null|blank)|must\s+not\s+be\s+(?:empty|null|blank)|must\s+be\s+provided|is\s+mandatory|field\s+is\s+required)`)
)

// RequiredParamTracker learns which parameters a target endpoint rejects as
// missing/required at runtime and ensures subsequent fuzzing iterations keep
// those keys populated with valid baseline values (while still allowing
// occasional value-level mutation so vulnerabilities inside required fields
// are not missed).
type RequiredParamTracker struct {
	endpoints sync.Map // baselineKey -> *endpointRequiredState
}

type endpointRequiredState struct {
	mu            sync.Mutex
	bodyRequired  map[string]bool
	queryRequired map[string]bool
	bodyDefaults  map[string]any
	queryDefaults map[string]any
	omitFailures  map[string]int  // "body:<name>" or "query:<name>" -> consecutive/total 400/422 count when sole omitted field
	presentNon400 map[string]bool // "body:<name>" or "query:<name>" -> seen non-400/422 when present
}

func newRequiredParamTracker() *RequiredParamTracker {
	return &RequiredParamTracker{}
}

func (t *RequiredParamTracker) getOrCreate(method, path string) *endpointRequiredState {
	key := baselineKey(method, path)
	if val, ok := t.endpoints.Load(key); ok {
		return val.(*endpointRequiredState)
	}
	st := &endpointRequiredState{
		bodyRequired:  make(map[string]bool),
		queryRequired: make(map[string]bool),
		bodyDefaults:  make(map[string]any),
		queryDefaults: make(map[string]any),
		omitFailures:  make(map[string]int),
		presentNon400: make(map[string]bool),
	}
	actual, _ := t.endpoints.LoadOrStore(key, st)
	return actual.(*endpointRequiredState)
}

func (t *RequiredParamTracker) getIfPresent(method, path string) *endpointRequiredState {
	if t == nil {
		return nil
	}
	val, ok := t.endpoints.Load(baselineKey(method, path))
	if !ok {
		return nil
	}
	return val.(*endpointRequiredState)
}

// bodyAndQueryProps mirrors payload_builder.go's split between body and query
// properties so GET/HEAD/OPTIONS endpoints track Schema.Properties as query params.
func bodyAndQueryProps(ep swagger.EndpointConfig) (bodyProps, queryProps map[string]*swagger.SchemaProperty) {
	if !isNoBodyMethod(ep.Method) {
		return ep.Schema.Properties, ep.QueryParams
	}
	return nil, mergeProps(ep.Schema.Properties, ep.QueryParams)
}

func isValuePresent(m map[string]any, key string) bool {
	if m == nil {
		return false
	}
	v, ok := m[key]
	if !ok || v == nil {
		return false
	}
	if s, ok := v.(string); ok && s == "" {
		return false
	}
	return true
}

func containsCSRFHint(body string) bool {
	lower := strings.ToLower(body)
	return strings.Contains(lower, "csrf") || strings.Contains(lower, "xsrf")
}

// ObserveResponse inspects a response and learns any omitted schema parameters
// that the server reported as missing/required. Returns the newly learned field
// names (empty if none were newly learned).
func (t *RequiredParamTracker) ObserveResponse(
	ep swagger.EndpointConfig,
	sentBody map[string]any,
	sentQuery map[string]any,
	status int,
	responseBody string,
) []string {
	if t == nil || status <= 0 {
		return nil
	}
	bodyProps, queryProps := bodyAndQueryProps(ep)
	if len(bodyProps) == 0 && len(queryProps) == 0 {
		return nil
	}

	st := t.getOrCreate(ep.Method, ep.Path)
	st.mu.Lock()
	defer st.mu.Unlock()

	isValidationError := status == 400 || status == 422 || (status == 403 && containsCSRFHint(responseBody))
	if !isValidationError {
		// Record which fields were present on non-validation-error responses for Tier 3 confirmation,
		// and cache observed valid values as fallback defaults if not already cached.
		for k := range bodyProps {
			if isValuePresent(sentBody, k) {
				st.presentNon400["body:"+k] = true
				if _, exists := st.bodyDefaults[k]; !exists {
					st.bodyDefaults[k] = sentBody[k]
				}
			}
		}
		for k := range queryProps {
			if isValuePresent(sentQuery, k) {
				st.presentNon400["query:"+k] = true
				if _, exists := st.queryDefaults[k]; !exists {
					st.queryDefaults[k] = sentQuery[k]
				}
			}
		}
		return nil
	}

	omittedBodyLower := make(map[string]string)
	omittedQueryLower := make(map[string]string)
	var omittedList []string // "body:<k>" or "query:<k>"

	for k := range bodyProps {
		if !isValuePresent(sentBody, k) {
			omittedBodyLower[strings.ToLower(k)] = k
			omittedList = append(omittedList, "body:"+k)
		}
	}
	for k := range queryProps {
		if !isValuePresent(sentQuery, k) {
			omittedQueryLower[strings.ToLower(k)] = k
			omittedList = append(omittedList, "query:"+k)
		}
	}

	if len(omittedList) == 0 {
		return nil
	}

	candidates := extractMissingFieldCandidates(responseBody)
	var newlyLearned []string

	markLearned := func(loc, canonical string) {
		if loc == "body" {
			if !st.bodyRequired[canonical] {
				st.bodyRequired[canonical] = true
				newlyLearned = append(newlyLearned, canonical)
			}
		} else {
			if !st.queryRequired[canonical] {
				st.queryRequired[canonical] = true
				newlyLearned = append(newlyLearned, canonical)
			}
		}
	}

	for _, cand := range candidates {
		lc := strings.ToLower(strings.TrimSpace(cand))
		if lc == "" {
			continue
		}
		if canonical, ok := omittedBodyLower[lc]; ok {
			markLearned("body", canonical)
		}
		if canonical, ok := omittedQueryLower[lc]; ok {
			markLearned("query", canonical)
		}
	}

	// Tier 3 behavioral fallback: if the server returned a generic 400/422 without
	// naming a field, and exactly one schema field was omitted while requests with
	// that field previously succeeded (non-400/422), learn it after threshold hits.
	if len(newlyLearned) == 0 && len(omittedList) == 1 {
		sole := omittedList[0]
		st.omitFailures[sole]++
		if st.omitFailures[sole] >= behavioralOmitThreshold && st.presentNon400[sole] {
			loc, canonical, ok := strings.Cut(sole, ":")
			if ok {
				markLearned(loc, canonical)
			}
		}
	}

	sort.Strings(newlyLearned)
	return newlyLearned
}

// EnforceRequired ensures all learned-required fields are present on built,
// and with probability pinProbability pins them to valid baseline values when
// the endpoint has multiple fields so payloads in other fields pass validation.
func (t *RequiredParamTracker) EnforceRequired(
	ep swagger.EndpointConfig,
	built *generatedPayload,
	dictionaries map[string][]any,
	safeGen *generator.Generator,
	pinProbability float64,
) {
	if t == nil || built == nil {
		return
	}
	st := t.getIfPresent(ep.Method, ep.Path)
	if st == nil {
		return
	}

	bodyProps, queryProps := bodyAndQueryProps(ep)

	st.mu.Lock()
	if len(st.bodyRequired) == 0 && len(st.queryRequired) == 0 {
		st.mu.Unlock()
		return
	}
	reqBodyKeys := make([]string, 0, len(st.bodyRequired))
	for k := range st.bodyRequired {
		reqBodyKeys = append(reqBodyKeys, k)
	}
	reqQueryKeys := make([]string, 0, len(st.queryRequired))
	for k := range st.queryRequired {
		reqQueryKeys = append(reqQueryKeys, k)
	}
	st.mu.Unlock()

	for _, k := range reqBodyKeys {
		prop, exists := bodyProps[k]
		if !exists {
			continue
		}
		if built.body == nil {
			built.body = make(map[string]any)
		}
		val, present := built.body[k]
		shouldPin := !present || val == nil ||
			(len(bodyProps) > 1 && pinProbability > 0 && rand.Float64() < pinProbability) // #nosec G404 -- non-security randomness for fuzzer
		if shouldPin {
			built.body[k] = t.resolveDefaultValue(st, "body", k, prop, ep.Example, dictionaries, safeGen)
		}
	}

	for _, k := range reqQueryKeys {
		prop, exists := queryProps[k]
		if !exists {
			continue
		}
		if built.queryParams == nil {
			built.queryParams = make(map[string]any)
		}
		val, present := built.queryParams[k]
		shouldPin := !present || val == nil ||
			(len(queryProps) > 1 && pinProbability > 0 && rand.Float64() < pinProbability) // #nosec G404 -- non-security randomness for fuzzer
		if shouldPin {
			built.queryParams[k] = t.resolveDefaultValue(st, "query", k, prop, ep.Example, dictionaries, safeGen)
		}
	}
}

func (t *RequiredParamTracker) resolveDefaultValue(
	st *endpointRequiredState,
	loc string,
	key string,
	prop *swagger.SchemaProperty,
	example any,
	dictionaries map[string][]any,
	safeGen *generator.Generator,
) any {
	// 1. Pre-captured / OpenAPI example value
	if exMap, ok := example.(map[string]any); ok {
		if v, exists := exMap[key]; exists && v != nil {
			if s, ok := v.(string); !ok || s != "" {
				return v
			}
		}
	}

	// 2. User-configured dictionary for this parameter name
	if dictionaries != nil {
		if dictVals := dictionaries[key]; len(dictVals) > 0 && dictVals[0] != nil {
			if s, ok := dictVals[0].(string); !ok || s != "" {
				return dictVals[0]
			}
		}
	}

	// 3. Cached valid baseline value observed during this run
	st.mu.Lock()
	var cached any
	var hasCached bool
	if loc == "body" {
		cached, hasCached = st.bodyDefaults[key]
	} else {
		cached, hasCached = st.queryDefaults[key]
	}
	st.mu.Unlock()
	if hasCached && cached != nil {
		return cached
	}

	// 4. Deterministic safe schema-conformant default
	if prop == nil {
		prop = &swagger.SchemaProperty{Type: "string"}
	}
	var generated any = "test"
	if safeGen != nil {
		generated = safeGen.Generate(key, prop)
	}
	st.mu.Lock()
	if loc == "body" {
		if _, exists := st.bodyDefaults[key]; !exists {
			st.bodyDefaults[key] = generated
		}
	} else {
		if _, exists := st.queryDefaults[key]; !exists {
			st.queryDefaults[key] = generated
		}
	}
	st.mu.Unlock()
	return generated
}

func extractMissingFieldCandidates(responseBody string) []string {
	if responseBody == "" {
		return nil
	}
	var out []string
	trimmed := strings.TrimSpace(responseBody)
	if len(trimmed) > maxRequiredJSONInspectBytes {
		trimmed = trimmed[:maxRequiredJSONInspectBytes]
	}

	// Tier 1: Structured JSON validation responses (FastAPI/Pydantic, Zod, Joi, DRF, Laravel, Spring)
	if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") {
		var parsed any
		if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
			collectJSONMissingFields(parsed, &out)
		}
	}

	// Tier 2: Plain-text / HTML-stripped error patterns
	textSample := responseBody
	if len(textSample) > maxRequiredTextInspectBytes {
		textSample = textSample[:maxRequiredTextInspectBytes]
	}
	if strings.Contains(textSample, "<") {
		textSample = htmlTagStripRe.ReplaceAllString(textSample, " ")
	}
	for _, m := range missingPrefixRe.FindAllStringSubmatch(textSample, -1) {
		if len(m) >= 2 && m[1] != "" {
			out = append(out, m[1])
		}
	}
	for _, m := range missingSuffixRe.FindAllStringSubmatch(textSample, -1) {
		if len(m) >= 2 && m[1] != "" {
			out = append(out, m[1])
		}
	}
	return out
}

func messageLooksRequiredOrMissing(msg string) bool {
	if msg == "" {
		return false
	}
	l := strings.ToLower(msg)
	return strings.Contains(l, "required") ||
		strings.Contains(l, "missing") ||
		strings.Contains(l, "blank") ||
		strings.Contains(l, "empty") ||
		strings.Contains(l, "must not be null") ||
		strings.Contains(l, "cannot be null") ||
		strings.Contains(l, "mandatory")
}

func collectJSONMissingFields(node any, out *[]string) {
	switch v := node.(type) {
	case []any:
		for _, item := range v {
			collectJSONMissingFields(item, out)
		}
	case map[string]any:
		// FastAPI / Pydantic: {"loc": ["body", "csrf"], "msg": "Field required", "type": "missing"}
		// Zod: {"path": ["csrf"], "message": "Required"}
		// Spring / Express-validator: {"field": "csrf", "defaultMessage": "must not be blank"} / {"param": "csrf", "msg": "..."}
		msg := fmt.Sprintf("%v %v %v %v", v["type"], v["msg"], v["message"], v["defaultMessage"])
		if messageLooksRequiredOrMissing(msg) {
			if loc, ok := v["loc"].([]any); ok && len(loc) > 0 {
				if s, ok := loc[len(loc)-1].(string); ok && s != "" {
					*out = append(*out, s)
				}
			}
			if path, ok := v["path"].([]any); ok && len(path) > 0 {
				if s, ok := path[len(path)-1].(string); ok && s != "" {
					*out = append(*out, s)
				}
			} else if pathStr, ok := v["path"].(string); ok && pathStr != "" {
				*out = append(*out, pathStr)
			}
			for _, keyName := range []string{"field", "param", "parameter", "name"} {
				if s, ok := v[keyName].(string); ok && s != "" {
					*out = append(*out, s)
				}
			}
		}

		// DRF / Laravel / Rails: {"errors": {"csrf": ["This field is required."]}} or {"csrf": ["can't be blank"]}
		for k, val := range v {
			switch tv := val.(type) {
			case []any:
				for _, elem := range tv {
					if s, ok := elem.(string); ok && messageLooksRequiredOrMissing(s) {
						*out = append(*out, k)
					} else {
						collectJSONMissingFields(elem, out)
					}
				}
			case string:
				if messageLooksRequiredOrMissing(tv) && k != "error" && k != "message" && k != "msg" && k != "detail" {
					*out = append(*out, k)
				}
			case map[string]any:
				collectJSONMissingFields(tv, out)
			}
		}
	}
}

func responseBodyToString(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	if b, ok := v.([]byte); ok {
		return string(b)
	}
	return fmt.Sprintf("%v", v)
}

func (r *Runner) observeRequiredParams(ep swagger.EndpointConfig, sentBody, sentQuery map[string]any, status int, responseBody any) {
	if r == nil || r.requiredParams == nil {
		return
	}
	learned := r.requiredParams.ObserveResponse(ep, sentBody, sentQuery, status, responseBodyToString(responseBody))
	if len(learned) > 0 {
		r.logInfo("[Adaptive] Learned required parameter(s) [%s] on %s %s (HTTP %d) — pinning baseline value",
			strings.Join(learned, ", "), ep.Method, ep.Path, status)
	}
}

func (r *Runner) enforceRequiredParams(ep swagger.EndpointConfig, built *generatedPayload, safeGen *generator.Generator, pinProbability float64) {
	if r == nil || r.requiredParams == nil || r.config == nil {
		return
	}
	r.requiredParams.EnforceRequired(ep, built, r.config.Dictionaries, safeGen, pinProbability)
}
