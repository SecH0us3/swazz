// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package payloads

import (
	"bytes"
	"strings"

	"swazz-engine/internal/swagger"
)

// Minimal valid 1x1 transparent PNG (67 bytes).
var minimalValidPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
	0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
	0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
	0x42, 0x60, 0x82,
}

func newUploadFile(filename, contentType, probeKind string, data []byte) swagger.UploadFile {
	cp := make([]byte, len(data))
	copy(cp, data)
	return swagger.UploadFile{
		Filename:    filename,
		ContentType: contentType,
		ProbeKind:   probeKind,
		Size:        len(cp),
		Data:        cp,
	}
}

// ValidPNGFile returns a minimal, valid 1x1 PNG canary file.
func ValidPNGFile() swagger.UploadFile {
	return newUploadFile("swazz-canary.png", "image/png", "valid_png", minimalValidPNG)
}

// ValidTextFile returns a minimal, valid plain-text canary file.
func ValidTextFile() swagger.UploadFile {
	return newUploadFile("swazz-canary.txt", "text/plain", "valid_text", []byte("swazz-upload-canary\n"))
}

// MaliciousFileUploads holds safe, non-destructive validation probes for file upload endpoints.
// None of these payloads are zip bombs or decompression bombs with forged huge dimensions.
var MaliciousFileUploads = []swagger.UploadFile{
	newUploadFile("swazz-probe.png", "image/png", "mime_mismatch_png", []byte("swazz-not-a-valid-png-payload\n")),
	newUploadFile("swazz-probe.jpg", "image/jpeg", "mime_mismatch_jpeg", []byte("swazz-not-a-valid-jpeg-payload\n")),
	newUploadFile("swazz-probe.pdf", "application/pdf", "mime_mismatch_pdf", []byte("swazz-not-a-valid-pdf-payload\n")),
	newUploadFile("swazz-truncated.png", "image/png", "truncated_png", []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00}),
	newUploadFile("swazz-truncated.zip", "application/zip", "truncated_zip", []byte{'P', 'K', 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00}),
	newUploadFile("../../swazz-probe.txt", "text/plain", "traversal_filename", []byte("swazz-filename-probe\n")),
	newUploadFile("swazz-probe.php.png", "image/png", "double_ext_filename", minimalValidPNG),
	newUploadFile("swazz-probe.svg", "image/svg+xml", "svg_upload_probe", []byte(`<svg xmlns="http://www.w3.org/2000/svg"><text>swazz-svg-probe</text></svg>`)),
}

// BoundaryFileUploads returns non-destructive boundary probes (empty file, 255-char filename,
// and an uncompressed ASCII size-limit probe capped to at most 1 MiB and maxBytes).
func BoundaryFileUploads(maxBytes int) []swagger.UploadFile {
	size := maxBytes
	if size < 1024 {
		size = 1024
	}
	if size > 1_048_576 {
		size = 1_048_576
	}
	longName := strings.Repeat("a", 251) + ".png"
	return []swagger.UploadFile{
		newUploadFile("empty.bin", "application/octet-stream", "empty_file", nil),
		newUploadFile(longName, "image/png", "long_filename", minimalValidPNG),
		newUploadFile("swazz-size-limit-probe.txt", "text/plain", "oversized_uncompressed", bytes.Repeat([]byte("A"), size)),
	}
}
