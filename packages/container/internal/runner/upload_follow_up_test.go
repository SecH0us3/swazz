// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/swagger"
)

func TestUploadFollowUpHelpers_SameOriginAndExtraction(t *testing.T) {
	baseParsed, err := url.Parse("https://api.example.com/v1")
	require.NoError(t, err)

	// Same-origin relative and absolute URLs are allowed
	u1, ok := sameOriginURL(baseParsed, nil, "/files", "/files/42")
	require.True(t, ok)
	assert.Equal(t, "https://api.example.com/files/42", u1)

	reqURL, _ := url.Parse("https://api.example.com/v1/files/")
	uRel, ok := sameOriginURL(baseParsed, reqURL, "/files", "123")
	require.True(t, ok)
	assert.Equal(t, "https://api.example.com/v1/files/123", uRel)

	u2, ok := sameOriginURL(baseParsed, nil, "/files", "https://api.example.com/thumbs/42?size=sm")
	require.True(t, ok)
	assert.Equal(t, "https://api.example.com/thumbs/42?size=sm", u2)

	// Cross-origin, userinfo, protocol-relative, metadata IP, and non-HTTP schemes are strictly blocked
	for _, bad := range []string{
		"",
		"/",
		"/files",
		"/v1/files",
		"//evil.example/x",
		"https://user@api.example.com/files/42",
		"https://evil.example/files/42",
		"http://169.254.169.254/latest/meta-data/",
		"file:///etc/passwd",
		"javascript:alert(1)",
	} {
		_, allowed := sameOriginURL(baseParsed, nil, "/files", bad)
		assert.False(t, allowed, "expected %q to be rejected", bad)
	}

	// Response URL and ID extraction
	hdr := http.Header{"Location": []string{"/uploads/99"}}
	body := map[string]any{
		"data": map[string]any{
			"id":      "f-42",
			"fileUrl": "/cdn/f-42.svg",
		},
	}
	assert.Equal(t, []string{"/uploads/99", "/cdn/f-42.svg"}, extractUploadResponseURLs(hdr, body))
	assert.Equal(t, []string{"f-42", "99"}, extractUploadResponseIDs(hdr, body))

	// extractAutoChainFollowUpURLs supports LocQuery bindings and caps at maxFollowUpsPerUpload.
	rHelper := New(&swagger.Config{
		BaseURL: "https://api.example.com",
		Endpoints: []swagger.EndpointConfig{
			{Method: "POST", Path: "/uploads", ContentType: "multipart/form-data"},
			{
				Method:      "GET",
				Path:        "/uploads/view",
				QueryParams: map[string]*swagger.SchemaProperty{"uploadId": {Type: "string"}},
			},
			{
				Method:     "GET",
				Path:       "/uploads/{id}",
				PathParams: map[string]*swagger.SchemaProperty{"id": {Type: "string"}},
			},
			{
				Method:     "GET",
				Path:       "/uploads/{id}/preview",
				PathParams: map[string]*swagger.SchemaProperty{"id": {Type: "string"}},
			},
		},
	}, nil)
	defer rHelper.Close()
	rHelper.initAutoChain()

	collected := rHelper.collectUploadFollowUpURLs(baseParsed, nil, "/uploads", http.MethodPost, nil, map[string]any{"uploadId": "u-77"})
	require.LessOrEqual(t, len(collected), maxFollowUpsPerUpload)
	hasQueryFollowUp := false
	for _, u := range collected {
		if strings.Contains(u, "/uploads/view?uploadId=u-77") {
			hasQueryFollowUp = true
		}
	}
	assert.True(t, hasQueryFollowUp, "expected LocQuery follow-up URL, got %v", collected)

	// Dedup prevents fetching the same URL+filename+probeKind twice, while distinct filenames
	// sharing the same probeKind (swazz-probe.svg vs swazz-xss.svg) at the same fixed URL are both checked.
	var hitCount atomic.Int32
	dedupSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		hitCount.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer dedupSrv.Close()
	dedupR := New(&swagger.Config{BaseURL: dedupSrv.URL, Security: swagger.SecurityConfig{AllowPrivateIPs: true}, Settings: swagger.Settings{TimeoutMs: 2000}}, nil)
	defer dedupR.Close()
	for range 3 {
		dedupR.maybeVerifyUploadedFile(
			t.Context(), dedupR.client, dedupSrv.URL, nil, "/files", http.MethodPost,
			nil, nil,
			map[string]any{"file": swagger.UploadFile{Filename: "swazz-probe.svg", ProbeKind: "svg_upload_probe"}},
			swagger.ProfileMalicious,
			http.Header{"Location": []string{"/me/avatar"}},
			nil,
			&swagger.FuzzResult{Status: http.StatusCreated},
		)
	}
	assert.Equal(t, int32(1), hitCount.Load(), "identical follow-up URL+filename+probeKind should be deduplicated")
	dedupR.maybeVerifyUploadedFile(
		t.Context(), dedupR.client, dedupSrv.URL, nil, "/files", http.MethodPost,
		nil, nil,
		map[string]any{"file": swagger.UploadFile{Filename: "swazz-xss.svg", ProbeKind: "svg_upload_probe"}},
		swagger.ProfileMalicious,
		http.Header{"Location": []string{"/me/avatar"}},
		nil,
		&swagger.FuzzResult{Status: http.StatusCreated},
	)
	assert.Equal(t, int32(2), hitCount.Load(), "distinct filename swazz-xss.svg at same fixed URL must not be deduplicated")

	// Finding merge upgrades matching RuleID and appends new RuleIDs
	existing := []swagger.AnalysisFinding{{RuleID: "swazz/unvalidated-file-upload", Level: "warning"}}
	followUp := []swagger.AnalysisFinding{
		{RuleID: "swazz/unvalidated-file-upload", Level: "error", CWEIDs: []string{"CWE-434", "CWE-79"}},
		{RuleID: "swazz/file-parser-error", Level: "error"},
	}
	merged := mergeFollowUpFindings(existing, followUp)
	require.Len(t, merged, 2)
	assert.Equal(t, "error", merged[0].Level)
	assert.Equal(t, "swazz/file-parser-error", merged[1].RuleID)
}

