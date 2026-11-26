// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"testing"

	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/swagger"
)

func TestFileUploadAnalyzer(t *testing.T) {
	a := &FileUploadAnalyzer{}

	t.Run("returns nil when no UploadFile is present", func(t *testing.T) {
		findings := a.Analyze(&AnalysisInput{
			SentPayload: map[string]any{"name": "alice"},
			StatusCode:  200,
		})
		if len(findings) != 0 {
			t.Fatalf("expected 0 findings, got %d", len(findings))
		}
	})

	t.Run("flags 2xx acceptance of malicious probes with appropriate severity", func(t *testing.T) {
		for _, uf := range payloads.MaliciousFileUploads {
			findings := a.Analyze(&AnalysisInput{
				SentPayload: map[string]any{"file": uf},
				StatusCode:  200,
			})
			if len(findings) != 1 {
				t.Fatalf("probe %s: expected 1 finding, got %d", uf.ProbeKind, len(findings))
			}
			if findings[0].RuleID != "swazz/unvalidated-file-upload" {
				t.Fatalf("probe %s: unexpected rule %s", uf.ProbeKind, findings[0].RuleID)
			}
			wantLevel := "error"
			if uf.ProbeKind == "double_ext_filename" || uf.ProbeKind == "svg_upload_probe" {
				wantLevel = "warning"
			}
			if findings[0].Level != wantLevel {
				t.Fatalf("probe %s: got level %s, want %s", uf.ProbeKind, findings[0].Level, wantLevel)
			}
		}
	})

	t.Run("does not flag 4xx rejection or valid canary uploads", func(t *testing.T) {
		rejected := a.Analyze(&AnalysisInput{
			SentPayload: map[string]any{"file": payloads.MaliciousFileUploads[0]},
			StatusCode:  400,
		})
		if len(rejected) != 0 {
			t.Fatalf("expected 0 findings on 400 rejection, got %d", len(rejected))
		}

		canary := a.Analyze(&AnalysisInput{
			SentPayload: map[string]any{"file": payloads.ValidPNGFile()},
			StatusCode:  200,
		})
		if len(canary) != 0 {
			t.Fatalf("expected 0 findings on valid canary, got %d", len(canary))
		}

		for _, bf := range payloads.BoundaryFileUploads(1024) {
			bfRes := a.Analyze(&AnalysisInput{
				SentPayload: map[string]any{"file": bf},
				StatusCode:  200,
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
			SentPayload: map[string]any{"ptr": &uf, "nilPtr": nilUF},
			StatusCode:  201,
		})
		if len(findings) != 1 || findings[0].RuleID != "swazz/unvalidated-file-upload" {
			t.Fatalf("expected 1 swazz/unvalidated-file-upload finding, got %+v", findings)
		}

		generic5xx := a.Analyze(&AnalysisInput{
			SentPayload:  map[string]any{"file": uf},
			StatusCode:   500,
			ResponseBody: []byte(`{"error":"unexpected internal server error"}`),
		})
		if len(generic5xx) != 0 {
			t.Fatalf("expected 0 findings on 5xx without parser signature, got %d", len(generic5xx))
		}
	})

	t.Run("flags 5xx parser crash signatures", func(t *testing.T) {
		uf := payloads.MaliciousFileUploads[3] // truncated_png
		findings := a.Analyze(&AnalysisInput{
			SentPayload:  map[string]any{"files": []any{&uf}},
			StatusCode:   500,
			ResponseBody: []byte(`PIL.UnidentifiedImageError: cannot identify image file`),
		})
		if len(findings) != 1 {
			t.Fatalf("expected 1 finding, got %d", len(findings))
		}
		if findings[0].RuleID != "swazz/file-parser-error" {
			t.Fatalf("unexpected rule: %s", findings[0].RuleID)
		}
	})
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
