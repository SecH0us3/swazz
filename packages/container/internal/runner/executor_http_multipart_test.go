// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/analyzer"
	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/swagger"
)

func TestExecuteSingleRequest_MultipartFileUploadAndAnalysis(t *testing.T) {
	var gotCT, gotCaption, gotFilename, gotPartCT, gotFileData string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotCT = r.Header.Get("Content-Type")
		mr, err := r.MultipartReader()
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		for {
			part, err := mr.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			b, _ := io.ReadAll(part)
			if part.FormName() == "caption" {
				gotCaption = string(b)
			} else if part.FormName() == "avatar" {
				gotFilename = part.FileName()
				gotPartCT = part.Header.Get("Content-Type")
				gotFileData = string(b)
			}
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"uploaded":true}`))
	}))
	defer srv.Close()

	cfg := &swagger.Config{
		BaseURL:  srv.URL,
		Security: swagger.SecurityConfig{AllowPrivateIPs: true},
		Settings: swagger.Settings{
			AnalyzeResponseBody: true,
			TimeoutMs:           5000,
		},
	}
	r := New(cfg, nil)
	defer r.Close()
	r.analyzer = analyzer.NewRegistry(nil)

	probe := payloads.MaliciousFileUploads[0] // mime_mismatch_png
	res := r.executeGeneratedRequest(
		t.Context(),
		srv.URL, "/upload", "/upload", "POST",
		nil, nil,
		map[string]any{
			"caption": "hello",
			"avatar":  probe,
		},
		swagger.ProfileMalicious,
		nil, nil,
		"multipart/form-data",
		nil,
	)

	require.NotNil(t, res)
	assert.Equal(t, http.StatusOK, res.Status)
	assert.True(t, strings.HasPrefix(gotCT, "multipart/form-data; boundary="))
	assert.Equal(t, "hello", gotCaption)
	assert.Equal(t, probe.Filename, gotFilename)
	assert.Equal(t, probe.ContentType, gotPartCT)
	assert.Equal(t, string(probe.Data), gotFileData)
	require.NotEmpty(t, res.AnalyzerFindings)
	assert.Equal(t, "swazz/unvalidated-file-upload", res.AnalyzerFindings[0].RuleID)
}

func TestExecuteSingleRequest_MultipartSlicesPointersFallbacksAnd5xx(t *testing.T) {
	var seenNames []string
	var seenCTs []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mr, err := r.MultipartReader()
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		for {
			part, err := mr.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			_, _ = io.ReadAll(part)
			if part.FormName() != "scalar" {
				seenNames = append(seenNames, part.FileName())
				seenCTs = append(seenCTs, part.Header.Get("Content-Type"))
			}
		}
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`PIL.UnidentifiedImageError: cannot identify image file`))
	}))
	defer srv.Close()

	cfg := &swagger.Config{
		BaseURL:  srv.URL,
		Security: swagger.SecurityConfig{AllowPrivateIPs: true},
		Settings: swagger.Settings{
			AnalyzeResponseBody: true,
			TimeoutMs:           5000,
		},
	}
	r := New(cfg, nil)
	defer r.Close()
	r.analyzer = analyzer.NewRegistry(nil)

	ptrProbe := swagger.UploadFile{
		Filename:    "bad\"name\\\r\n.bin",
		ContentType: "",
		ProbeKind:   "truncated_png",
		Data:        []byte{0x89, 0x50},
	}
	emptyNameProbe := swagger.UploadFile{
		Filename:    "",
		ContentType: "application/zip",
		ProbeKind:   "truncated_zip",
		Data:        []byte{'P', 'K'},
	}
	res := r.executeGeneratedRequest(
		t.Context(),
		srv.URL, "/upload", "/upload", "POST",
		nil, nil,
		map[string]any{
			"singlePtr": &ptrProbe,
			"files":     []any{emptyNameProbe, &ptrProbe, "scalar-item"},
			"scalar":    123,
		},
		swagger.ProfileMalicious,
		nil, nil,
		"multipart/form-data",
		nil,
	)

	require.NotNil(t, res)
	assert.Equal(t, http.StatusInternalServerError, res.Status)
	assert.Contains(t, seenNames, "upload.bin")
	assert.Contains(t, seenNames, `bad"name\.bin`)
	assert.Contains(t, seenCTs, "application/octet-stream")
	assert.Contains(t, seenCTs, "application/zip")
	require.NotEmpty(t, res.AnalyzerFindings)
	assert.Equal(t, "swazz/file-parser-error", res.AnalyzerFindings[0].RuleID)
}