func TestRunner_SecondOrderUploadVerificationEndToEnd(t *testing.T) {
	var foreignHits, redirectHits atomic.Int32
	foreignSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		foreignHits.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer foreignSrv.Close()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/files":
			mr, err := r.MultipartReader()
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			var uploadedName string
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
				if part.FormName() == "file" {
					uploadedName = part.FileName()
				}
			}
			id := "valid"
			if strings.Contains(uploadedName, "xss") {
				id = "xss-42"
			} else if strings.Contains(uploadedName, "truncated") {
				id = "trunc-7"
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":          id,
				"externalUrl": foreignSrv.URL + "/ssrf-trap",
				"url":         foreignSrv.URL + "/ssrf-trap-2",
			})
		case r.Method == http.MethodGet && r.URL.Path == "/files/xss-42":
			w.Header().Set("Content-Type", "image/svg+xml")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert('swazz-svg-xss')"><script>alert('swazz-svg-xss')</script></svg>`))
		case r.Method == http.MethodGet && r.URL.Path == "/files/trunc-7":
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`PIL.UnidentifiedImageError: cannot identify image file`))
		case r.Method == http.MethodGet && r.URL.Path == "/files/redirect-ssrf":
			redirectHits.Add(1)
			http.Redirect(w, r, foreignSrv.URL+"/redirect-target", http.StatusFound)
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/files/"):
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	spec := `{
		"openapi": "3.0.0",
		"info": {"title": "Second-Order Upload API", "version": "1.0"},
		"paths": {
			"/files": {
				"post": {
					"requestBody": {
						"content": {
							"multipart/form-data": {
								"schema": {
									"type": "object",
									"required": ["file"],
									"properties": {
										"file": {"type": "string", "format": "binary"}
									}
								}
							}
						}
					},
					"responses": {"201": {"description": "created"}}
				}
			},
			"/files/{id}": {
				"get": {
					"parameters": [
						{"name": "id", "in": "path", "required": true, "schema": {"type": "string"}}
					],
					"responses": {"200": {"description": "ok"}}
				}
			}
		}
	}`
	parsed, err := swagger.ParseRawSpec([]byte(spec))
	require.NoError(t, err)

	wafOff := false
	cfg := &swagger.Config{
		BaseURL:   srv.URL,
		Endpoints: parsed.Endpoints,
		Security:  swagger.SecurityConfig{AllowPrivateIPs: true},
		Settings: swagger.Settings{
			AnalyzeResponseBody:  true,
			EnableWAFCheck:       &wafOff,
			Concurrency:          1,
			TimeoutMs:            5000,
			IterationsPerProfile: len(payloads.MaliciousFileUploads) * 3,
			Profiles:             []swagger.FuzzingProfile{swagger.ProfileMalicious},
			PayloadCategories: map[swagger.FuzzingProfile][]string{
				swagger.ProfileMalicious: {payloads.CatMaliciousFileUpload, payloads.CatMaliciousSQLi},
			},
		},
	}

	r := New(cfg, nil)
	defer r.Close()
	require.NoError(t, r.Start(t.Context()))

	// Foreign SSRF trap URLs must never be contacted.
	assert.Equal(t, int32(0), foreignHits.Load(), "cross-origin follow-up URLs must never be fetched")

	var sawStoredXSS, sawLazyCrash bool
	for _, res := range r.Results() {
		if res.Method != http.MethodPost || res.Endpoint != "/files" {
			continue
		}
		for _, f := range res.AnalyzerFindings {
			if f.RuleID == "swazz/unvalidated-file-upload" && f.Level == "error" && strings.Contains(f.Evidence, "GET /files/xss-42") {
				for _, cwe := range f.CWEIDs {
					if cwe == "CWE-79" {
						sawStoredXSS = true
					}
				}
			}
			if f.RuleID == "swazz/file-parser-error" && strings.Contains(f.Evidence, "GET /files/trunc-7") {
				sawLazyCrash = true
			}
		}
	}
	assert.True(t, sawStoredXSS, "expected follow-up GET /files/xss-42 to confirm stored SVG XSS (CWE-79)")
	assert.True(t, sawLazyCrash, "expected follow-up GET /files/trunc-7 to detect lazy 5xx parser crash")

	// Redirect from same-origin follow-up to cross-origin URL must be blocked.
	redirectRes := &swagger.FuzzResult{Status: http.StatusCreated}
	r.maybeVerifyUploadedFile(
		t.Context(), r.client, srv.URL, nil, "/files", http.MethodPost,
		nil, nil,
		map[string]any{"file": swagger.UploadFile{Filename: "swazz-xss.svg", ContentType: "image/svg+xml", ProbeKind: "svg_upload_probe"}},
		swagger.ProfileMalicious,
		http.Header{"Location": []string{"/files/redirect-ssrf"}},
		map[string]any{"url": "/files/redirect-ssrf"},
		redirectRes,
	)
	assert.Equal(t, int32(1), redirectHits.Load(), "expected follow-up to hit /files/redirect-ssrf")
	assert.Equal(t, int32(0), foreignHits.Load(), "cross-origin redirect from follow-up must be blocked")
}

