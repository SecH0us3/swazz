// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"encoding/json"
	"testing"

	"swazz-engine/internal/generator"
	"swazz-engine/internal/swagger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildFuzzIteration_EnforcesMaxPayloadSize(t *testing.T) {
	r := &Runner{
		config: &swagger.Config{
			Settings: swagger.DefaultSettings(),
		},
	}

	endpoint := swagger.EndpointConfig{
		Path:   "/api/data",
		Method: "POST",
		Schema: swagger.SchemaProperty{
			Type: "object",
			Properties: map[string]*swagger.SchemaProperty{
				"largeField": {Type: "string"},
			},
		},
	}

	gen := generator.New(nil, swagger.ProfileBoundary, r.config.Settings)
	safeGen := generator.New(nil, swagger.ProfileRandom, r.config.Settings)

	t.Run("payload size within small 500 byte limit", func(t *testing.T) {
		smallLimit := 500
		seenHashes := make(map[uint32]bool)

		built, _, isDuplicate := r.buildFuzzIteration(endpoint, gen, safeGen, false, smallLimit, false, seenHashes)
		if !isDuplicate && built.body != nil {
			bodyBytes, err := json.Marshal(built.body)
			require.NoError(t, err)
			assert.LessOrEqual(t, len(bodyBytes), smallLimit, "generated payload must not exceed maxPayloadSize")
		}
	})

	t.Run("payload size within 10MB default limit", func(t *testing.T) {
		limit := defaultMaxPayloadBytes
		seenHashes := make(map[uint32]bool)

		built, _, isDuplicate := r.buildFuzzIteration(endpoint, gen, safeGen, false, limit, false, seenHashes)
		assert.False(t, isDuplicate)
		require.NotNil(t, built.body)

		bodyBytes, err := json.Marshal(built.body)
		require.NoError(t, err)
		assert.LessOrEqual(t, len(bodyBytes), limit)
	})
}
