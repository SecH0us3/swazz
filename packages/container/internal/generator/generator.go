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

// Generate produces a value for a single property.
// Priority: enum → dictionary → format-aware → profile-based.
func (g *Generator) Generate(propertyName string, schema *swagger.SchemaProperty) any {
	// 1. Enum — respect explicit values, allow bypass in security profiles
	if len(schema.Enum) > 0 {
		shouldBypass := (g.profile == swagger.ProfileMalicious || g.profile == swagger.ProfileBoundary) &&
			rand.Float64() < 0.3
		if !shouldBypass {
			return Pick(schema.Enum)
		}
	}

	// 2. User dictionary
	normalizedName := strings.ToLower(propertyName)
	if vals, ok := g.dictionaries[normalizedName]; ok && len(vals) > 0 {
		return Pick(vals)
	}

	// 3. Profile-based generation
	return g.generateByProfile(schema.Type, schema.Format, propertyName)
}

// BuildObject recursively builds a full object from JSON Schema.
func (g *Generator) BuildObject(schema *swagger.SchemaProperty) map[string]any {
	if schema.Type != "object" || schema.Properties == nil {
		return map[string]any{}
	}

	requiredSet := make(map[string]bool, len(schema.Required))
	for _, r := range schema.Required {
		requiredSet[r] = true
	}

	payload := make(map[string]any, len(schema.Properties))

	for key, propSchema := range schema.Properties {
		isRequired := requiredSet[key]

		// 30% chance to omit optional fields in intensive profiles
		if !isRequired &&
			(g.profile == swagger.ProfileBoundary || g.profile == swagger.ProfileMalicious) &&
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
		size := Pick(payloads.BoundaryArraySizes).(int)
		// Cap complex object arrays to prevent OOM
		if itemSchema != nil && itemSchema.Type == "object" {
			if size > 50 {
				return 50
			}
		}
		return size
	}
	return IntRange(1, 5)
}

func (g *Generator) generateByProfile(typ, format, propName string) any {
	// MALICIOUS: 5% chance to completely break the expected type
	if g.profile == swagger.ProfileMalicious && rand.Float64() < 0.05 {
		return Pick(payloads.MaliciousTypeConfusion)
	}

	// Handle format-specific date-time before generic string
	if typ == "string" && format == "date-time" {
		return g.generateDate()
	}

	switch typ {
	case "string":
		return g.generateString(format, propName)
	case "integer", "number":
		return g.generateNumber(typ)
	case "boolean":
		return g.generateBoolean()
	default:
		// Fallback — guess by name
		if propName != "" {
			lower := strings.ToLower(propName)
			if strings.Contains(lower, "id") || strings.Contains(lower, "uuid") {
				return UUID()
			}
			if strings.Contains(lower, "slug") || strings.Contains(lower, "name") {
				return Word()
			}
			if strings.Contains(lower, "num") || strings.Contains(lower, "count") || strings.Contains(lower, "page") {
				return IntRange(1, 100)
			}
		}
		return RandomString(IntRange(3, 10))
	}
}

func (g *Generator) generateString(format, propName string) any {
	if format == "" && propName != "" {
		lower := strings.ToLower(propName)
		if strings.Contains(lower, "id") || strings.Contains(lower, "uuid") {
			return UUID()
		}
		if strings.Contains(lower, "slug") || strings.Contains(lower, "name") {
			return Word()
		}
		if strings.Contains(lower, "num") || strings.Contains(lower, "count") || strings.Contains(lower, "page") {
			return IntRange(1, 100)
		}
	}

	switch g.profile {
	case swagger.ProfileBoundary:
		return Pick(payloads.BoundaryStrings)
	case swagger.ProfileMalicious:
		return Pick(payloads.AllMaliciousStrings)
	default:
		return generateRandomString(format)
	}
}

func generateRandomString(format string) string {
	switch format {
	case "uuid":
		return UUID()
	case "email":
		return Email()
	case "uri", "url":
		return URI()
	case "ipv4", "ip":
		return IPv4()
	case "date-time":
		return RandomDate().Format("2006-01-02T15:04:05.000Z")
	default:
		return Word()
	}
}

func (g *Generator) generateNumber(typ string) any {
	switch g.profile {
	case swagger.ProfileBoundary:
		if typ == "integer" {
			return Pick(payloads.BoundaryIntegers)
		}
		merged := make([]any, 0, len(payloads.BoundaryIntegers)+len(payloads.BoundaryNumbers))
		merged = append(merged, payloads.BoundaryIntegers...)
		merged = append(merged, payloads.BoundaryNumbers...)
		return Pick(merged)
	case swagger.ProfileMalicious:
		return Pick(payloads.MaliciousNumbers)
	default:
		if typ == "integer" {
			return IntRange(1, 1000)
		}
		return FloatRange(0, 1000)
	}
}

func (g *Generator) generateBoolean() any {
	switch g.profile {
	case swagger.ProfileMalicious:
		return Pick(payloads.MaliciousBooleans)
	default:
		return rand.Float64() < 0.5
	}
}

func (g *Generator) generateDate() any {
	switch g.profile {
	case swagger.ProfileBoundary:
		return Pick(payloads.BoundaryDates)
	case swagger.ProfileMalicious:
		return Pick(payloads.MaliciousDates)
	default:
		return RandomDate().Format("2006-01-02T15:04:05.000Z")
	}
}
