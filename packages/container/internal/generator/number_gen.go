// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package generator

import (
	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/swagger"
)

func (g *Generator) generateNumber(typ string) any {
	switch g.profile {
	case swagger.ProfileBoundary:
		if typ == "integer" {
			if g.isCategoryEnabled(payloads.CatBoundaryIntegers) {
				return seqPick(&g.mu, payloads.BoundaryIntegers, &g.bIntIdx)
			}
		} else {
			if g.isCategoryEnabled(payloads.CatBoundaryNumbers) {
				// Merged integers + numbers for float types
				merged := append([]any{}, payloads.BoundaryIntegers...)
				merged = append(merged, payloads.BoundaryNumbers...)
				return seqPick(&g.mu, merged, &g.bNumIdx)
			}
		}
	case swagger.ProfileMalicious:
		if g.isCategoryEnabled(payloads.CatMaliciousNumbers) {
			return seqPick(&g.mu, payloads.MaliciousNumbers, &g.mNumIdx)
		}
	}

	// Default/Fallback
	if typ == "integer" {
		return payloads.IntRange(1, 1000)
	}
	return payloads.FloatRange(0, 1000)
}
