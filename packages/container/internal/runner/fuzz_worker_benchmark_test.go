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

func BenchmarkBuildFuzzIterationPinned_AutoChainOnVsOff(b *testing.B) {
	ep := swagger.EndpointConfig{
		Path:       "/orders/{orderId}",
		Method:     "PATCH",
		PathParams: map[string]*swagger.SchemaProperty{"orderId": {Type: "string"}},
		Schema: swagger.SchemaProperty{
			Type: "object",
			Properties: map[string]*swagger.SchemaProperty{
				"note": {Type: "string"},
			},
		},
	}
	postEP := swagger.EndpointConfig{
		Path:   "/orders",
		Method: "POST",
		Schema: swagger.SchemaProperty{
			Type:       "object",
			Properties: map[string]*swagger.SchemaProperty{"item": {Type: "string"}},
		},
	}

	for _, enabled := range []bool{false, true} {
		name := "off"
		if enabled {
			name = "on"
		}
		b.Run(name, func(b *testing.B) {
			settings := swagger.DefaultSettings()
			flagVal := enabled
			settings.EnableAutoChaining = &flagVal
			cfg := &swagger.Config{
				BaseURL:   "https://api.example.com",
				Settings:  settings,
				Endpoints: []swagger.EndpointConfig{postEP, ep},
			}
			r := New(cfg, nil)
			b.Cleanup(r.Close)
			r.initAutoChain()
			if r.chainPool != nil {
				r.chainPool.Put("res:orders:id", "ord-42", "ord-42")
			}
			epIdx := r.chainIndex["PATCH /orders/{orderId}"]
			targetEP := r.chainPlan.Ordered[epIdx]
			gen := generator.New(nil, swagger.ProfileMalicious, settings)
			safeGen := generator.New(nil, swagger.ProfileRandom, settings)
			seenHashes := make(map[uint32]bool)
			maxCap := settings.PayloadSizeCap()

			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				r.buildFuzzIterationPinned(epIdx, enabled, nil, targetEP, gen, safeGen, false, maxCap, false, seenHashes)
			}
		})
	}
}
