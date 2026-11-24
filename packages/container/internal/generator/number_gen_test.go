// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package generator

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/swagger"
)

func newNumberGen(profile swagger.FuzzingProfile, cats ...string) *Generator {
	settings := swagger.Settings{}
	if cats != nil {
		settings.PayloadCategories = map[swagger.FuzzingProfile][]string{profile: cats}
	}
	return New(nil, profile, settings)
}

func TestGenerateNumber_Sequencing(t *testing.T) {
	tests := []struct {
		name     string
		profile  swagger.FuzzingProfile
		category string
		typ      string
		want     []any
	}{
		{"boundary integer", swagger.ProfileBoundary, payloads.CatBoundaryIntegers, "integer", payloads.BoundaryIntegers},
		{"boundary number", swagger.ProfileBoundary, payloads.CatBoundaryNumbers, "number", boundaryFloats},
		{"malicious number", swagger.ProfileMalicious, payloads.CatMaliciousNumbers, "number", payloads.MaliciousNumbers},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.NotEmpty(t, tt.want)
			g := newNumberGen(tt.profile, tt.category)
			for i, w := range tt.want {
				assert.Equal(t, w, g.generateNumber(tt.typ), "call %d", i)
			}
			// Wraps around to the first value, and keeps cycling.
			for i, w := range tt.want {
				assert.Equal(t, w, g.generateNumber(tt.typ), "wrapped call %d", i)
			}
		})
	}
}

func TestGenerateNumber_BoundaryFloatsOrder(t *testing.T) {
	want := append(append([]any{}, payloads.BoundaryIntegers...), payloads.BoundaryNumbers...)
	assert.Equal(t, want, boundaryFloats)
	assert.Len(t, boundaryFloats, len(payloads.BoundaryIntegers)+len(payloads.BoundaryNumbers))
}

func TestGenerateNumber_FallbackRanges(t *testing.T) {
	tests := []struct {
		name    string
		profile swagger.FuzzingProfile
		cats    []string
	}{
		{"boundary, category disabled", swagger.ProfileBoundary, []string{payloads.CatBoundaryStrings}},
		{"malicious, category disabled", swagger.ProfileMalicious, []string{payloads.CatMaliciousSQLi}},
		{"random", swagger.ProfileRandom, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			g := newNumberGen(tt.profile, tt.cats...)
			for i := 0; i < 2000; i++ {
				iv, ok := g.generateNumber("integer").(int)
				require.True(t, ok, "integer must be int")
				assert.GreaterOrEqual(t, iv, 1)
				assert.LessOrEqual(t, iv, 1000)

				fv, ok := g.generateNumber("number").(float64)
				require.True(t, ok, "number must be float64")
				assert.GreaterOrEqual(t, fv, 0.0)
				assert.Less(t, fv, 1000.0)
			}
		})
	}
}
