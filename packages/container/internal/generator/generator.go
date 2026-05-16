package generator

import (
	"math/rand/v2"
	"strings"

	"swazz-engine/internal/generator/payloads"
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
	mStrIdx, mNumIdx, mDateIdx, mBoolIdx, mTypeIdx, mUUIDIdx int
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

	return &Generator{
		dictionaries:     norm,
		profile:          profile,
		activeCategories: active,
	}
}

func (g *Generator) isCategoryEnabled(id string) bool {
	if g.activeCategories == nil {
		return true
	}
	return g.activeCategories[id]
}

func (g *Generator) pickFrom(id string, fallback []any) any {
	if !g.isCategoryEnabled(id) {
		// If disabled, return a random "safe" value if possible, or just pick from fallback anyway
		// but ideally we want to skip this iteration or use a default.
		// For now, let's just return nil to signify "skip/default"
		return nil
	}
	return payloads.Pick(fallback)
}

func (g *Generator) seqPickFrom(id string, arr []any, counter *int) any {
	if !g.isCategoryEnabled(id) {
		return nil
	}
	return seqPick(arr, counter)
}

func seqPick[T any](arr []T, counter *int) T {
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
		var all []any
		if is(payloads.CatMaliciousEncoding) {
			all = append(all, payloads.MaliciousEncoding...)
		}
		if is(payloads.CatMaliciousSQLi) {
			all = append(all, payloads.MaliciousSQLi...)
		}
		if is(payloads.CatMaliciousXSS) {
			all = append(all, payloads.MaliciousXSS...)
		}
		if is(payloads.CatMaliciousPathTraversal) {
			all = append(all, payloads.MaliciousPathTraversal...)
		}
		// Plus other categories that are picked randomly but could be sequential if we wanted
		// For now, AllMaliciousStrings is the main driver.
		count := len(all)
		if is(payloads.CatMaliciousNumbers) && len(payloads.MaliciousNumbers) > count {
			count = len(payloads.MaliciousNumbers)
		}
		if is(payloads.CatMaliciousDates) && len(payloads.MaliciousDates) > count {
			count = len(payloads.MaliciousDates)
		}
		if is(payloads.CatMaliciousBooleans) && len(payloads.MaliciousBooleans) > count {
			count = len(payloads.MaliciousBooleans)
		}
		if is(payloads.CatMaliciousTypeConfusion) && len(payloads.MaliciousTypeConfusion) > count {
			count = len(payloads.MaliciousTypeConfusion)
		}
		return count
	default:
		return 0
	}
}

