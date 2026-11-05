// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package generator

import (
	"math/rand/v2"
	"testing"

	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/swagger"
)

// referenceBodyIterations is BodyIterations as it was: building the slice of every enabled
// malicious body payload to count it.
func referenceBodyIterations(g *Generator) int {
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

// BodyIterations, counted and stored by New, is what building the payload slice gave, for every
// profile and for random sets of enabled categories.
func TestBodyIterationsMatchesReference(t *testing.T) {
	var ids []string
	for _, c := range payloads.MaliciousCategories {
		ids = append(ids, c.ID)
	}
	ids = append(ids, payloads.CatOOBInteraction)

	rng := rand.New(rand.NewPCG(9, 10))
	for trial := range 300 {
		for _, profile := range []swagger.FuzzingProfile{swagger.ProfileRandom, swagger.ProfileBoundary, swagger.ProfileMalicious} {
			settings := swagger.DefaultSettings()
			if trial > 0 { // trial 0: every category enabled
				var enabled []string
				for _, id := range ids {
					if rng.IntN(2) == 0 {
						enabled = append(enabled, id)
					}
				}
				settings.PayloadCategories = map[swagger.FuzzingProfile][]string{profile: enabled}
			}
			g := New(nil, profile, settings)
			if got, want := g.BodyIterations(), referenceBodyIterations(g); got != want {
				t.Fatalf("%s %v: BodyIterations = %d, reference = %d", profile, settings.PayloadCategories, got, want)
			}
			literal := &Generator{profile: g.profile, activeCategories: g.activeCategories}
			if got, want := literal.BodyIterations(), referenceBodyIterations(g); got != want {
				t.Fatalf("%s: BodyIterations of a generator not built by New = %d, reference = %d", profile, got, want)
			}
		}
	}
}

func BenchmarkBodyIterations(b *testing.B) {
	g := New(nil, swagger.ProfileMalicious, swagger.DefaultSettings())
	b.Run("stored", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			_ = g.BodyIterations()
		}
	})
	b.Run("reference", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			_ = referenceBodyIterations(g)
		}
	})
}
