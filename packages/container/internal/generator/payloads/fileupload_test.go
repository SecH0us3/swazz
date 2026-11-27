// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package payloads

import (
	"bytes"
	"encoding/json"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
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
	assert.Len(t, MaliciousFileUploads, 11)
	foundXSSSVG := false
	for _, uf := range MaliciousFileUploads {
		if uf.Filename == "swazz-xss.svg" {
			assert.Equal(t, "svg_upload_probe", uf.ProbeKind)
			foundXSSSVG = true
		}
		assert.NotEmpty(t, uf.Filename)
		assert.NotEmpty(t, uf.ContentType)
		assert.NotEmpty(t, uf.ProbeKind)
		assert.Equal(t, len(uf.Data), uf.Size)
		assert.Less(t, len(uf.Data), 1024, "probes must stay small and non-destructive")
	}
	assert.True(t, foundXSSSVG, "expected swazz-xss.svg in MaliciousFileUploads")

	bSmall := BoundaryFileUploads(512)
	require.Len(t, bSmall, 3)
	assert.Equal(t, 0, bSmall[0].Size)
	assert.Len(t, bSmall[1].Filename, 255)
	assert.Equal(t, 1024, bSmall[2].Size)

	bCap := BoundaryFileUploads(10_000_000)
	require.Len(t, bCap, 3)
	assert.Equal(t, 1_048_576, bCap[2].Size)
}

func TestUploadCorpus_EmbeddedAndRuntimeReload(t *testing.T) {
	canaries := AllValidCanaries()
	require.GreaterOrEqual(t, len(canaries), 4)

	seenKinds := make(map[string]bool)
	for _, c := range canaries {
		seenKinds[c.File.ProbeKind] = true
		assert.False(t, c.Mismatch, "valid canary %s should not be marked mismatch", c.File.Filename)
	}
	assert.True(t, seenKinds["valid_png"])
	assert.True(t, seenKinds["valid_jpeg"])
	assert.True(t, seenKinds["valid_gif"])
	assert.True(t, seenKinds["valid_text"])
	assert.True(t, seenKinds["valid_pdf"])
	assert.True(t, seenKinds["valid_zip"])

	for _, c := range canaries {
		switch c.File.ProbeKind {
		case "valid_jpeg":
			cfg, err := jpeg.DecodeConfig(bytes.NewReader(c.File.Data))
			require.NoError(t, err)
			assert.Equal(t, 1, cfg.Width)
			assert.Equal(t, 1, cfg.Height)
		case "valid_gif":
			cfg, err := gif.DecodeConfig(bytes.NewReader(c.File.Data))
			require.NoError(t, err)
			assert.Equal(t, 1, cfg.Width)
			assert.Equal(t, 1, cfg.Height)
		}
	}

	assert.Equal(t, "valid_jpeg", ValidCanaryForHints([]string{"image/jpeg"}, nil).ProbeKind)
	assert.Equal(t, "valid_gif", ValidCanaryForHints([]string{"image/gif"}, nil).ProbeKind)

	assert.Equal(t, []FileCategory{FileCatImage}, InferFileCategories([]string{"image/png", "image/jpeg"}, "file", "/upload"))
	assert.Equal(t, []FileCategory{FileCatArchive}, InferFileCategories(nil, "backup_bundle", "/api/import"))
	assert.Empty(t, InferFileCategories([]string{"application/octet-stream"}, "file", "/upload"))

	imgFirst := PrioritizedMaliciousUploads([]FileCategory{FileCatImage}, 0)
	require.NotEmpty(t, imgFirst)
	assert.Equal(t, "image/", imgFirst[0].ContentType[:6])

	// Runtime extra dir loading + sidecar metadata override + cleanup.
	tmpDir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(tmpDir, "probes"), 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "probes", "custom-bad.webp"), []byte("not-a-webp"), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "probes", "override.bin"), []byte("payload"), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "probes", "override.bin.meta.json"), []byte(`{"filename":"renamed.png","contentType":"image/png","probeKind":"mime_mismatch_png","category":"image"}`), 0o600))

	t.Cleanup(func() {
		_ = ReloadUploadCorpus("")
	})
	require.NoError(t, ReloadUploadCorpus(tmpDir))

	foundWebp := false
	foundOverride := false
	for _, uf := range MaliciousFileUploads {
		if uf.Filename == "custom-bad.webp" && uf.ProbeKind == "mime_mismatch_webp" {
			foundWebp = true
		}
		if uf.Filename == "renamed.png" && uf.ProbeKind == "mime_mismatch_png" && uf.ContentType == "image/png" {
			foundOverride = true
		}
	}
	assert.True(t, foundWebp, "expected auto-classified mime_mismatch_webp from runtime dir")
	assert.True(t, foundOverride, "expected .meta.json sidecar override from runtime dir")

	// maxBytes filter drops oversized probes.
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "probes", "large.txt"), bytes.Repeat([]byte("X"), 4096), 0o600))
	require.NoError(t, ReloadUploadCorpus(tmpDir))
	capped := PrioritizedMaliciousUploads(nil, 512)
	for _, uf := range capped {
		assert.LessOrEqual(t, len(uf.Data), 512)
	}

	// Edge cases: non-existent extraDir, malformed .meta.json, OOXML ZIP magic, wildcard MIME, token boundaries, FileCatBinary fallback.
	assert.NoError(t, ReloadUploadCorpus(filepath.Join(tmpDir, "does-not-exist")))
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "probes", "badmeta.png.meta.json"), []byte(`{broken-json`), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "probes", "badmeta.png"), []byte("not-png"), 0o600))
	assert.NoError(t, ReloadUploadCorpus(tmpDir))

	ooxml := classifyCorpusFile("report.docx", []byte{'P', 'K', 0x03, 0x04, 0x14, 0x00}, false, nil)
	assert.False(t, ooxml.Mismatch, "OOXML .docx with ZIP magic bytes should not be flagged as mismatch")

	assert.Equal(t, []FileCategory{FileCatImage}, InferFileCategories([]string{"image/*"}, "file", "/upload"))
	assert.Empty(t, InferFileCategories(nil, "file", "/topics/target/docker"))
	assert.Equal(t, "valid_png", ValidCanaryForCategories([]FileCategory{FileCatBinary}).ProbeKind)
}
