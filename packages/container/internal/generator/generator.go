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

	// Sequential counters: BOUNDARY
	bStrIdx, bIntIdx, bNumIdx, bDateIdx, bArrIdx, bBoolIdx, bUUIDIdx int

	// Sequential counters: MALICIOUS
	mStrIdx, mNumIdx, mDateIdx, mBoolIdx, mTypeIdx, mUUIDIdx int
}

// New creates a new Generator.
func New(dictionaries map[string][]any, profile swagger.FuzzingProfile) *Generator {
	norm := make(map[string][]any, len(dictionaries))
	for k, v := range dictionaries {
		norm[strings.ToLower(k)] = v
	}
	return &Generator{
		dictionaries: norm,
		profile:      profile,
	}
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

// MinIterationsNeeded returns the minimum iterations required to cover all payloads in a profile.
func MinIterationsNeeded(profile swagger.FuzzingProfile) int {
	switch profile {
	case swagger.ProfileBoundary:
		return maxInt(
			len(payloads.BoundaryStrings),
			len(payloads.BoundaryIntegers),
			len(payloads.BoundaryNumbers),
			len(payloads.BoundaryDates),
			len(payloads.BoundaryBooleans),
			len(payloads.BoundaryArraySizes),
			len(payloads.BoundaryUUIDs),
		)
	case swagger.ProfileMalicious:
		return maxInt(
			len(payloads.AllMaliciousStrings),
			len(payloads.MaliciousNumbers),
			len(payloads.MaliciousDates),
			len(payloads.MaliciousBooleans),
			len(payloads.MaliciousTypeConfusion),
		)
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
	if g.profile == swagger.ProfileBoundary {
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
	// MALICIOUS: 5% chance to completely break the expected type
	if g.profile == swagger.ProfileMalicious && rand.Float64() < 0.05 {
		return seqPick(payloads.MaliciousTypeConfusion, &g.mTypeIdx)
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
		// Fallback — guess by name (only in RANDOM profile or if no other options)
		if g.profile == swagger.ProfileRandom && propName != "" {
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
}

func (g *Generator) generateString(format, propName string) any {
	if g.profile == swagger.ProfileRandom && format == "" && propName != "" {
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

	if format == "uuid" {
		return g.generateUUID()
	}

	switch g.profile {
	case swagger.ProfileBoundary:
		return seqPick(payloads.BoundaryStrings, &g.bStrIdx)
	case swagger.ProfileMalicious:
		return seqPick(payloads.AllMaliciousStrings, &g.mStrIdx)
	default:
		return generateRandomString(format)
	}
}

func generateRandomString(format string) string {
	switch format {
	case "uuid":
		return payloads.UUID()
	case "email":
		return payloads.Email()
	case "uri", "url":
		return payloads.URI()
	case "ipv4", "ip":
		return payloads.IPv4()
	case "date-time":
		return payloads.RandomDate().Format("2006-01-02T15:04:05.000Z")
	default:
		return payloads.Word()
	}
}

func (g *Generator) generateNumber(typ string) any {
	switch g.profile {
	case swagger.ProfileBoundary:
		if typ == "integer" {
			return seqPick(payloads.BoundaryIntegers, &g.bIntIdx)
		}
		merged := make([]any, 0, len(payloads.BoundaryIntegers)+len(payloads.BoundaryNumbers))
		merged = append(merged, payloads.BoundaryIntegers...)
		merged = append(merged, payloads.BoundaryNumbers...)
		return seqPick(merged, &g.bNumIdx)
	case swagger.ProfileMalicious:
		return seqPick(payloads.MaliciousNumbers, &g.mNumIdx)
	default:
		if typ == "integer" {
			return payloads.IntRange(1, 1000)
		}
		return payloads.FloatRange(0, 1000)
	}
}

func (g *Generator) generateBoolean() any {
	switch g.profile {
	case swagger.ProfileBoundary:
		return seqPick(payloads.BoundaryBooleans, &g.bBoolIdx)
	case swagger.ProfileMalicious:
		return seqPick(payloads.MaliciousBooleans, &g.mBoolIdx)
	default:
		return rand.Float64() < 0.5
	}
}

func (g *Generator) generateDate() any {
	switch g.profile {
	case swagger.ProfileBoundary:
		return seqPick(payloads.BoundaryDates, &g.bDateIdx)
	case swagger.ProfileMalicious:
		return seqPick(payloads.MaliciousDates, &g.mDateIdx)
	default:
		return payloads.RandomDate().Format("2006-01-02T15:04:05.000Z")
	}
}

func (g *Generator) generateUUID() any {
	// For UUIDs, we should avoid generating purely invalid formats in boundary arrays
	// so that the API doesn't reject the request immediately on validation.
	// We want to generate random valid UUIDs so the boundary test can actually hit the array logic.
	switch g.profile {
	case swagger.ProfileMalicious:
		// In malicious profile, occasionally test invalid UUID format
		if rand.Float64() < 0.1 {
			return seqPick(payloads.BoundaryUUIDs, &g.mUUIDIdx)
		}
		return payloads.UUID()
	default:
		// For both Boundary and Random profiles, generate valid UUIDs
		return payloads.UUID()
	}
}
