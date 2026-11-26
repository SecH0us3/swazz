// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"bytes"
	"fmt"
	"sort"
	"strings"

	"swazz-engine/internal/swagger"
)

// FileUploadAnalyzer evaluates responses to multipart/form-data file upload probes.
type FileUploadAnalyzer struct{}

type uploadProbeHit struct {
	field string
	file  swagger.UploadFile
}

var parserErrorSignatures = [][]byte{
	[]byte("imagemagick"),
	[]byte("graphicsmagick"),
	[]byte("libvips"),
	[]byte("unidentifiedimageerror"),
	[]byte("decompressionbomb"),
	[]byte("pil.image"),
	[]byte("pil.unidentified"),
	[]byte("image: unknown format"),
	[]byte("zip: not a valid zip file"),
	[]byte("badzipfile"),
	[]byte("javax.imageio"),
	[]byte("sharp:"),
	[]byte("outofmemoryerror"),
}

func collectUploadFiles(v any, field string, out []uploadProbeHit) []uploadProbeHit {
	switch val := v.(type) {
	case swagger.UploadFile:
		return append(out, uploadProbeHit{field: field, file: val})
	case *swagger.UploadFile:
		if val != nil {
			return append(out, uploadProbeHit{field: field, file: *val})
		}
	case map[string]any:
		for k, item := range val {
			out = collectUploadFiles(item, k, out)
		}
	case []any:
		for _, item := range val {
			out = collectUploadFiles(item, field, out)
		}
	}
	return out
}

const fileUploadRemediation = "Validate file magic bytes (not just filename or Content-Type), enforce pre-decode image dimensions and pixel caps (e.g. image.DecodeConfig in Go, Image.MAX_IMAGE_PIXELS in Pillow, limitInputPixels in Sharp, policy.xml in ImageMagick), cap request stream size (http.MaxBytesReader / io.LimitReader), and sanitize/randomize stored filenames."

func (a *FileUploadAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if input == nil || input.SentPayload == nil {
		return nil
	}
	uploads := collectUploadFiles(input.SentPayload, "", nil)
	if len(uploads) == 0 {
		return nil
	}
	if len(uploads) > 1 {
		sort.Slice(uploads, func(i, j int) bool {
			if uploads[i].field != uploads[j].field {
				return uploads[i].field < uploads[j].field
			}
			if uploads[i].file.Filename != uploads[j].file.Filename {
				return uploads[i].file.Filename < uploads[j].file.Filename
			}
			return uploads[i].file.ProbeKind < uploads[j].file.ProbeKind
		})
	}

	var findings []swagger.AnalysisFinding

	if input.StatusCode >= 200 && input.StatusCode < 300 {
		for _, hit := range uploads {
			kind := hit.file.ProbeKind
			switch kind {
			case "mime_mismatch_png", "mime_mismatch_jpeg", "mime_mismatch_pdf",
				"truncated_png", "truncated_zip", "traversal_filename":
				cwe := []string{"CWE-434"}
				if kind == "traversal_filename" {
					cwe = []string{"CWE-434", "CWE-22"}
				}
				findings = append(findings, swagger.AnalysisFinding{
					RuleID:           "swazz/unvalidated-file-upload",
					Level:            "error",
					Message:          fmt.Sprintf("Server accepted %s upload probe (%q, %s) with HTTP %d.", kind, hit.file.Filename, hit.file.ContentType, input.StatusCode),
					Evidence:         fmt.Sprintf("Field: %s | Filename: %s | ContentType: %s | ProbeKind: %s | Status: %d | %s", hit.field, hit.file.Filename, hit.file.ContentType, kind, input.StatusCode, fileUploadRemediation),
					OWASPAPICategory: []string{"API8:2023 Security Misconfiguration"},
					OWASPCategory:    []string{"A06:2025 Insecure Design"},
					CWEIDs:           cwe,
				})
			case "double_ext_filename", "svg_upload_probe":
				findings = append(findings, swagger.AnalysisFinding{
					RuleID:           "swazz/unvalidated-file-upload",
					Level:            "warning",
					Message:          fmt.Sprintf("Server accepted potentially unsafe %s upload (%q, %s) with HTTP %d.", kind, hit.file.Filename, hit.file.ContentType, input.StatusCode),
					Evidence:         fmt.Sprintf("Field: %s | Filename: %s | ContentType: %s | ProbeKind: %s | Status: %d | %s", hit.field, hit.file.Filename, hit.file.ContentType, kind, input.StatusCode, fileUploadRemediation),
					OWASPAPICategory: []string{"API8:2023 Security Misconfiguration"},
					OWASPCategory:    []string{"A06:2025 Insecure Design"},
					CWEIDs:           []string{"CWE-434"},
				})
			}
		}
	}

	if input.StatusCode >= 500 {
		lower := input.lowerBody()
		for _, sig := range parserErrorSignatures {
			if bytes.Contains(lower, sig) {
				first := uploads[0]
				findings = append(findings, swagger.AnalysisFinding{
					RuleID:           "swazz/file-parser-error",
					Level:            "error",
					Message:          fmt.Sprintf("File parser crashed or leaked internal error (%q) with HTTP %d on %s probe.", string(sig), input.StatusCode, first.file.ProbeKind),
					Evidence:         fmt.Sprintf("MatchedSignature: %s | Field: %s | Filename: %s | ProbeKind: %s | Status: %d | %s", strings.TrimSpace(string(sig)), first.field, first.file.Filename, first.file.ProbeKind, input.StatusCode, fileUploadRemediation),
					OWASPAPICategory: []string{"API8:2023 Security Misconfiguration"},
					OWASPCategory:    []string{"A05:2025 Injection"},
					CWEIDs:           []string{"CWE-409", "CWE-209"},
				})
				break
			}
		}
	}

	return findings
}