func TestExecuteSingleRequest_RawBinaryAndNonMultipartContentTypes(t *testing.T) {
	t.Run("application/octet-stream raw UploadFile sends raw bytes and triggers analyzer", func(t *testing.T) {
		var gotCT string
		var gotBody []byte
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotCT = r.Header.Get("Content-Type")
			gotBody, _ = io.ReadAll(r.Body)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true}`))
		}))
		defer srv.Close()

		cfg := &swagger.Config{
			BaseURL:  srv.URL,
			Security: swagger.SecurityConfig{AllowPrivateIPs: true},
			Settings: swagger.Settings{AnalyzeResponseBody: true, TimeoutMs: 5000},
		}
		r := New(cfg, nil)
		defer r.Close()
		r.analyzer = analyzer.NewRegistry(nil)

		probe := payloads.MaliciousFileUploads[0] // mime_mismatch_png (CT: image/png)
		res := r.executeGeneratedRequest(
			t.Context(),
			srv.URL, "/raw-upload", "/raw-upload", "POST",
			nil, nil,
			probe,
			swagger.ProfileMalicious,
			nil, nil,
			"application/octet-stream",
			nil,
		)

		require.NotNil(t, res)
		assert.Equal(t, http.StatusOK, res.Status)
		assert.Equal(t, probe.ContentType, gotCT)
		assert.Equal(t, probe.Data, gotBody)
		require.NotEmpty(t, res.AnalyzerFindings)
		assert.Equal(t, "swazz/unvalidated-file-upload", res.AnalyzerFindings[0].RuleID)
	})

	t.Run("application/json with UploadFile does not trigger FileUploadAnalyzer", func(t *testing.T) {
		var gotCT, gotBody string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotCT = r.Header.Get("Content-Type")
			b, _ := io.ReadAll(r.Body)
			gotBody = string(b)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true}`))
		}))
		defer srv.Close()

		cfg := &swagger.Config{
			BaseURL:  srv.URL,
			Security: swagger.SecurityConfig{AllowPrivateIPs: true},
			Settings: swagger.Settings{AnalyzeResponseBody: true, TimeoutMs: 5000},
		}
		r := New(cfg, nil)
		defer r.Close()
		r.analyzer = analyzer.NewRegistry(nil)

		res := r.executeGeneratedRequest(
			t.Context(),
			srv.URL, "/json-endpoint", "/json-endpoint", "POST",
			nil, nil,
			map[string]any{"file": payloads.MaliciousFileUploads[0]},
			swagger.ProfileMalicious,
			nil, nil,
			"application/json",
			nil,
		)

		require.NotNil(t, res)
		assert.Equal(t, http.StatusOK, res.Status)
		assert.Equal(t, "application/json", gotCT)
		assert.Contains(t, gotBody, `"file":`)
		for _, f := range res.AnalyzerFindings {
			assert.NotEqual(t, "swazz/unvalidated-file-upload", f.RuleID)
		}
	})

	t.Run("x-www-form-urlencoded formats UploadFile as filename and does not trigger analyzer", func(t *testing.T) {
		var gotBody string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			b, _ := io.ReadAll(r.Body)
			gotBody = string(b)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true}`))
		}))
		defer srv.Close()

		cfg := &swagger.Config{
			BaseURL:  srv.URL,
			Security: swagger.SecurityConfig{AllowPrivateIPs: true},
			Settings: swagger.Settings{AnalyzeResponseBody: true, TimeoutMs: 5000},
		}
		r := New(cfg, nil)
		defer r.Close()
		r.analyzer = analyzer.NewRegistry(nil)

		probe := payloads.MaliciousFileUploads[0]
		res := r.executeGeneratedRequest(
			t.Context(),
			srv.URL, "/form-endpoint", "/form-endpoint", "POST",
			nil, nil,
			map[string]any{"file": probe},
			swagger.ProfileMalicious,
			nil, nil,
			"application/x-www-form-urlencoded",
			nil,
		)

		require.NotNil(t, res)
		assert.Equal(t, http.StatusOK, res.Status)
		assert.Contains(t, gotBody, "file="+strings.ReplaceAll(probe.Filename, " ", "+"))
		assert.NotContains(t, gotBody, "%7B") // no raw Go struct { ... } dump
		for _, f := range res.AnalyzerFindings {
			assert.NotEqual(t, "swazz/unvalidated-file-upload", f.RuleID)
		}
	})

	t.Run("multipart nested map field is JSON-serialized", func(t *testing.T) {
		var gotMeta string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			mr, err := r.MultipartReader()
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			for {
				part, err := mr.NextPart()
				if err == io.EOF {
					break
				}
				if err != nil {
					http.Error(w, err.Error(), http.StatusBadRequest)
					return
				}
				b, _ := io.ReadAll(part)
				if part.FormName() == "meta" {
					gotMeta = string(b)
				}
			}
			w.WriteHeader(http.StatusOK)
		}))
		defer srv.Close()

		cfg := &swagger.Config{
			BaseURL:  srv.URL,
			Security: swagger.SecurityConfig{AllowPrivateIPs: true},
			Settings: swagger.Settings{AnalyzeResponseBody: false, TimeoutMs: 5000},
		}
		r := New(cfg, nil)
		defer r.Close()

		res := r.executeGeneratedRequest(
			t.Context(),
			srv.URL, "/upload-meta", "/upload-meta", "POST",
			nil, nil,
			map[string]any{
				"meta": map[string]any{"tag": "avatar", "public": true},
				"file": payloads.ValidPNGFile(),
			},
			swagger.ProfileRandom,
			nil, nil,
			"multipart/form-data",
			nil,
		)

		require.NotNil(t, res)
		assert.Equal(t, http.StatusOK, res.Status)
		assert.JSONEq(t, `{"public":true,"tag":"avatar"}`, gotMeta)
	})
}
