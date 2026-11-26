// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package payloads

import (
	"bytes"
	"encoding/json"
	"image/png"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidPNGFile_DecodesAs1x1(t *testing.T) {
	uf := ValidPNGFile()
	assert.Equal(t, "valid_png", uf.ProbeKind)
	assert.Equal(t, "image/png", uf.ContentType)
	assert.Equal(t, len(uf.Data), uf.Size)

	cfg, err := png.DecodeConfig(bytes.NewReader(uf.Data))
	require.NoError(t, err)
	assert.Equal(t, 1, cfg.Width)
	assert.Equal(t, 1, cfg.Height)
}

func TestUploadFile_JSONOmitsRawData(t *testing.T) {
	uf := ValidTextFile()
	b, err := json.Marshal(uf)
	require.NoError(t, err)
	assert.NotContains(t, string(b), "swazz-upload-canary")
	assert.Contains(t, string(b), `"probeKind":"valid_text"`)
}

func TestMaliciousAndBoundaryFileUploads(t *testing.T) {
	assert.Len(t, MaliciousFileUploads, 8)
	for _, uf := range MaliciousFileUploads {
		assert.NotEmpty(t, uf.Filename)
		assert.NotEmpty(t, uf.ContentType)
		assert.NotEmpty(t, uf.ProbeKind)
		assert.Equal(t, len(uf.Data), uf.Size)
		assert.Less(t, len(uf.Data), 1024, "probes must stay small and non-destructive")
	}

	bSmall := BoundaryFileUploads(512)
	require.Len(t, bSmall, 3)
	assert.Equal(t, 0, bSmall[0].Size)
	assert.Len(t, bSmall[1].Filename, 255)
	assert.Equal(t, 1024, bSmall[2].Size)

	bCap := BoundaryFileUploads(10_000_000)
	require.Len(t, bCap, 3)
	assert.Equal(t, 1_048_576, bCap[2].Size)
}