// Generate produces a value for a single property.
// Priority: enum → dictionary → format-aware → profile-based.
func (g *Generator) Generate(propertyName string, schema *swagger.SchemaProperty) any {
	// 1. Enum — respect explicit values, allow bypass in security profiles
	if len(schema.Enum) > 0 {
		shouldBypass := (g.profile == swagger.ProfileMalicious) && rand.Float64() < 0.3
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
	if schema.Type != "object" || schema.Properties == nil {
		return map[string]any{}
	}

	payload := make(map[string]any, len(schema.Properties))

	for key, propSchema := range schema.Properties {
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
			rand.Float64() < 0.3 {
			continue
		}

		// 5% chance to omit REQUIRED fields in MALICIOUS profile
		if isRequired && g.profile == swagger.ProfileMalicious && rand.Float64() < 0.05 {
			continue
		}

		if propSchema.Type == "object" && propSchema.Properties != nil {
			payload[key] = g.BuildObject(propSchema)
		} else if propSchema.Type == "array" && propSchema.Items != nil {
			count := g.getArraySize(propSchema.Items)
			arr := make([]any, count)
			for i := range arr {
				if propSchema.Items.Type == "object" {
					arr[i] = g.BuildObject(propSchema.Items)
				} else {
					arr[i] = g.Generate(key, propSchema.Items)
				}
			}
			payload[key] = arr
		} else {
			payload[key] = g.Generate(key, propSchema)
		}
	}

	return payload
}

func (g *Generator) getArraySize(itemSchema *swagger.SchemaProperty) int {
	if g.profile == swagger.ProfileBoundary && g.isCategoryEnabled(payloads.CatBoundaryArrays) {
		size := seqPick(payloads.BoundaryArraySizes, &g.bArrIdx).(int)
		// Cap complex object arrays to prevent OOM
		if itemSchema != nil && itemSchema.Type == "object" {
			if size > 50 {
				return 50
			}
		}
		return size
	}
	return payloads.IntRange(1, 5)
}

func (g *Generator) generateByProfile(typ, format, propName string) any {
	// MALICIOUS: Type confusion check
	if g.profile == swagger.ProfileMalicious && g.isCategoryEnabled(payloads.CatMaliciousTypeConfusion) {
		if rand.Float64() < 0.05 {
			return seqPick(payloads.MaliciousTypeConfusion, &g.mTypeIdx)
		}
	}

	formatLower := strings.ToLower(format)

	// Handle format-specific date-time/uuid before generic string
	if typ == "string" {
		if formatLower == "date-time" {
			return g.generateDate()
		}
		if formatLower == "uuid" {
			return g.generateUUID()
		}
	}

	switch typ {
	case "string":
		return g.generateString(formatLower, propName)
	case "integer", "number":
		return g.generateNumber(typ)
	case "boolean":
		return g.generateBoolean()
	default:
		return g.fallbackRandom(propName)
	}
}

func (g *Generator) generateString(format, propName string) any {
	if g.profile == swagger.ProfileRandom {
		return g.fallbackRandom(propName)
	}

	if format == "uuid" {
		return g.generateUUID()
	}

	switch g.profile {
	case swagger.ProfileBoundary:
		if g.isCategoryEnabled(payloads.CatBoundaryStrings) {
			return seqPick(payloads.BoundaryStrings, &g.bStrIdx)
		}
	case swagger.ProfileMalicious:
		// Pick from enabled malicious categories
		var pools [][]any
		if g.isCategoryEnabled(payloads.CatMaliciousSQLi) {
			pools = append(pools, payloads.MaliciousSQLi)
		}
		if g.isCategoryEnabled(payloads.CatMaliciousXSS) {
			pools = append(pools, payloads.MaliciousXSS)
		}
		if g.isCategoryEnabled(payloads.CatMaliciousPathTraversal) {
			pools = append(pools, payloads.MaliciousPathTraversal)
		}
		if g.isCategoryEnabled(payloads.CatMaliciousEncoding) {
			pools = append(pools, payloads.MaliciousEncoding)
		}

		if len(pools) > 0 {
			// Flatten or pick a pool? To keep seqPick working consistently, 
			// we should probably have a single filtered slice for the whole run.
			// But for simplicity, we pick a random enabled pool and then seqPick from it.
			// However, seqPick needs a stable counter. 
			// Let's just use the AllMaliciousStrings and filter it in New().
			return seqPick(g.getActiveMaliciousStrings(), &g.mStrIdx)
		}
	}

	return g.fallbackRandom(propName)
}

func (g *Generator) getActiveMaliciousStrings() []any {
	// Ideally cached in New()
	var all []any
	if g.isCategoryEnabled(payloads.CatMaliciousEncoding) {
		all = append(all, payloads.MaliciousEncoding...)
	}
	if g.isCategoryEnabled(payloads.CatMaliciousSQLi) {
		all = append(all, payloads.MaliciousSQLi...)
	}
	if g.isCategoryEnabled(payloads.CatMaliciousXSS) {
		all = append(all, payloads.MaliciousXSS...)
	}
	if g.isCategoryEnabled(payloads.CatMaliciousPathTraversal) {
		all = append(all, payloads.MaliciousPathTraversal...)
	}
	if len(all) == 0 {
		return []any{payloads.Word()} // Fallback
	}
	return all
}

func (g *Generator) generateNumber(typ string) any {
	switch g.profile {
	case swagger.ProfileBoundary:
		if typ == "integer" {
			if g.isCategoryEnabled(payloads.CatBoundaryIntegers) {
				return seqPick(payloads.BoundaryIntegers, &g.bIntIdx)
			}
		} else {
			if g.isCategoryEnabled(payloads.CatBoundaryNumbers) {
				// Merged integers + numbers for float types
				merged := append([]any{}, payloads.BoundaryIntegers...)
				merged = append(merged, payloads.BoundaryNumbers...)
				return seqPick(merged, &g.bNumIdx)
			}
		}
	case swagger.ProfileMalicious:
		if g.isCategoryEnabled(payloads.CatMaliciousNumbers) {
			return seqPick(payloads.MaliciousNumbers, &g.mNumIdx)
		}
	}

	// Default/Fallback
	if typ == "integer" {
		return payloads.IntRange(1, 1000)
	}
	return payloads.FloatRange(0, 1000)
}

func (g *Generator) generateBoolean() any {
	switch g.profile {
	case swagger.ProfileBoundary:
		if g.isCategoryEnabled(payloads.CatBoundaryBooleans) {
			return seqPick(payloads.BoundaryBooleans, &g.bBoolIdx)
		}
	case swagger.ProfileMalicious:
		if g.isCategoryEnabled(payloads.CatMaliciousBooleans) {
			return seqPick(payloads.MaliciousBooleans, &g.mBoolIdx)
		}
	}
	return rand.Float64() < 0.5
}

func (g *Generator) generateDate() any {
	switch g.profile {
	case swagger.ProfileBoundary:
		if g.isCategoryEnabled(payloads.CatBoundaryDates) {
			return seqPick(payloads.BoundaryDates, &g.bDateIdx)
		}
	case swagger.ProfileMalicious:
		if g.isCategoryEnabled(payloads.CatMaliciousDates) {
			return seqPick(payloads.MaliciousDates, &g.mDateIdx)
		}
	}
	return payloads.RandomDate().Format("2006-01-02T15:04:05.000Z")
}

func (g *Generator) generateUUID() any {
	switch g.profile {
	case swagger.ProfileMalicious:
		if g.isCategoryEnabled(payloads.CatBoundaryUUIDs) { // Use boundary UUIDs for "malicious" uuid testing
			if rand.Float64() < 0.1 {
				return seqPick(payloads.BoundaryUUIDs, &g.mUUIDIdx)
			}
		}
	case swagger.ProfileBoundary:
		if g.isCategoryEnabled(payloads.CatBoundaryUUIDs) {
			// Occasionally test boundary UUIDs
			if rand.Float64() < 0.2 {
				return seqPick(payloads.BoundaryUUIDs, &g.bUUIDIdx)
			}
		}
	}
	return payloads.UUID()
}

func (g *Generator) fallbackRandom(propName string) any {
	if propName != "" {
		lower := strings.ToLower(propName)
		if strings.Contains(lower, "id") || strings.Contains(lower, "uuid") {
			return payloads.UUID()
		}
		if strings.Contains(lower, "slug") || strings.Contains(lower, "name") {
			return payloads.Word()
		}
		if strings.Contains(lower, "num") || strings.Contains(lower, "count") || strings.Contains(lower, "page") {
			return payloads.IntRange(1, 100)
		}
	}
	return payloads.RandomString(payloads.IntRange(3, 10))
}
