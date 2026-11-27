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

func TestRunner_SmartUploadTypeProbingAndRawBinaryEndToEnd(t *testing.T) {
	var seenProbeCTs []string
	var rawBodies [][]byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/upload" {
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
				data, _ := io.ReadAll(part)
				ct := part.Header.Get("Content-Type")
				seenProbeCTs = append(seenProbeCTs, ct)
				if !strings.HasPrefix(ct, "image/") {
					w.WriteHeader(http.StatusUnsupportedMediaType)
					_, _ = w.Write([]byte(`{"error":"only images accepted"}`))
					return
				}
				if strings.Contains(part.FileName(), "truncated") && len(data) < 20 {
					w.WriteHeader(http.StatusInternalServerError)
					_, _ = w.Write([]byte(`PIL.UnidentifiedImageError: cannot identify image file`))
					return
				}
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"uploaded":true}`))
			return
		}
		if r.URL.Path == "/raw" {
			b, _ := io.ReadAll(r.Body)
			rawBodies = append(rawBodies, b)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	spec := `{
		"openapi": "3.0.0",
		"info": {"title": "Upload E2E", "version": "1.0"},
		"paths": {
			"/upload": {
				"post": {
					"requestBody": {
						"content": {
							"multipart/form-data": {
								"schema": {
									"type": "object",
									"properties": {
										"file": {"type": "string", "format": "binary"}
									}
								}
							}
						}
					},
					"responses": {"200": {"description": "ok"}}
				}
			},
			"/raw": {
				"post": {
					"requestBody": {
						"content": {
							"image/png": {
								"schema": {"type": "string", "format": "binary"}
							}
						}
					},
					"responses": {"200": {"description": "ok"}}
				}
			}
		}
	}`
	parsed, err := swagger.ParseRawSpec([]byte(spec))
	require.NoError(t, err)

	cfg := &swagger.Config{
		BaseURL:   srv.URL,
		Endpoints: parsed.Endpoints,
		Security:  swagger.SecurityConfig{AllowPrivateIPs: true},
		Settings: swagger.Settings{
			AnalyzeResponseBody:  true,
			Concurrency:          1,
			TimeoutMs:            5000,
			IterationsPerProfile: 8,
			Profiles:             []swagger.FuzzingProfile{swagger.ProfileMalicious},
			PayloadCategories: map[swagger.FuzzingProfile][]string{
				swagger.ProfileMalicious: {payloads.CatMaliciousFileUpload},
			},
		},
	}

	r := New(cfg, nil)
	defer r.Close()
	require.NoError(t, r.Start(t.Context()))

	// Smart upload probing should detect [image] on POST /upload.
	rawCats, ok := r.detectedUploadCategories.Load("POST /upload")
	require.True(t, ok, "expected smart probing to detect image category on POST /upload")
	assert.Equal(t, []payloads.FileCategory{payloads.FileCatImage}, rawCats)
	assert.NotEmpty(t, rawBodies, "expected POST /raw binary endpoint to run end-to-end")

	foundUploadVuln := false
	for _, res := range r.Results() {
		for _, f := range res.AnalyzerFindings {
			if f.RuleID == "swazz/unvalidated-file-upload" || f.RuleID == "swazz/file-parser-error" {
				foundUploadVuln = true
			}
		}
	}
	assert.True(t, foundUploadVuln, "expected end-to-end upload findings from Runner.Start")
	assert.NotEmpty(t, seenProbeCTs)
}

func TestUploadProbeAndPayloadBoundsHelpers(t *testing.T) {
	// Standalone raw binary schema hasFields == true
	rawEp := swagger.EndpointConfig{
		Method: "POST",
		Path:   "/raw",
		Schema: swagger.SchemaProperty{Type: "string", Format: "binary"},
	}
	assert.True(t, hasFields(&rawEp))

	// contentMediaType without format:binary is NOT a file upload on its own (e.g. JSON base64 strings)
	cmtEp := swagger.EndpointConfig{
		Method:      "POST",
		Path:        "/cmt",
		ContentType: "application/json",
		Schema: swagger.SchemaProperty{
			Type: "object",
			Properties: map[string]*swagger.SchemaProperty{
				"avatar": {Type: "string", AcceptedMediaTypes: []string{"image/png"}},
			},
		},
	}
	assert.False(t, hasFileUploadField(&cmtEp.Schema))
	r := New(&swagger.Config{BaseURL: "http://127.0.0.1", Settings: swagger.Settings{TimeoutMs: 1000}}, nil)
	defer r.Close()
	safeGen := r.newGenerator(swagger.ProfileRandom, "POST /cmt")
	_, directIsString := safeGen.Generate("avatar", cmtEp.Schema.Properties["avatar"]).(string)
	assert.True(t, directIsString, "JSON contentMediaType field must generate a string, not UploadFile")
	builtJSON := buildFromSchema(cmtEp, safeGen)
	if avatarVal, exists := builtJSON.body["avatar"]; exists {
		_, isUF := avatarVal.(swagger.UploadFile)
		assert.False(t, isUF, "JSON contentMediaType field must never become UploadFile")
	}

	// maybeProbeUploadCategories succeeds even when baseline body omitted the file field or set it to nil.
	probeSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		mr, err := req.MultipartReader()
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
			if part.FormName() == "file" && strings.HasPrefix(part.Header.Get("Content-Type"), "image/") {
				w.WriteHeader(http.StatusOK)
				return
			}
		}
		w.WriteHeader(http.StatusUnsupportedMediaType)
	}))
	defer probeSrv.Close()

	pr := New(&swagger.Config{
		BaseURL:  probeSrv.URL,
		Security: swagger.SecurityConfig{AllowPrivateIPs: true},
		Settings: swagger.Settings{TimeoutMs: 2000},
	}, nil)
	defer pr.Close()
	epEmptyBaseline := swagger.EndpointConfig{
		Method:      "POST",
		Path:        "/upload",
		ContentType: "multipart/form-data",
		Schema: swagger.SchemaProperty{
			Type:       "object",
			Properties: map[string]*swagger.SchemaProperty{"file": {Type: "string", Format: "binary"}},
		},
	}
	pr.maybeProbeUploadCategories(t.Context(), epEmptyBaseline, "POST /upload", "/upload", generatedPayload{body: map[string]any{"file": nil}}, http.StatusOK)
	cats, ok := pr.detectedUploadCategories.Load("POST /upload")
	require.True(t, ok, "expected smart probing to work even when baseline has file: nil")
	assert.Equal(t, []payloads.FileCategory{payloads.FileCatImage}, cats)

	// maybeProbeUploadCategories skips probing on 401/403/404/405 baseline status
	r.maybeProbeUploadCategories(t.Context(), swagger.EndpointConfig{
		Method: "POST",
		Path:   "/auth-upload",
		Schema: swagger.SchemaProperty{
			Type:       "object",
			Properties: map[string]*swagger.SchemaProperty{"file": {Type: "string", Format: "binary"}},
		},
	}, "POST /auth-upload", "/auth-upload", generatedPayload{body: map[string]any{"file": payloads.ValidPNGFile()}}, http.StatusUnauthorized)
	_, probed := r.detectedUploadCategories.Load("POST /auth-upload")
	assert.False(t, probed)

	// payloadFits accounts for rawBody UploadFile.Data bytes
	small := generatedPayload{rawBody: swagger.UploadFile{Filename: "a.bin", Data: make([]byte, 32)}}
	assert.True(t, payloadFits(small, 512))
	large := generatedPayload{rawBody: swagger.UploadFile{Filename: "big.bin", Data: make([]byte, 2048)}}
	assert.False(t, payloadFits(large, 512))
}