func TestRunner_SecondOrderPolyglotAndMetadataCanaries(t *testing.T) {
	var gifProbe, pngMetaProbe swagger.UploadFile
	for _, uf := range payloads.MaliciousFileUploads {
		switch uf.ProbeKind {
		case "gif_polyglot_probe":
			gifProbe = uf
		case "png_metadata_canary":
			pngMetaProbe = uf
		}
	}
	require.NotEmpty(t, gifProbe.Data)
	require.NotEmpty(t, pngMetaProbe.Data)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/upload":
			mr, err := r.MultipartReader()
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			var uploadedName string
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
				if part.FormName() == "file" {
					uploadedName = part.FileName()
				}
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			if strings.Contains(uploadedName, "polyglot") {
				_ = json.NewEncoder(w).Encode(map[string]any{"url": "/cdn/polyglot.gif"})
			} else {
				_ = json.NewEncoder(w).Encode(map[string]any{"url": "/cdn/exif.png"})
			}
		case r.Method == http.MethodGet && r.URL.Path == "/cdn/polyglot.gif":
			// Intentionally omit X-Content-Type-Options: nosniff and serve un-reencoded polyglot bytes
			w.Header().Set("Content-Type", "image/gif")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(gifProbe.Data)
		case r.Method == http.MethodGet && r.URL.Path == "/cdn/exif.png":
			// Serve PNG bytes with unstripped tEXt metadata
			w.Header().Set("Content-Type", "image/png")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(pngMetaProbe.Data)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	wafOff := false
	r := New(&swagger.Config{
		BaseURL:  srv.URL,
		Security: swagger.SecurityConfig{AllowPrivateIPs: true},
		Settings: swagger.Settings{AnalyzeResponseBody: true, EnableWAFCheck: &wafOff, TimeoutMs: 3000},
	}, nil)
	defer r.Close()

	resGif := &swagger.FuzzResult{Status: http.StatusCreated}
	r.maybeVerifyUploadedFile(
		t.Context(), r.client, srv.URL, nil, "/upload", http.MethodPost,
		nil, nil,
		map[string]any{"file": gifProbe},
		swagger.ProfileMalicious,
		nil,
		map[string]any{"url": "/cdn/polyglot.gif"},
		resGif,
	)
	require.Len(t, resGif.AnalyzerFindings, 1)
	assert.Contains(t, resGif.AnalyzerFindings[0].CWEIDs, "CWE-436")

	resExif := &swagger.FuzzResult{Status: http.StatusCreated}
	r.maybeVerifyUploadedFile(
		t.Context(), r.client, srv.URL, nil, "/upload", http.MethodPost,
		nil, nil,
		map[string]any{"file": pngMetaProbe},
		swagger.ProfileMalicious,
		nil,
		map[string]any{"url": "/cdn/exif.png"},
		resExif,
	)
	require.Len(t, resExif.AnalyzerFindings, 1)
	assert.Contains(t, resExif.AnalyzerFindings[0].CWEIDs, "CWE-212")
	assert.Equal(t, "/cdn/exif.png", resExif.AnalyzerFindings[0].FollowUpURL)
	assert.Equal(t, http.StatusOK, resExif.AnalyzerFindings[0].FollowUpStatus)

	// Disabling EnableUploadFollowUp suppresses follow-up GET requests.
	disabled := false
	rDisabled := New(&swagger.Config{
		BaseURL:  srv.URL,
		Security: swagger.SecurityConfig{AllowPrivateIPs: true},
		Settings: swagger.Settings{
			AnalyzeResponseBody:  true,
			EnableWAFCheck:       &wafOff,
			EnableUploadFollowUp: &disabled,
			TimeoutMs:            3000,
		},
	}, nil)
	defer rDisabled.Close()

	resDisabled := &swagger.FuzzResult{Status: http.StatusCreated}
	rDisabled.maybeVerifyUploadedFile(
		t.Context(), rDisabled.client, srv.URL, nil, "/upload", http.MethodPost,
		nil, nil,
		map[string]any{"file": gifProbe},
		swagger.ProfileMalicious,
		nil,
		map[string]any{"url": "/cdn/polyglot.gif"},
		resDisabled,
	)
	assert.Empty(t, resDisabled.AnalyzerFindings)
}
