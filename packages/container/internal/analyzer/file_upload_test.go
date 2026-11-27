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
			if uf.ProbeKind == "gif_polyglot_probe" || uf.ProbeKind == "png_metadata_canary" {
				if len(findings) != 0 {
					t.Fatalf("probe %s: expected 0 findings on direct 2xx, got %d", uf.ProbeKind, len(findings))
				}
				continue
			}
			if len(findings) != 1 {
				t.Fatalf("probe %s: expected 1 finding, got %d", uf.ProbeKind, len(findings))
			}
			if findings[0].RuleID != "swazz/unvalidated-file-upload" {
				t.Fatalf("probe %s: unexpected rule %s", uf.ProbeKind, findings[0].RuleID)
			}
			wantLevel := "error"
			switch uf.ProbeKind {
			case "double_ext_filename", "svg_upload_probe", "traversal_filename",
				"eicar_av_probe", "null_byte_filename", "rtl_override_filename":
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
		uf := swagger.UploadFile{Filename: "swazz-probe.png", ContentType: "image/png", ProbeKind: "mime_mismatch_png", Data: []byte("not-png")}
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

		attachment := a.Analyze(&AnalysisInput{
			SentPayload:     map[string]any{"file": svgProbe},
			StatusCode:      200,
			ResponseBody:    svgProbe.Data,
			ResponseHeaders: http.Header{"Content-Type": []string{"image/svg+xml"}, "Content-Disposition": []string{`attachment; filename="swazz-xss.svg"`}},
			FileUploadSent:  true,
		})
		if len(attachment) != 1 || attachment[0].Level != "warning" || len(attachment[0].CWEIDs) != 1 {
			t.Fatalf("expected warning + CWE-434 when Content-Disposition is attachment, got %+v", attachment)
		}

		for _, csp := range []string{"sandbox", "script-src 'none'", "default-src 'none'"} {
			inertCSP := a.Analyze(&AnalysisInput{
				SentPayload:     map[string]any{"file": svgProbe},
				StatusCode:      200,
				ResponseBody:    svgProbe.Data,
				ResponseHeaders: http.Header{"Content-Type": []string{"image/svg+xml"}, "Content-Security-Policy": []string{csp}},
				FileUploadSent:  true,
			})
			if len(inertCSP) != 1 || inertCSP[0].Level != "warning" || len(inertCSP[0].CWEIDs) != 1 {
				t.Fatalf("CSP %q: expected warning + CWE-434, got %+v", csp, inertCSP)
			}
		}

		unsafeCSP := a.Analyze(&AnalysisInput{
			SentPayload:     map[string]any{"file": svgProbe},
			StatusCode:      200,
			ResponseBody:    svgProbe.Data,
			ResponseHeaders: http.Header{"Content-Type": []string{"image/svg+xml"}, "Content-Security-Policy": []string{"sandbox allow-scripts"}},
			FileUploadSent:  true,
		})
		if len(unsafeCSP) != 1 || unsafeCSP[0].Level != "error" || len(unsafeCSP[0].CWEIDs) != 2 || unsafeCSP[0].CWEIDs[1] != "CWE-79" {
			t.Fatalf("expected error + CWE-79 for sandbox allow-scripts, got %+v", unsafeCSP)
		}
	})

	t.Run("second-order follow-up analysis detects stored SVG XSS, lazy 5xx crash, and raw stored bytes", func(t *testing.T) {
		svgProbe := swagger.UploadFile{
			Filename:    "swazz-xss.svg",
			ContentType: "image/svg+xml",
			ProbeKind:   "svg_upload_probe",
			Data:        []byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert('swazz-svg-xss')"><script>alert('swazz-svg-xss')</script></svg>`),
		}
		// Inline SVG on follow-up -> error + CWE-79
		storedXSS := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": svgProbe},
			StatusCode:        200,
			ResponseBody:      svgProbe.Data,
			ResponseHeaders:   http.Header{"Content-Type": []string{"image/svg+xml"}},
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /files/42",
		})
		if len(storedXSS) != 1 || storedXSS[0].Level != "error" || len(storedXSS[0].CWEIDs) != 2 || storedXSS[0].CWEIDs[1] != "CWE-79" {
			t.Fatalf("expected stored SVG XSS error + CWE-79, got %+v", storedXSS)
		}

		// Attachment SVG on follow-up -> suppressed (no duplicate warning)
		attachmentFollowUp := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": svgProbe},
			StatusCode:        200,
			ResponseBody:      svgProbe.Data,
			ResponseHeaders:   http.Header{"Content-Type": []string{"image/svg+xml"}, "Content-Disposition": []string{"attachment"}},
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /files/42",
		})
		if len(attachmentFollowUp) != 0 {
			t.Fatalf("expected 0 follow-up findings for attachment SVG, got %+v", attachmentFollowUp)
		}

		// Lazy 5xx parser crash on follow-up
		truncProbe := swagger.UploadFile{Filename: "swazz-truncated.png", ContentType: "image/png", ProbeKind: "truncated_png", Data: []byte{0x89, 0x50}}
		lazyCrash := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": truncProbe},
			StatusCode:        500,
			ResponseBody:      []byte(`PIL.UnidentifiedImageError: cannot identify image file`),
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /thumbs/42",
		})
		if len(lazyCrash) != 1 || lazyCrash[0].RuleID != "swazz/file-parser-error" {
			t.Fatalf("expected swazz/file-parser-error on lazy 5xx follow-up, got %+v", lazyCrash)
		}

		// Stored raw mismatch bytes on follow-up
		mismatchProbe := swagger.UploadFile{Filename: "swazz-probe.png", ContentType: "image/png", ProbeKind: "mime_mismatch_png", Data: []byte("swazz-not-a-valid-png-payload\n")}
		storedRaw := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": mismatchProbe},
			StatusCode:        200,
			ResponseBody:      []byte("swazz-not-a-valid-png-payload\n"),
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /files/42",
		})
		if len(storedRaw) != 1 || storedRaw[0].RuleID != "swazz/unvalidated-file-upload" {
			t.Fatalf("expected stored mismatch finding on follow-up, got %+v", storedRaw)
		}

		// Follow-up traversal_filename: reflected -> error + CWE-22, unreflected -> suppressed; double_ext_filename -> suppressed
		travProbe := swagger.UploadFile{Filename: "../../swazz-probe.txt", ContentType: "text/plain", ProbeKind: "traversal_filename", Data: []byte("probe")}
		travReflected := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": travProbe},
			StatusCode:        200,
			ResponseBody:      []byte(`{"path":"../../swazz-probe.txt"}`),
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /files/42",
		})
		if len(travReflected) != 1 || travReflected[0].Level != "error" || len(travReflected[0].CWEIDs) != 2 || travReflected[0].CWEIDs[1] != "CWE-22" {
			t.Fatalf("expected error + CWE-22 for reflected traversal on follow-up, got %+v", travReflected)
		}
		travClean := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": travProbe},
			StatusCode:        200,
			ResponseBody:      []byte(`{"path":"sanitized.txt"}`),
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /files/42",
		})
		if len(travClean) != 0 {
			t.Fatalf("expected 0 follow-up findings for unreflected traversal, got %+v", travClean)
		}
		doubleExt := swagger.UploadFile{Filename: "swazz-probe.php.png", ContentType: "image/png", ProbeKind: "double_ext_filename"}
		if res := a.Analyze(&AnalysisInput{SentPayload: map[string]any{"file": doubleExt}, StatusCode: 200, FileUploadSent: true, FollowUpSourceURL: "GET /files/42"}); len(res) != 0 {
			t.Fatalf("expected 0 follow-up findings for double_ext_filename, got %+v", res)
		}
	})

	t.Run("evaluates polyglot GIF, PNG EXIF canary, EICAR AV, null-byte and RTL probes", func(t *testing.T) {
		gifPoly := swagger.UploadFile{Filename: "swazz-polyglot.gif", ContentType: "image/gif", ProbeKind: "gif_polyglot_probe", Data: []byte("GIF89a<!--swazz-polyglot-canary-->")}
		// Un-reencoded without nosniff -> warning + CWE-436
		resNoSniff := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": gifPoly},
			StatusCode:        200,
			ResponseBody:      gifPoly.Data,
			ResponseHeaders:   http.Header{"Content-Type": []string{"image/gif"}},
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /cdn/polyglot.gif",
		})
		if len(resNoSniff) != 1 || resNoSniff[0].Level != "warning" || len(resNoSniff[0].CWEIDs) != 2 || resNoSniff[0].CWEIDs[1] != "CWE-436" {
			t.Fatalf("expected warning + CWE-436 without nosniff, got %+v", resNoSniff)
		}
		// Un-reencoded with text/html -> error
		resHTML := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": gifPoly},
			StatusCode:        200,
			ResponseBody:      gifPoly.Data,
			ResponseHeaders:   http.Header{"Content-Type": []string{"text/html"}, "X-Content-Type-Options": []string{"nosniff"}},
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /cdn/polyglot.gif",
		})
		if len(resHTML) != 1 || resHTML[0].Level != "error" {
			t.Fatalf("expected error for renderable text/html polyglot, got %+v", resHTML)
		}
		// Un-reencoded WITH nosniff + image/gif -> 0 findings
		if resSafe := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": gifPoly},
			StatusCode:        200,
			ResponseBody:      gifPoly.Data,
			ResponseHeaders:   http.Header{"Content-Type": []string{"image/gif"}, "X-Content-Type-Options": []string{"nosniff"}},
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /cdn/polyglot.gif",
		}); len(resSafe) != 0 {
			t.Fatalf("expected 0 findings with image/gif + nosniff, got %+v", resSafe)
		}
		// Re-encoded (canary stripped) -> 0 findings
		if resReencoded := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": gifPoly},
			StatusCode:        200,
			ResponseBody:      []byte("GIF89a"),
			ResponseHeaders:   http.Header{"Content-Type": []string{"image/gif"}},
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /cdn/polyglot.gif",
		}); len(resReencoded) != 0 {
			t.Fatalf("expected 0 findings when GIF was re-encoded, got %+v", resReencoded)
		}

		// PNG metadata canary
		pngMeta := swagger.UploadFile{Filename: "swazz-exif-canary.png", ContentType: "image/png", ProbeKind: "png_metadata_canary"}
		resMeta := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": pngMeta},
			StatusCode:        200,
			ResponseBody:      []byte("PNG...swazz-exif-canary..."),
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /cdn/exif.png",
		})
		if len(resMeta) != 1 || len(resMeta[0].CWEIDs) != 1 || resMeta[0].CWEIDs[0] != "CWE-212" {
			t.Fatalf("expected warning + CWE-212 for unstripped PNG tEXt metadata canary, got %+v", resMeta)
		}
		if resStripped := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": pngMeta},
			StatusCode:        200,
			ResponseBody:      []byte("PNG-clean"),
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /cdn/exif.png",
		}); len(resStripped) != 0 {
			t.Fatalf("expected 0 findings when metadata stripped, got %+v", resStripped)
		}

		// EICAR follow-up
		eicar := swagger.UploadFile{Filename: "swazz-eicar.txt", ContentType: "text/plain", ProbeKind: "eicar_av_probe", Data: []byte("EICAR-TEST")}
		if resEicar := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": eicar},
			StatusCode:        200,
			ResponseBody:      []byte("EICAR-TEST"),
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /files/eicar",
		}); len(resEicar) != 1 || resEicar[0].Level != "warning" {
			t.Fatalf("expected warning when EICAR served back on follow-up, got %+v", resEicar)
		}
		if resQuarantined := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": eicar},
			StatusCode:        200,
			ResponseBody:      []byte("quarantined"),
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /files/eicar",
		}); len(resQuarantined) != 0 {
			t.Fatalf("expected 0 findings when EICAR quarantined, got %+v", resQuarantined)
		}

		// Null-byte and RTL filename reflection vs truncation / dangerous echo
		nullProbe := swagger.UploadFile{Filename: "swazz-probe.php%00.png", ContentType: "image/png", ProbeKind: "null_byte_filename"}
		// Direct POST JSON echo must stay warning (CWE-434), not escalate to error/CWE-22
		resNullPostEcho := a.Analyze(&AnalysisInput{
			SentPayload:    map[string]any{"file": nullProbe},
			StatusCode:     200,
			ResponseBody:   []byte(`{"name":"swazz-probe.php%00.png"}`),
			FileUploadSent: true,
		})
		if len(resNullPostEcho) != 1 || resNullPostEcho[0].Level != "warning" || len(resNullPostEcho[0].CWEIDs) != 1 || resNullPostEcho[0].CWEIDs[0] != "CWE-434" {
			t.Fatalf("expected warning + CWE-434 for direct POST JSON echo of null-byte filename, got %+v", resNullPostEcho)
		}
		// Follow-up GET with verbatim JSON echo must produce 0 findings
		resNullFollowUpEcho := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": nullProbe},
			StatusCode:        200,
			ResponseBody:      []byte(`{"name":"swazz-probe.php%00.png"}`),
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /files/1",
		})
		if len(resNullFollowUpEcho) != 0 {
			t.Fatalf("expected 0 findings for follow-up JSON echo of null-byte filename, got %+v", resNullFollowUpEcho)
		}
		// Follow-up GET with truncated filename must escalate to error + CWE-22
		resNullTruncated := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": nullProbe},
			StatusCode:        200,
			ResponseBody:      []byte(`{"path":"/uploads/swazz-probe.php"}`),
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /files/1",
		})
		if len(resNullTruncated) != 1 || resNullTruncated[0].Level != "error" || len(resNullTruncated[0].CWEIDs) != 2 || resNullTruncated[0].CWEIDs[1] != "CWE-22" {
			t.Fatalf("expected error + CWE-22 for truncated null-byte filename, got %+v", resNullTruncated)
		}

		rtlProbe := swagger.UploadFile{Filename: "swazz-probe-\u202Egnp.txt", ContentType: "text/plain", ProbeKind: "rtl_override_filename"}
		// Direct POST JSON echo must stay warning + CWE-451
		resRTLPostEcho := a.Analyze(&AnalysisInput{
			SentPayload:    map[string]any{"file": rtlProbe},
			StatusCode:     200,
			ResponseBody:   []byte(`{"name":"swazz-probe-\u202Egnp.txt"}`),
			FileUploadSent: true,
		})
		if len(resRTLPostEcho) != 1 || resRTLPostEcho[0].Level != "warning" || len(resRTLPostEcho[0].CWEIDs) != 1 || resRTLPostEcho[0].CWEIDs[0] != "CWE-451" {
			t.Fatalf("expected warning + CWE-451 for direct POST JSON echo of RTL filename, got %+v", resRTLPostEcho)
		}
		// Follow-up GET with JSON echo must produce 0 findings
		resRTLFollowUpJSON := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": rtlProbe},
			StatusCode:        200,
			ResponseBody:      []byte(`{"name":"swazz-probe-\u202Egnp.txt"}`),
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /files/1",
		})
		if len(resRTLFollowUpJSON) != 0 {
			t.Fatalf("expected 0 findings for follow-up JSON echo of RTL filename, got %+v", resRTLFollowUpJSON)
		}
		// Follow-up GET with Content-Disposition RTL filename must escalate to error + CWE-451
		resRTLDisp := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": rtlProbe},
			StatusCode:        200,
			ResponseHeaders:   http.Header{"Content-Disposition": []string{`attachment; filename="swazz-probe-\u202Egnp.txt"`}},
			ResponseBody:      []byte("hello"),
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /files/1",
		})
		if len(resRTLDisp) != 1 || resRTLDisp[0].Level != "error" || resRTLDisp[0].CWEIDs[0] != "CWE-451" {
			t.Fatalf("expected error + CWE-451 for RTL filename in Content-Disposition, got %+v", resRTLDisp)
		}
		// Follow-up GET with renderable HTML RTL filename must escalate to error + CWE-451
		resRTLHTML := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": rtlProbe},
			StatusCode:        200,
			ResponseHeaders:   http.Header{"Content-Type": []string{"text/html"}},
			ResponseBody:      []byte("<html><body>saved swazz-probe-\u202Egnp.txt</body></html>"),
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /files/1",
		})
		if len(resRTLHTML) != 1 || resRTLHTML[0].Level != "error" || resRTLHTML[0].CWEIDs[0] != "CWE-451" {
			t.Fatalf("expected error + CWE-451 for RTL filename in HTML response, got %+v", resRTLHTML)
		}

		// CSP negative test: default-src 'self'; object-src 'none' must NOT count as inert SVG CSP
		svgProbe := swagger.UploadFile{Filename: "swazz.svg", ContentType: "image/svg+xml", ProbeKind: "svg_upload_probe"}
		resSVGNonInertCSP := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": svgProbe},
			StatusCode:        200,
			ResponseHeaders:   http.Header{"Content-Type": []string{"image/svg+xml"}, "Content-Security-Policy": []string{"default-src 'self'; object-src 'none'"}},
			ResponseBody:      []byte("<svg><script>alert('swazz-svg-xss')</script></svg>"),
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /files/swazz.svg",
		})
		if len(resSVGNonInertCSP) != 1 || resSVGNonInertCSP[0].Level != "error" {
			t.Fatalf("expected error for SVG with default-src 'self'; object-src 'none', got %+v", resSVGNonInertCSP)
		}

		// PNG tEXt metadata canary must report CWE-212
		pngMetaProbe := swagger.UploadFile{Filename: "swazz-exif-canary.png", ContentType: "image/png", ProbeKind: "png_metadata_canary"}
		resPNGMeta := a.Analyze(&AnalysisInput{
			SentPayload:       map[string]any{"file": pngMetaProbe},
			StatusCode:        200,
			ResponseBody:      []byte("\x89PNG...swazz-exif-canary"),
			FileUploadSent:    true,
			FollowUpSourceURL: "GET /files/swazz-exif-canary.png",
		})
		if len(resPNGMeta) != 1 || resPNGMeta[0].CWEIDs[0] != "CWE-212" || resPNGMeta[0].FollowUpURL != "/files/swazz-exif-canary.png" || resPNGMeta[0].FollowUpStatus != 200 {
			t.Fatalf("expected CWE-212 + structured FollowUpURL/Status for preserved PNG tEXt metadata, got %+v", resPNGMeta)
		}
	})

	t.Run("null_byte_filename distinguishes truncation from sanitization and URL encoding", func(t *testing.T) {
		nullProbe := swagger.UploadFile{Filename: "swazz-probe.php%00.png", ContentType: "image/png", ProbeKind: "null_byte_filename"}
		cases := []struct {
			name         string
			body         string
			wantPostLvl  string
			wantPostCWEs int
			wantFollowUp int
		}{
			{
				name:         "verbatim echo",
				body:         `{"originalName":"swazz-probe.php%00.png"}`,
				wantPostLvl:  "warning",
				wantPostCWEs: 1,
				wantFollowUp: 0,
			},
			{
				name:         "url-encoded percent",
				body:         `{"url":"/files/swazz-probe.php%2500.png"}`,
				wantPostLvl:  "warning",
				wantPostCWEs: 1,
				wantFollowUp: 0,
			},
			{
				name:         "sanitized stripped percent",
				body:         `{"name":"swazz-probe.php00.png"}`,
				wantPostLvl:  "warning",
				wantPostCWEs: 1,
				wantFollowUp: 0,
			},
			{
				name:         "sanitized underscore",
				body:         `{"name":"swazz-probe.php_00.png"}`,
				wantPostLvl:  "warning",
				wantPostCWEs: 1,
				wantFollowUp: 0,
			},
			{
				name:         "json escaped null byte",
				body:         `{"name":"swazz-probe.php\u0000.png"}`,
				wantPostLvl:  "warning",
				wantPostCWEs: 1,
				wantFollowUp: 0,
			},
			{
				name:         "real truncation quote terminator",
				body:         `{"name":"swazz-probe.php"}`,
				wantPostLvl:  "error",
				wantPostCWEs: 2,
				wantFollowUp: 1,
			},
			{
				name:         "real truncation query terminator",
				body:         `{"url":"/files/swazz-probe.php?dl=1"}`,
				wantPostLvl:  "error",
				wantPostCWEs: 2,
				wantFollowUp: 1,
			},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				postRes := a.Analyze(&AnalysisInput{
					SentPayload:    map[string]any{"file": nullProbe},
					StatusCode:     201,
					ResponseBody:   []byte(tc.body),
					FileUploadSent: true,
				})
				if len(postRes) != 1 || postRes[0].Level != tc.wantPostLvl || len(postRes[0].CWEIDs) != tc.wantPostCWEs {
					t.Fatalf("POST mismatch for %s: got %+v", tc.name, postRes)
				}
				followRes := a.Analyze(&AnalysisInput{
					SentPayload:       map[string]any{"file": nullProbe},
					StatusCode:        200,
					ResponseBody:      []byte(tc.body),
					FileUploadSent:    true,
					FollowUpSourceURL: "GET /files/1",
				})
				if len(followRes) != tc.wantFollowUp {
					t.Fatalf("follow-up mismatch for %s: expected %d findings, got %+v", tc.name, tc.wantFollowUp, followRes)
				}
				if tc.wantFollowUp == 1 && (followRes[0].Level != "error" || len(followRes[0].CWEIDs) != 2 || followRes[0].CWEIDs[1] != "CWE-22") {
					t.Fatalf("expected error + CWE-22 on follow-up for %s, got %+v", tc.name, followRes)
				}
			})
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
