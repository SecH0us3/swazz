// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package generator

import (
	"fmt"
	"math/rand/v2"
	"strings"
	"sync"

	"github.com/google/uuid"

	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/oob"
	"swazz-engine/internal/swagger"
)

// Generator produces fuzz payloads based on JSON Schema and a fuzzing profile.
type Generator struct {
	dictionaries map[string][]any
	profile      swagger.FuzzingProfile
	// activeCategories stores set of enabled category IDs for the current profile.
	// If nil, all categories are enabled.
	activeCategories map[string]bool

	// Sequential counters: BOUNDARY
	bStrIdx, bIntIdx, bNumIdx, bDateIdx, bArrIdx, bBoolIdx, bUUIDIdx int

	// Sequential counters: MALICIOUS
	mStrIdx, mNumIdx, mDateIdx, mBoolIdx, mTypeIdx, mUUIDIdx, oobIdx int

	// Sequential counter: security header rotation
	mu             sync.Mutex
	mSecHeaderIdxs map[string]int

	// cachedMaliciousStrings avoids allocations under high concurrency
	cachedMaliciousStrings []any
	// hasActiveMaliciousStrings tracks if any malicious string categories are enabled
	hasActiveMaliciousStrings bool

	oobServerURL string
	Endpoint     string
	RunID        string
	settings     swagger.Settings
}

// New creates a new Generator.
func New(dictionaries map[string][]any, profile swagger.FuzzingProfile, settings swagger.Settings) *Generator {
	norm := make(map[string][]any, len(dictionaries))
	for k, v := range dictionaries {
		norm[strings.ToLower(k)] = v
	}

	var active map[string]bool
	if settings.PayloadCategories != nil {
		if ids, ok := settings.PayloadCategories[profile]; ok && len(ids) > 0 {
			active = make(map[string]bool, len(ids))
			for _, id := range ids {
				active[id] = true
			}
		}
	}

	g := &Generator{
		dictionaries:     norm,
		profile:          profile,
		activeCategories: active,
		settings:         settings,
		oobServerURL:     settings.OOBServerURL,
		mSecHeaderIdxs:   make(map[string]int),
	}
	g.cachedMaliciousStrings, g.hasActiveMaliciousStrings = g.getActiveMaliciousStrings()
	return g
}

func (g *Generator) isCategoryEnabled(id string) bool {
	if g.activeCategories == nil {
		return true
	}
	return g.activeCategories[id]
}

func seqPick[T any](mu sync.Locker, arr []T, counter *int) T {
	mu.Lock()
	defer mu.Unlock()
	if len(arr) == 0 {
		var zero T
		return zero
	}
	val := arr[*counter%len(arr)]
	*counter++
	return val
}

func maxInt(nums ...int) int {
	m := 0
	for _, n := range nums {
		if n > m {
			m = n
		}
	}
	return m
}

