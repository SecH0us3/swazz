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
