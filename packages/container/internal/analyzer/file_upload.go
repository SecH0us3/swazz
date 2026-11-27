// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"bytes"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"swazz-engine/internal/swagger"
)

// FileUploadAnalyzer evaluates responses to multipart/form-data and raw binary file upload probes.
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
	if input == nil || !input.FileUploadSent || input.SentPayload == nil {
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
	isFollowUp := input.FollowUpSourceURL != ""
	followUpSuffix := ""
	followUpPrefix := ""
	if isFollowUp {
		followUpSuffix = fmt.Sprintf(" (confirmed on follow-up %s)", input.FollowUpSourceURL)
		followUpPrefix = fmt.Sprintf("FollowUp: %s | ", input.FollowUpSourceURL)
	}

	if input.StatusCode >= 200 && input.StatusCode < 300 {
		for _, hit := range uploads {
			kind := hit.file.ProbeKind
			switch {
			case strings.HasPrefix(kind, "mime_mismatch_") || strings.HasPrefix(kind, "truncated_"):
				if isFollowUp {
					if strings.HasPrefix(kind, "truncated_") {
						continue
					}
					trimmedProbe := bytes.TrimSpace(hit.file.Data)
					if len(trimmedProbe) == 0 || !bytes.Contains(input.ResponseBody, trimmedProbe) {
						continue
					}
				}
				findings = append(findings, swagger.AnalysisFinding{
					RuleID:           "swazz/unvalidated-file-upload",
					Level:            "error",
					Message:          fmt.Sprintf("Server accepted %s upload probe (%q, %s) with HTTP %d%s.", kind, hit.file.Filename, hit.file.ContentType, input.StatusCode, followUpSuffix),
					Evidence:         fmt.Sprintf("%sField: %s | Filename: %s | ContentType: %s | ProbeKind: %s | Status: %d | %s", followUpPrefix, hit.field, hit.file.Filename, hit.file.ContentType, kind, input.StatusCode, fileUploadRemediation),
					OWASPAPICategory: []string{"API8:2023 Security Misconfiguration"},
					OWASPCategory:    []string{"A06:2025 Insecure Design"},
					CWEIDs:           []string{"CWE-434"},
				})
			case kind == "traversal_filename":
				lowerResp := input.lowerBody()
				reflected := bytes.Contains(lowerResp, []byte("../../swazz-probe.txt")) ||
					bytes.Contains(lowerResp, []byte(`..\/..\/swazz-probe.txt`)) ||
					bytes.Contains(lowerResp, []byte("..%2f..%2fswazz-probe.txt")) ||
					bytes.Contains(lowerResp, []byte(`..\..\swazz-probe.txt`)) ||
					bytes.Contains(lowerResp, []byte(`..\\..\\swazz-probe.txt`))
				if isFollowUp && !reflected {
					continue
				}
				level := "warning"
				cwe := []string{"CWE-434"}
				if reflected {
					level = "error"
					cwe = []string{"CWE-434", "CWE-22"}
				}
				findings = append(findings, swagger.AnalysisFinding{
					RuleID:           "swazz/unvalidated-file-upload",
					Level:            level,
					Message:          fmt.Sprintf("Server accepted %s upload probe (%q, %s) with HTTP %d%s.", kind, hit.file.Filename, hit.file.ContentType, input.StatusCode, followUpSuffix),
					Evidence:         fmt.Sprintf("%sField: %s | Filename: %s | ContentType: %s | ProbeKind: %s | Reflected: %t | Status: %d | %s", followUpPrefix, hit.field, hit.file.Filename, hit.file.ContentType, kind, reflected, input.StatusCode, fileUploadRemediation),
					OWASPAPICategory: []string{"API8:2023 Security Misconfiguration"},
					OWASPCategory:    []string{"A06:2025 Insecure Design"},
					CWEIDs:           cwe,
				})
			case kind == "svg_upload_probe":
				lowerResp := input.lowerBody()
				hasXSSMarker := bytes.Contains(lowerResp, []byte("<script>alert('swazz-svg-xss')")) ||
					bytes.Contains(lowerResp, []byte(`onload="alert('swazz-svg-xss')"`))
				reflectedXSS := hasXSSMarker &&
					isRenderableSVGOrHTMLResponse(input.ResponseHeaders, lowerResp) &&
					!isAttachmentDisposition(input.ResponseHeaders)
				if isFollowUp && !reflectedXSS {
					continue
				}
				level := "warning"
				owasp := []string{"A06:2025 Insecure Design"}
				cwe := []string{"CWE-434"}
				if reflectedXSS {
					level = "error"
					owasp = []string{"A06:2025 Insecure Design", "A05:2025 Injection"}
					cwe = []string{"CWE-434", "CWE-79"}
				}
				findings = append(findings, swagger.AnalysisFinding{
					RuleID:           "swazz/unvalidated-file-upload",
					Level:            level,
					Message:          fmt.Sprintf("Server accepted potentially unsafe %s upload (%q, %s) with HTTP %d%s.", kind, hit.file.Filename, hit.file.ContentType, input.StatusCode, followUpSuffix),
					Evidence:         fmt.Sprintf("%sField: %s | Filename: %s | ContentType: %s | ProbeKind: %s | ReflectedXSS: %t | Status: %d | %s", followUpPrefix, hit.field, hit.file.Filename, hit.file.ContentType, kind, reflectedXSS, input.StatusCode, fileUploadRemediation),
					OWASPAPICategory: []string{"API8:2023 Security Misconfiguration"},
					OWASPCategory:    owasp,
					CWEIDs:           cwe,
				})
			case kind == "double_ext_filename":
				if isFollowUp {
					continue
				}
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
				msg := fmt.Sprintf("File parser crashed or leaked internal error (%q) with HTTP %d on %s probe%s.", string(sig), input.StatusCode, first.file.ProbeKind, followUpSuffix)
				uploadsSummary := ""
				if len(uploads) > 1 {
					parts := make([]string, len(uploads))
					for i, u := range uploads {
						parts[i] = fmt.Sprintf("%s:%s", u.field, u.file.ProbeKind)
					}
					uploadsSummary = fmt.Sprintf(" | Uploads: %s", strings.Join(parts, ", "))
					msg = fmt.Sprintf("File parser crashed or leaked internal error (%q) with HTTP %d across %d upload probes%s.", string(sig), input.StatusCode, len(uploads), followUpSuffix)
				}
				findings = append(findings, swagger.AnalysisFinding{
					RuleID:           "swazz/file-parser-error",
					Level:            "error",
					Message:          msg,
					Evidence:         fmt.Sprintf("%sMatchedSignature: %s | Field: %s | Filename: %s | ProbeKind: %s%s | Status: %d | %s", followUpPrefix, strings.TrimSpace(string(sig)), first.field, first.file.Filename, first.file.ProbeKind, uploadsSummary, input.StatusCode, fileUploadRemediation),
					OWASPAPICategory: []string{"API8:2023 Security Misconfiguration"},
					OWASPCategory:    []string{"A10:2025 Mishandling of Exceptional Conditions"},
					CWEIDs:           []string{"CWE-20", "CWE-755", "CWE-209"},
				})
				break
			}
		}
	}

	return findings
}

func isAttachmentDisposition(headers http.Header) bool {
	if headers == nil {
		return false
	}
	disp := strings.ToLower(strings.TrimSpace(headers.Get("Content-Disposition")))
	return strings.HasPrefix(disp, "attachment") || strings.Contains(disp, "; attachment")
}

func isRenderableSVGOrHTMLResponse(headers http.Header, lowerBody []byte) bool {
	if headers != nil {
		ct := strings.ToLower(strings.TrimSpace(headers.Get("Content-Type")))
		if semi := strings.IndexByte(ct, ';'); semi > 0 {
			ct = strings.TrimSpace(ct[:semi])
		}
		if ct != "" {
			return ct == "text/html" || ct == "image/svg+xml" || ct == "application/xhtml+xml" ||
				ct == "application/xml" || ct == "text/xml"
		}
	}
	trimmed := bytes.TrimSpace(lowerBody)
	return bytes.HasPrefix(trimmed, []byte("<svg")) || bytes.HasPrefix(trimmed, []byte("<!doctype html")) || bytes.HasPrefix(trimmed, []byte("<html"))
}