// MinIterationsNeeded returns the minimum iterations required to cover all active payloads in a profile.
func MinIterationsNeeded(profile swagger.FuzzingProfile, settings swagger.Settings) int {
	var active map[string]bool
	if settings.PayloadCategories != nil {
		if ids, ok := settings.PayloadCategories[profile]; ok && len(ids) > 0 {
			active = make(map[string]bool, len(ids))
			for _, id := range ids {
				active[id] = true
			}
		}
	}

	is := func(id string) bool {
		if active == nil {
			return true
		}
		return active[id]
	}

	switch profile {
	case swagger.ProfileBoundary:
		max := 0
		if is(payloads.CatBoundaryStrings) && len(payloads.BoundaryStrings) > max {
			max = len(payloads.BoundaryStrings)
		}
		if is(payloads.CatBoundaryIntegers) && len(payloads.BoundaryIntegers) > max {
			max = len(payloads.BoundaryIntegers)
		}
		if is(payloads.CatBoundaryNumbers) && len(payloads.BoundaryNumbers) > max {
			max = len(payloads.BoundaryNumbers)
		}
		if is(payloads.CatBoundaryDates) && len(payloads.BoundaryDates) > max {
			max = len(payloads.BoundaryDates)
		}
		if is(payloads.CatBoundaryBooleans) && len(payloads.BoundaryBooleans) > max {
			max = len(payloads.BoundaryBooleans)
		}
		if is(payloads.CatBoundaryArrays) && len(payloads.BoundaryArraySizes) > max {
			max = len(payloads.BoundaryArraySizes)
		}
		if is(payloads.CatBoundaryUUIDs) && len(payloads.BoundaryUUIDs) > max {
			max = len(payloads.BoundaryUUIDs)
		}
		return max

	case swagger.ProfileMalicious:
		bodyCount := 0
		var maliciousBody []any
		if is(payloads.CatMaliciousEncoding) {
			maliciousBody = append(maliciousBody, payloads.MaliciousEncoding...)
		}
		if is(payloads.CatMaliciousSQLi) {
			maliciousBody = append(maliciousBody, payloads.MaliciousSQLi...)
		}
		if is(payloads.CatMaliciousXSS) {
			maliciousBody = append(maliciousBody, payloads.MaliciousXSS...)
		}
		if is(payloads.CatMaliciousPathTraversal) {
			maliciousBody = append(maliciousBody, payloads.MaliciousPathTraversal...)
		}
		if is(payloads.CatOOBInteraction) {
			maliciousBody = append(maliciousBody, payloads.MaliciousOOB...)
		}
		if is(payloads.CatMaliciousCmdi) {
			maliciousBody = append(maliciousBody, payloads.MaliciousCmdi...)
		}
		if is(payloads.CatMaliciousSSTI) {
			maliciousBody = append(maliciousBody, payloads.MaliciousSSTI...)
		}
		if is(payloads.CatMaliciousXXE) {
			maliciousBody = append(maliciousBody, payloads.MaliciousXXE...)
		}
		bodyCount = len(maliciousBody)
		if is(payloads.CatMaliciousNumbers) && len(payloads.MaliciousNumbers) > bodyCount {
			bodyCount = len(payloads.MaliciousNumbers)
		}
		if is(payloads.CatMaliciousDates) && len(payloads.MaliciousDates) > bodyCount {
			bodyCount = len(payloads.MaliciousDates)
		}
		if is(payloads.CatMaliciousBooleans) && len(payloads.MaliciousBooleans) > bodyCount {
			bodyCount = len(payloads.MaliciousBooleans)
		}
		if is(payloads.CatMaliciousTypeConfusion) && len(payloads.MaliciousTypeConfusion) > bodyCount {
			bodyCount = len(payloads.MaliciousTypeConfusion)
		}

		secHeaderCount := 0
		for _, def := range payloads.SecurityHeaderPayloads {
			if !is(def.Category) {
				continue
			}
			for _, values := range def.Headers {
				if len(values) > secHeaderCount {
					secHeaderCount = len(values)
				}
			}
		}

		return bodyCount + secHeaderCount
	default:
		return 0
	}
}

// Generate produces a value for a single property.
// Priority: enum → dictionary → format-aware → profile-based.
func (g *Generator) Generate(propertyName string, schema *swagger.SchemaProperty) any {
	if schema == nil {
		return nil
	}

	// 1. Enum — respect explicit values, allow bypass in security profiles
	if len(schema.Enum) > 0 {
		shouldBypass := (g.profile == swagger.ProfileMalicious) && rand.Float64() < 0.3 // #nosec G404 -- non-security randomness for fuzzer
		if !shouldBypass {
			return payloads.Pick(schema.Enum)
		}
	}

	// 2. User dictionary
	normalizedName := strings.ToLower(propertyName)
	if vals, ok := g.dictionaries[normalizedName]; ok && len(vals) > 0 {
		return payloads.Pick(vals)
	}

	// 3. Profile-based generation
	return g.generateByProfile(schema.Type, schema.Format, propertyName)
}

