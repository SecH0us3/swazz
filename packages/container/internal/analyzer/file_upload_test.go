// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"net/http"
	"testing"

	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/swagger"
)

func TestFileUploadAnalyzer(t *testing.T) {
	a := &FileUploadAnalyzer{}

	t.Run("returns nil when no UploadFile is present or FileUploadSent is false", func(t *testing.T) {
		findings := a.Analyze(&AnalysisInput{
			SentPayload:    map[string]any{"name": "alice"},
			StatusCode:     200,
			FileUploadSent: true,
		})
		if len(findings) != 0 {
			t.Fatalf("expected 0 findings, got %d", len(findings))
		}

		notSent200 := a.Analyze(&AnalysisInput{
			SentPayload:    map[string]any{"file": payloads.MaliciousFileUploads[0]},
			StatusCode:     200,
			FileUploadSent: false,
		})
		if len(notSent200) != 0 {
			t.Fatalf("expected 0 findings when FileUploadSent=false on 200, got %d", len(notSent200))
		}

		notSent500 := a.Analyze(&AnalysisInput{
			SentPayload:    map[string]any{"file": payloads.MaliciousFileUploads[3]},
			StatusCode:     500,
			ResponseBody:   []byte(`PIL.UnidentifiedImageError: cannot identify image file`),
			FileUploadSent: false,
		})
		if len(notSent500) != 0 {
			t.Fatalf("expected 0 findings when FileUploadSent=false on 500, got %d", len(notSent500))
		}
	})

	t.Run("flags 2xx acceptance of malicious probes with appropriate severity", func(t *testing.T) {
		for _, uf := range payloads.MaliciousFileUploads {
			findings := a.Analyze(&AnalysisInput{
				SentPayload:    map[string]any{"file": uf},
				StatusCode:     200,
				FileUploadSent: true,
			})
			if len(findings) != 1 {
				t.Fatalf("probe %s: expected 1 finding, got %d", uf.ProbeKind, len(findings))
			}
			if findings[0].RuleID != "swazz/unvalidated-file-upload" {
				t.Fatalf("probe %s: unexpected rule %s", uf.ProbeKind, findings[0].RuleID)
			}
			wantLevel := "error"
			if uf.ProbeKind == "double_ext_filename" || uf.ProbeKind == "svg_upload_probe" || uf.ProbeKind == "traversal_filename" {
				wantLevel = "warning"
			}
			if findings[0].Level != wantLevel {
				t.Fatalf("probe %s: got level %s, want %s", uf.ProbeKind, findings[0].Level, wantLevel)
			}
		}
	})

	t.Run("upgrades traversal_filename to error + CWE-22 only on unsanitized reflection", func(t *testing.T) {
		var traversalProbe swagger.UploadFile
		for _, uf := range payloads.MaliciousFileUploads {
			if uf.ProbeKind == "traversal_filename" {
				traversalProbe = uf
				break
			}
		}
		for _, body := range []string{
			`{"filename":"swazz-probe.txt"}`,
			`<script src="../app.js"></script>`,
		} {
			sanitized := a.Analyze(&AnalysisInput{
				SentPayload:    map[string]any{"file": traversalProbe},
				StatusCode:     200,
				ResponseBody:   []byte(body),
				FileUploadSent: true,
			})
			if len(sanitized) != 1 || sanitized[0].Level != "warning" {
				t.Fatalf("body %s: expected warning, got %+v", body, sanitized)
			}
			if len(sanitized[0].CWEIDs) != 1 || sanitized[0].CWEIDs[0] != "CWE-434" {
				t.Fatalf("body %s: expected [CWE-434], got %v", body, sanitized[0].CWEIDs)
			}
		}

		for _, body := range []string{
			`{"savedPath":"../../swazz-probe.txt"}`,
			`{"savedPath":"..\/..\/swazz-probe.txt"}`,
			`{"url":"/files/..%2F..%2Fswazz-probe.txt"}`,
		} {
			reflected := a.Analyze(&AnalysisInput{
				SentPayload:    map[string]any{"file": traversalProbe},
				StatusCode:     200,
				ResponseBody:   []byte(body),
				FileUploadSent: true,
			})
			if len(reflected) != 1 {
				t.Fatalf("body %s: expected 1 finding, got %d", body, len(reflected))
			}
			if reflected[0].Level != "error" {
				t.Fatalf("body %s: expected error level on reflected traversal, got %s", body, reflected[0].Level)
			}
			if len(reflected[0].CWEIDs) != 2 || reflected[0].CWEIDs[1] != "CWE-22" {
				t.Fatalf("body %s: expected [CWE-434 CWE-22], got %v", body, reflected[0].CWEIDs)
			}
		}
	})

	t.Run("does not flag 4xx rejection or valid canary uploads", func(t *testing.T) {
		rejected := a.Analyze(&AnalysisInput{
			SentPayload:    map[string]any{"file": payloads.MaliciousFileUploads[0]},
			StatusCode:     400,
			FileUploadSent: true,
		})
		if len(rejected) != 0 {
			t.Fatalf("expected 0 findings on 400 rejection, got %d", len(rejected))
		}

		canary := a.Analyze(&AnalysisInput{
			SentPayload:    map[string]any{"file": payloads.ValidPNGFile()},
			StatusCode:     200,
			FileUploadSent: true,
		})
		if len(canary) != 0 {
			t.Fatalf("expected 0 findings on valid canary, got %d", len(canary))
		}

		for _, bf := range payloads.BoundaryFileUploads(1024) {
			bfRes := a.Analyze(&AnalysisInput{
				SentPayload:    map[string]any{"file": bf},
				StatusCode:     200,
				FileUploadSent: true,
			})
			if len(bfRes) != 0 {
				t.Fatalf("boundary probe %s: expected 0 findings on 200, got %d", bf.ProbeKind, len(bfRes))
			}
		}
	})

	t.Run("handles pointer and nil UploadFile in 2xx and ignores non-parser 5xx", func(t *testing.T) {
		uf := payloads.MaliciousFileUploads[0]
		var nilUF *swagger.UploadFile
		findings := a.Analyze(&AnalysisInput{
			SentPayload:    map[string]any{"ptr": &uf, "nilPtr": nilUF},
			StatusCode:     201,
			FileUploadSent: true,
		})
		if len(findings) != 1 || findings[0].RuleID != "swazz/unvalidated-file-upload" {
			t.Fatalf("expected 1 swazz/unvalidated-file-upload finding, got %+v", findings)
		}

		generic5xx := a.Analyze(&AnalysisInput{
			SentPayload:    map[string]any{"file": uf},
			StatusCode:     500,
			ResponseBody:   []byte(`{"error":"unexpected internal server error"}`),
			FileUploadSent: true,
		})
		if len(generic5xx) != 0 {
			t.Fatalf("expected 0 findings on 5xx without parser signature, got %d", len(generic5xx))
		}

		falseSig5xx := a.Analyze(&AnalysisInput{
			SentPayload:    map[string]any{"file": uf},
			StatusCode:     500,
			ResponseBody:   []byte(`{"error":"pupil. dilation check failed"}`),
			FileUploadSent: true,
		})
		if len(falseSig5xx) != 0 {
			t.Fatalf("expected 0 findings on non-PIL substring 'pupil.', got %d", len(falseSig5xx))
		}

		pilImg5xx := a.Analyze(&AnalysisInput{
			SentPayload:    map[string]any{"file": uf},
			StatusCode:     500,
			ResponseBody:   []byte(`PIL.Image.DecompressionBombError: Image size exceeds limit`),
			FileUploadSent: true,
		})
		if len(pilImg5xx) != 1 || pilImg5xx[0].RuleID != "swazz/file-parser-error" {
			t.Fatalf("expected 1 swazz/file-parser-error finding for PIL.Image, got %+v", pilImg5xx)
		}
		if len(pilImg5xx[0].OWASPCategory) != 1 || pilImg5xx[0].OWASPCategory[0] != "A10:2025 Mishandling of Exceptional Conditions" {
			t.Fatalf("unexpected OWASP category: %v", pilImg5xx[0].OWASPCategory)
		}
		if len(pilImg5xx[0].CWEIDs) != 3 || pilImg5xx[0].CWEIDs[0] != "CWE-20" || pilImg5xx[0].CWEIDs[1] != "CWE-755" || pilImg5xx[0].CWEIDs[2] != "CWE-209" {
			t.Fatalf("unexpected CWEIDs: %v", pilImg5xx[0].CWEIDs)
		}
	})

	t.Run("flags 5xx parser crash signatures including multi-file summary", func(t *testing.T) {
		uf1 := swagger.UploadFile{Filename: "swazz-truncated.png", ContentType: "image/png", ProbeKind: "truncated_png"}
		uf2 := swagger.UploadFile{Filename: "swazz-truncated.zip", ContentType: "application/zip", ProbeKind: "truncated_zip"}
		findings := a.Analyze(&AnalysisInput{
			SentPayload:    map[string]any{"avatar": &uf1, "archive": uf2},
			StatusCode:     500,
			ResponseBody:   []byte(`PIL.UnidentifiedImageError: cannot identify image file`),
			FileUploadSent: true,
		})
		if len(findings) != 1 {
			t.Fatalf("expected 1 finding, got %d", len(findings))
		}
		if findings[0].RuleID != "swazz/file-parser-error" {
			t.Fatalf("unexpected rule: %s", findings[0].RuleID)
		}
		if !containsSubstring(findings[0].Evidence, "archive:truncated_zip") || !containsSubstring(findings[0].Evidence, "avatar:truncated_png") {
			t.Fatalf("expected multi-file summary in evidence, got %s", findings[0].Evidence)
		}
	})

	t.Run("handles dynamic corpus probe kinds without false positives on benign custom uploads", func(t *testing.T) {
		dynMismatch := swagger.UploadFile{Filename: "bad.webp", ContentType: "image/webp", ProbeKind: "mime_mismatch_webp"}
		res1 := a.Analyze(&AnalysisInput{SentPayload: map[string]any{"file": dynMismatch}, StatusCode: 200, FileUploadSent: true})
		if len(res1) != 1 || res1[0].RuleID != "swazz/unvalidated-file-upload" {
			t.Fatalf("expected unvalidated-file-upload for mime_mismatch_webp, got %+v", res1)
		}

		dynCustom := swagger.UploadFile{Filename: "sample.png", ContentType: "image/png", ProbeKind: "custom_upload_image"}
		res2 := a.Analyze(&AnalysisInput{SentPayload: map[string]any{"file": dynCustom}, StatusCode: 200, FileUploadSent: true})
		if len(res2) != 0 {
			t.Fatalf("expected 0 findings on 200 for benign custom_upload_image, got %d", len(res2))
		}
	})

	t.Run("handles top-level raw UploadFile and backslash traversal reflection", func(t *testing.T) {
		rawProbe := swagger.UploadFile{Filename: "../../swazz-probe.txt", ContentType: "text/plain", ProbeKind: "traversal_filename"}
		res := a.Analyze(&AnalysisInput{
			SentPayload:    rawProbe,
			StatusCode:     200,
			ResponseBody:   []byte(`saved to ..\..\swazz-probe.txt`),
			FileUploadSent: true,
		})
		if len(res) != 1 || res[0].Level != "error" || len(res[0].CWEIDs) != 2 || res[0].CWEIDs[1] != "CWE-22" {
			t.Fatalf("expected error + CWE-22 for backslash traversal reflection, got %+v", res)
		}
	})

	t.Run("upgrades svg_upload_probe to error + CWE-79 only when unsanitized XSS is reflected in renderable response", func(t *testing.T) {
		svgProbe := swagger.UploadFile{
			Filename:    "swazz-xss.svg",
			ContentType: "image/svg+xml",
			ProbeKind:   "svg_upload_probe",
			Data:        []byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert('swazz-svg-xss')"><script>alert('swazz-svg-xss')</script></svg>`),
		}
		svgHeaders := http.Header{"Content-Type": []string{"image/svg+xml"}}
		unsanitized := a.Analyze(&AnalysisInput{
			SentPayload:     map[string]any{"file": svgProbe},
			StatusCode:      200,
			ResponseBody:    svgProbe.Data,
			ResponseHeaders: svgHeaders,
			FileUploadSent:  true,
		})
		if len(unsanitized) != 1 || unsanitized[0].Level != "error" || len(unsanitized[0].CWEIDs) != 2 || unsanitized[0].CWEIDs[1] != "CWE-79" {
			t.Fatalf("expected error + CWE-79 for reflected SVG XSS, got %+v", unsanitized)
		}

		jsonEcho := a.Analyze(&AnalysisInput{
			SentPayload:     map[string]any{"file": svgProbe},
			StatusCode:      200,
			ResponseBody:    svgProbe.Data,
			ResponseHeaders: http.Header{"Content-Type": []string{"application/json"}},
			FileUploadSent:  true,
		})
		if len(jsonEcho) != 1 || jsonEcho[0].Level != "warning" || len(jsonEcho[0].CWEIDs) != 1 || jsonEcho[0].CWEIDs[0] != "CWE-434" {
			t.Fatalf("expected warning + CWE-434 for JSON echo, got %+v", jsonEcho)
		}

		sanitized := a.Analyze(&AnalysisInput{
			SentPayload:     map[string]any{"file": svgProbe},
			StatusCode:      200,
			ResponseBody:    []byte(`<html><body><script>app()</script><p>swazz-svg-xss</p></body></html>`),
			ResponseHeaders: http.Header{"Content-Type": []string{"text/html"}},
			FileUploadSent:  true,
		})
		if len(sanitized) != 1 || sanitized[0].Level != "warning" || len(sanitized[0].CWEIDs) != 1 || sanitized[0].CWEIDs[0] != "CWE-434" {
			t.Fatalf("expected warning + CWE-434 for sanitized HTML page, got %+v", sanitized)
		}
	})
}

func containsSubstring(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || indexString(s, sub) >= 0)
}

func indexString(s, sub string) int {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func BenchmarkFileUploadAnalyzer_NoUpload(b *testing.B) {
	a := &FileUploadAnalyzer{}
	input := &AnalysisInput{
		SentPayload:  map[string]any{"username": "alice", "count": 42},
		StatusCode:   200,
		ResponseBody: []byte(`{"ok":true}`),
	}
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		_ = a.Analyze(input)
	}
}
