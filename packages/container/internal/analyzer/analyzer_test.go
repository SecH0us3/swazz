// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"bytes"
	"net/http"
	"swazz-engine/internal/swagger"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAcquireAndReleaseInput_ReuseCycle(t *testing.T) {
	bodyA := bytes.Repeat([]byte("AlphaBody_"), 20)
	in := AcquireInput(AnalysisInput{
		SentPayload:     map[string]any{"a": "first", "b": "second"},
		ResponseBody:    bodyA,
		ResponseHeaders: http.Header{"X-Test": []string{"1"}},
		Duration:        123,
		Profile:         swagger.ProfileMalicious,
		Endpoint:        "/api/a",
		Method:          "POST",
		ResponseSize:    int64(len(bodyA)),
		BaselineSize:    100,
		SizeMultiplier:  2.5,
		BaselineTimeMs:  50,
		TimeThresholdMs: 4000,
		Settings:        swagger.DefaultSettings(),
	})

	// Populate all lazy views on response A without going through AnalyzerRegistry.Analyze,
	// verifying that ReleaseInput itself cleans up lowered, bigrams, sent, and payloadStr.
	require.Equal(t, bytes.ToLower(bodyA), in.lowerBody())
	require.NotNil(t, in.bodyBigrams())
	require.Len(t, in.sentStrings(), 2)
	require.Contains(t, in.payloadText(), "first")

	ReleaseInput(in)

	// Re-acquire for response B with a minimal literal and verify nothing from response A leaks.
	bodyB := []byte("BetaResponse")
	inB := AcquireInput(AnalysisInput{
		SentPayload:  map[string]any{"only": "third"},
		ResponseBody: bodyB,
		Endpoint:     "/api/b",
		Method:       "GET",
	})
	defer ReleaseInput(inB)

	assert.Nil(t, inB.ResponseHeaders)
	assert.Zero(t, inB.Duration)
	assert.Zero(t, inB.BaselineSize)
	assert.Zero(t, inB.BaselineTimeMs)
	assert.Equal(t, []byte("betaresponse"), inB.lowerBody())
	assert.Equal(t, []string{"third"}, inB.sentStrings())
	assert.Equal(t, "map[only:third]", inB.payloadText())
}

func TestReleaseInput_DropsOversizedSentSlice(t *testing.T) {
	items := make([]any, maxPooledSentCap+50)
	for i := range items {
		items[i] = "leaf"
	}

	in := AcquireInput(AnalysisInput{SentPayload: items})
	require.Len(t, in.sentStrings(), len(items))
	require.Greater(t, cap(in.sent), maxPooledSentCap)

	ReleaseInput(in)
	assert.Nil(t, in.sent, "oversized sent backing array must be dropped on release")
}