// BuildObject recursively builds a full object from JSON Schema.
func (g *Generator) BuildObject(schema *swagger.SchemaProperty) map[string]any {
	return g.buildObjectWithDepth(schema, 0)
}

func (g *Generator) buildObjectWithDepth(schema *swagger.SchemaProperty, depth int) map[string]any {
	if schema == nil || schema.Type != "object" || schema.Properties == nil || depth > 6 {
		return map[string]any{}
	}

	if g.profile == swagger.ProfileRandom && rand.Float64() < 0.1 { // #nosec G404
		return map[string]any{}
	}

	payload := make(map[string]any, len(schema.Properties))

	for key, propSchema := range schema.Properties {
		if propSchema == nil {
			continue
		}
		isRequired := false
		for _, r := range schema.Required {
			if r == key {
				isRequired = true
				break
			}
		}

		// 30% chance to omit optional fields in MALICIOUS profile
		if !isRequired &&
			(g.profile == swagger.ProfileMalicious) &&
			rand.Float64() < 0.3 { // #nosec G404 -- non-security randomness for fuzzer
			continue
		}

		// 5% chance to omit REQUIRED fields in MALICIOUS profile
		if isRequired && g.profile == swagger.ProfileMalicious && rand.Float64() < 0.05 { // #nosec G404 -- non-security randomness for fuzzer
			continue
		}

		if propSchema.Type == "object" && propSchema.Properties != nil {
			if depth < 6 {
				payload[key] = g.buildObjectWithDepth(propSchema, depth+1)
			} else {
				payload[key] = map[string]any{}
			}
		} else if propSchema.Type == "array" && propSchema.Items != nil {
			count := g.getArraySize(propSchema.Items)
			arr := make([]any, count)
			for i := range arr {
				if propSchema.Items.Type == "object" {
					if depth < 6 {
						arr[i] = g.buildObjectWithDepth(propSchema.Items, depth+1)
					} else {
						arr[i] = map[string]any{}
					}
				} else {
					arr[i] = g.GenerateArrayItem(key, propSchema.Items)
				}
			}
			payload[key] = arr
		} else {
			payload[key] = g.Generate(key, propSchema)
		}
	}

	return payload
}

// GenerateArrayItem produces a value for an array item, with safety caps to prevent OOM when multiplying large boundary strings across array lengths.
func (g *Generator) GenerateArrayItem(propertyName string, schema *swagger.SchemaProperty) any {
	if schema == nil {
		return nil
	}
	if schema.Type == "string" {
		formatLower := strings.ToLower(schema.Format)
		if formatLower == "date-time" {
			return g.generateDate()
		}
		if formatLower == "uuid" {
			return g.generateUUID()
		}
		return g.generateStringArrayItem(formatLower, propertyName)
	}
	return g.Generate(propertyName, schema)
}

// GenerateSecurityHeaders returns a map of header name → fuzz value for
// security-critical HTTP headers not defined in the API spec.
// Only active during MALICIOUS profile. Returns nil for other profiles.
func (g *Generator) GenerateSecurityHeaders() map[string]string {
	if g.profile != swagger.ProfileMalicious {
		return nil
	}

	g.mu.Lock()
	defer g.mu.Unlock()

	if g.mSecHeaderIdxs == nil {
		g.mSecHeaderIdxs = make(map[string]int)
	}

	headers := make(map[string]string)
	for _, def := range payloads.SecurityHeaderPayloads {
		if !g.isCategoryEnabled(def.Category) {
			continue
		}
		for headerName, values := range def.Headers {
			if len(values) == 0 {
				continue
			}
			idx := g.mSecHeaderIdxs[headerName]
			val := values[idx%len(values)]

			if strings.Contains(val, "{{OOB_URL}}") {
				u := uuid.New().String()
				url := g.oobURL(u)

				endpoint := "Header: " + headerName
				if g.Endpoint != "" {
					endpoint = fmt.Sprintf("%s (Header: %s)", g.Endpoint, headerName)
				}
				oob.GlobalStore.RegisterUUID(u, &oob.OOBContext{
					SessionID: g.RunID,
					Endpoint:  endpoint,
					Payload:   val,
				})
				val = strings.ReplaceAll(val, "{{OOB_URL}}", url)
			}

			headers[headerName] = val
			g.mSecHeaderIdxs[headerName] = idx + 1
		}
	}

	if len(headers) == 0 {
		return nil
	}
	return headers
}

