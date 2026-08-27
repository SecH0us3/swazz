// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package generator

import (
	"math/rand/v2"
	"strings"

	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/swagger"
)

func (g *Generator) getArraySize(itemSchema *swagger.SchemaProperty) int {
	if g.profile == swagger.ProfileBoundary && g.isCategoryEnabled(payloads.CatBoundaryArrays) {
		size := seqPick(&g.mu, payloads.BoundaryArraySizes, &g.bArrIdx).(int)
		if itemSchema == nil {
			if size > 100 {
				return 100
			}
			return size
		}

		// Objects have multiple fields and can nest deeply; keep object array length bounded.
		if itemSchema.Type == "object" {
			if size > 10 {
				return 10
			}
			return size
		}

		// For primitive items (uuid, integer, date, boolean, short string), calculate budget based on payload limit.
		maxBudget := 1048576 // 1MB default budget for array accumulation
		if g.settings.MaxPayloadSizeBytes > 0 {
			maxBudget = g.settings.MaxPayloadSizeBytes
		}

		approxItemBytes := 30 // default item size in JSON
		switch itemSchema.Type {
		case "string":
			formatLower := strings.ToLower(itemSchema.Format)
			if formatLower == "uuid" {
				approxItemBytes = 40 // "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
			} else if formatLower == "date-time" || formatLower == "date" {
				approxItemBytes = 30
			} else {
				approxItemBytes = 50
			}
		case "integer", "number":
			approxItemBytes = 15
		case "boolean":
			approxItemBytes = 6
		}

		maxItems := maxBudget / approxItemBytes
		if maxItems < 100 {
			maxItems = 100
		}
		// Hard ceiling per single array to prevent client-side memory exhaustion
		if maxItems > 10000 {
			maxItems = 10000
		}

		if size > maxItems {
			return maxItems
		}
		return size
	}
	return payloads.IntRange(1, 5)
}

func (g *Generator) generateBoolean() any {
	switch g.profile {
	case swagger.ProfileBoundary:
		if g.isCategoryEnabled(payloads.CatBoundaryBooleans) {
			return seqPick(&g.mu, payloads.BoundaryBooleans, &g.bBoolIdx)
		}
	case swagger.ProfileMalicious:
		if g.isCategoryEnabled(payloads.CatMaliciousBooleans) {
			return seqPick(&g.mu, payloads.MaliciousBooleans, &g.mBoolIdx)
		}
	}
	return rand.Float64() < 0.5 // #nosec G404 -- non-security randomness for fuzzer
}

func (g *Generator) generateByProfile(typ, format, propName string) any {
	// MALICIOUS: Type confusion check
	if g.profile == swagger.ProfileMalicious && g.isCategoryEnabled(payloads.CatMaliciousTypeConfusion) {
		if rand.Float64() < 0.05 { // #nosec G404 -- non-security randomness for fuzzer
			return seqPick(&g.mu, payloads.MaliciousTypeConfusion, &g.mTypeIdx)
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
