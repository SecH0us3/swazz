// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"swazz-engine/internal/swagger"
)

func TestGetOrderedProfiles(t *testing.T) {
	tests := []struct {
		name     string
		input    []swagger.FuzzingProfile
		expected []swagger.FuzzingProfile
	}{
		{
			name:     "empty profiles",
			input:    []swagger.FuzzingProfile{},
			expected: nil,
		},
		{
			name:     "boundary profile ordered last",
			input:    []swagger.FuzzingProfile{swagger.ProfileBoundary, swagger.ProfileRandom, swagger.ProfileMalicious},
			expected: []swagger.FuzzingProfile{swagger.ProfileRandom, swagger.ProfileMalicious, swagger.ProfileBoundary},
		},
		{
			name:     "no boundary profile keeps original order",
			input:    []swagger.FuzzingProfile{swagger.ProfileRandom, swagger.ProfileMalicious},
			expected: []swagger.FuzzingProfile{swagger.ProfileRandom, swagger.ProfileMalicious},
		},
		{
			name:     "only boundary profile",
			input:    []swagger.FuzzingProfile{swagger.ProfileBoundary},
			expected: []swagger.FuzzingProfile{swagger.ProfileBoundary},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := &Runner{
				config: &swagger.Config{
					Settings: swagger.Settings{
						Profiles: tc.input,
					},
				},
			}
			ordered := r.getOrderedProfiles()
			assert.Equal(t, tc.expected, ordered)
		})
	}
}

func TestCalcEffectiveIterations(t *testing.T) {
	epWithFields := &swagger.EndpointConfig{
		Path:   "/api/user",
		Method: "POST",
		Schema: swagger.SchemaProperty{
			Properties: map[string]*swagger.SchemaProperty{
				"name": {Type: "string"},
			},
		},
	}

	epWithoutFields := &swagger.EndpointConfig{
		Path:   "/api/ping",
		Method: "GET",
	}

	tests := []struct {
		name     string
		profile  swagger.FuzzingProfile
		settings swagger.Settings
		endpoint *swagger.EndpointConfig
		expected int
	}{
		{
			name:    "with fields and iterations per profile >= min needed",
			profile: swagger.ProfileRandom,
			settings: swagger.Settings{
				IterationsPerProfile: 50,
			},
			endpoint: epWithFields,
			expected: 50,
		},
		{
			name:    "without fields non-malicious profile returns 1",
			profile: swagger.ProfileRandom,
			settings: swagger.Settings{
				IterationsPerProfile: 50,
			},
			endpoint: epWithoutFields,
			expected: 1,
		},
		{
			name:    "without fields malicious profile returns min needed",
			profile: swagger.ProfileMalicious,
			settings: swagger.Settings{
				IterationsPerProfile: 50,
			},
			endpoint: epWithoutFields,
			// Malicious min needed is >= 1
			expected: 1,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			actual := calcEffectiveIterations(tc.profile, tc.settings, tc.endpoint)
			assert.GreaterOrEqual(t, actual, tc.expected)
		})
	}
}

func TestCalcMaxPayloadSize(t *testing.T) {
	tests := []struct {
		name     string
		profile  swagger.FuzzingProfile
		settings swagger.Settings
		expected int
	}{
		{
			name:    "default limit when unset",
			profile: swagger.ProfileRandom,
			settings: swagger.Settings{
				MaxPayloadSizeBytes: 0,
			},
			expected: defaultMaxPayloadBytes,
		},
		{
			name:    "custom limit for standard profile",
			profile: swagger.ProfileRandom,
			settings: swagger.Settings{
				MaxPayloadSizeBytes: 2048,
			},
			expected: 2048,
		},
		{
			name:    "boundary profile boosts small limit to boundary max",
			profile: swagger.ProfileBoundary,
			settings: swagger.Settings{
				MaxPayloadSizeBytes: 2048,
			},
			expected: boundaryMaxPayloadBytes,
		},
		{
			name:    "boundary profile keeps limit if already larger than boundary max",
			profile: swagger.ProfileBoundary,
			settings: swagger.Settings{
				MaxPayloadSizeBytes: boundaryMaxPayloadBytes + 1024,
			},
			expected: boundaryMaxPayloadBytes + 1024,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			actual := calcMaxPayloadSize(tc.profile, tc.settings)
			assert.Equal(t, tc.expected, actual)
		})
	}
}

func TestEndpointRequests(t *testing.T) {
	epWithFields := &swagger.EndpointConfig{
		Path:   "/api/user",
		Method: "POST",
		Schema: swagger.SchemaProperty{
			Type: "object",
			Properties: map[string]*swagger.SchemaProperty{
				"name":  {Type: "string"},
				"email": {Type: "string"},
			},
		},
	}

	tests := []struct {
		name     string
		profile  swagger.FuzzingProfile
		settings swagger.Settings
		ep       *swagger.EndpointConfig
		verify   func(t *testing.T, count int)
	}{
		{
			name:    "standard active param fuzzing disabled",
			profile: swagger.ProfileRandom,
			settings: swagger.Settings{
				IterationsPerProfile:  20,
				ActiveParameterFuzzing: false,
			},
			ep: epWithFields,
			verify: func(t *testing.T, count int) {
				assert.Equal(t, 20, count)
			},
		},
		{
			name:    "active param fuzzing multiplies iterations by field count",
			profile: swagger.ProfileRandom,
			settings: swagger.Settings{
				IterationsPerProfile:  10,
				ActiveParameterFuzzing: true,
			},
			ep: epWithFields,
			verify: func(t *testing.T, count int) {
				// 2 fields * 10 iter = 20
				assert.Equal(t, 20, count)
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			count := endpointRequests(tc.profile, tc.settings, tc.ep)
			tc.verify(t, count)
		})
	}
}

func TestCalculateTotalPlanned(t *testing.T) {
	endpoints := []swagger.EndpointConfig{
		{
			Path:   "/test1",
			Method: "GET",
		},
		{
			Path:   "/test2",
			Method: "POST",
			Schema: swagger.SchemaProperty{
				Properties: map[string]*swagger.SchemaProperty{
					"key": {Type: "string"},
				},
			},
		},
	}

	tests := []struct {
		name              string
		settings          swagger.Settings
		profiles          []swagger.FuzzingProfile
		expectedEPs       int32
		minExpectedTotal  int64
	}{
		{
			name: "without rate limiting",
			settings: swagger.Settings{
				IterationsPerProfile: 5,
				RateLimitCheck:       false,
			},
			profiles:         []swagger.FuzzingProfile{swagger.ProfileRandom},
			expectedEPs:      4, // 2 baseline + 1*2 profiles
			minExpectedTotal: 2 + 1 + 5, // baseline (2) + test1(1) + test2(5)
		},
		{
			name: "with rate limiting",
			settings: swagger.Settings{
				IterationsPerProfile: 5,
				RateLimitCheck:       true,
				RateLimitBurstSize:   10,
			},
			profiles:         []swagger.FuzzingProfile{swagger.ProfileRandom},
			expectedEPs:      6, // 2 baseline + 1*2 profiles + 2 rate limit
			minExpectedTotal: 2 + 1 + 5 + (2 * 10),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := &Runner{
				config: &swagger.Config{
					Endpoints: endpoints,
					Settings:  tc.settings,
				},
			}
			r.calculateTotalPlanned(tc.profiles)
			require.Equal(t, tc.expectedEPs, r.progress.totalEndpoints.Load())
			assert.Equal(t, tc.minExpectedTotal, r.progress.totalPlanned.Load())
		})
	}
}