// BodyIterations returns the number of iterations needed for body fuzzing.
func (g *Generator) BodyIterations() int {
	if g.profile != swagger.ProfileMalicious {
		return 0
	}
	is := g.isCategoryEnabled
	bodyCount := 0
	var maliciousBody []any
	if is(payloads.CatMaliciousEncoding) {
		maliciousBody = append(maliciousBody, payloads.MaliciousEncoding...)
	}
	if is(payloads.CatMaliciousSQLi) {
		maliciousBody = append(maliciousBody, payloads.MaliciousSQLi...)
	}
	if is(payloads.CatMaliciousXSS) {
		maliciousBody = append(maliciousBody, payloads.MaliciousXSS...)
	}
	if is(payloads.CatMaliciousPathTraversal) {
		maliciousBody = append(maliciousBody, payloads.MaliciousPathTraversal...)
	}
	if is(payloads.CatMaliciousCmdi) {
		maliciousBody = append(maliciousBody, payloads.MaliciousCmdi...)
	}
	if is(payloads.CatMaliciousSSTI) {
		maliciousBody = append(maliciousBody, payloads.MaliciousSSTI...)
	}
	if is(payloads.CatMaliciousXXE) {
		maliciousBody = append(maliciousBody, payloads.MaliciousXXE...)
	}
	if is(payloads.CatMaliciousPrototypePollution) {
		maliciousBody = append(maliciousBody, payloads.MaliciousPrototypePollution...)
	}
	if is(payloads.CatMaliciousNoSQLi) {
		maliciousBody = append(maliciousBody, payloads.MaliciousNoSQLi...)
	}
	if is(payloads.CatMaliciousSSRF) {
		maliciousBody = append(maliciousBody, payloads.MaliciousSSRF...)
	}
	if is(payloads.CatMaliciousMassAssignment) {
		maliciousBody = append(maliciousBody, payloads.MaliciousMassAssignment...)
	}
	if is(payloads.CatMaliciousGraphQL) {
		maliciousBody = append(maliciousBody, payloads.MaliciousGraphQL...)
	}
	if is(payloads.CatOOBInteraction) {
		maliciousBody = append(maliciousBody, payloads.MaliciousOOB...)
	}
	bodyCount = len(maliciousBody)
	if is(payloads.CatMaliciousNumbers) && len(payloads.MaliciousNumbers) > bodyCount {
		bodyCount = len(payloads.MaliciousNumbers)
	}
	if is(payloads.CatMaliciousDates) && len(payloads.MaliciousDates) > bodyCount {
		bodyCount = len(payloads.MaliciousDates)
	}
	if is(payloads.CatMaliciousBooleans) && len(payloads.MaliciousBooleans) > bodyCount {
		bodyCount = len(payloads.MaliciousBooleans)
	}
	if is(payloads.CatMaliciousTypeConfusion) && len(payloads.MaliciousTypeConfusion) > bodyCount {
		bodyCount = len(payloads.MaliciousTypeConfusion)
	}
	return bodyCount
}

// SecurityHeaderIterations returns the number of iterations needed for security header fuzzing.
func (g *Generator) SecurityHeaderIterations() int {
	if g.profile != swagger.ProfileMalicious {
		return 0
	}
	secHeaderCount := 0
	is := g.isCategoryEnabled
	for _, def := range payloads.SecurityHeaderPayloads {
		if !is(def.Category) {
			continue
		}
		for _, values := range def.Headers {
			if len(values) > secHeaderCount {
				secHeaderCount = len(values)
			}
		}
	}
	return secHeaderCount
}
