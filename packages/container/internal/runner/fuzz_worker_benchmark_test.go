// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"testing"

	"swazz-engine/internal/generator"
	"swazz-engine/internal/swagger"
)

func BenchmarkBuildFuzzIteration_Malicious(b *testing.B) {
	settings := swagger.DefaultSettings()
	ep := swagger.EndpointConfig{
		Path:   "/pets",
		Method: "POST",
		Schema: swagger.SchemaProperty{
			Type: "object",
			Properties: map[string]*swagger.SchemaProperty{
				"id":   {Type: "integer"},
				"name": {Type: "string"},
				"tags": {Type: "array", Items: &swagger.SchemaProperty{Type: "string"}},
			},
		},
	}
	gen := generator.New(nil, swagger.ProfileMalicious, settings)
	safeGen := generator.New(nil, swagger.ProfileRandom, settings)
	r := &Runner{config: &swagger.Config{Settings: settings}}
	seenHashes := make(map[uint32]bool)
	maxCap := settings.PayloadSizeCap()

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		r.buildFuzzIteration(ep, gen, safeGen, false, maxCap, false, seenHashes)
	}
}

func BenchmarkBuildFuzzIteration_Random(b *testing.B) {
	settings := swagger.DefaultSettings()
	ep := swagger.EndpointConfig{
		Path:   "/pets",
		Method: "POST",
		Schema: swagger.SchemaProperty{
			Type: "object",
			Properties: map[string]*swagger.SchemaProperty{
				"id":   {Type: "integer"},
				"name": {Type: "string"},
				"tags": {Type: "array", Items: &swagger.SchemaProperty{Type: "string"}},
			},
		},
	}
	gen := generator.New(nil, swagger.ProfileRandom, settings)
	safeGen := generator.New(nil, swagger.ProfileRandom, settings)
	r := &Runner{config: &swagger.Config{Settings: settings}}
	seenHashes := make(map[uint32]bool)
	maxCap := settings.PayloadSizeCap()

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		r.buildFuzzIteration(ep, gen, safeGen, false, maxCap, true, seenHashes)
	}
}
