// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"swazz-engine/internal/analyzer"
	"swazz-engine/internal/autochain"
	"swazz-engine/internal/safenet"
	"swazz-engine/internal/swagger"
)

const (
	maxUploadFollowUpsPerRun = 64
	maxFollowUpsPerUpload    = 2
)

var uploadURLFieldNames = map[string]bool{
	"url":          true,
	"fileurl":      true,
	"file_url":     true,
	"downloadurl":  true,
	"download_url": true,
	"previewurl":   true,
	"preview_url":  true,
	"thumbnailurl": true,
	"thumbnail":    true,
	"href":         true,
	"path":         true,
}

var uploadIDFieldNames = map[string]bool{
	"id":        true,
	"fileid":    true,
	"file_id":   true,
	"uploadid":  true,
	"upload_id": true,
	"key":       true,
	"uuid":      true,
}

func (r *Runner) maybeVerifyUploadedFile(
	ctx context.Context,
	client *http.Client,
	baseURL string,
	reqURL *url.URL,
	originalPath, method string,
	mergedHeaders map[string]string,
	cookies map[string]string,
	payload any,
	profile swagger.FuzzingProfile,
	respHeaders http.Header,
	respBody any,
	result *swagger.FuzzResult,
) {
	if client == nil || result == nil || ctx.Err() != nil || r.stopped() {
		return
	}
	if r.uploadFollowUpCount.Load() >= maxUploadFollowUpsPerRun {
		return
	}
	probeKeys := collectVerifiableProbeKeys(payload)
	if len(probeKeys) == 0 {
		return
	}
	baseParsed, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil || baseParsed.Scheme == "" || baseParsed.Host == "" {
		return
	}

	candidates := r.collectUploadFollowUpURLs(baseParsed, reqURL, originalPath, method, respHeaders, respBody)
	if len(candidates) == 0 {
		return
	}

	r.configMu.RLock()
	timeoutMs := r.config.Settings.TimeoutMs
	settings := r.config.Settings
	r.configMu.RUnlock()
	if timeoutMs <= 0 {
		timeoutMs = 10000
	}

	kindKey := strings.Join(probeKeys, ",")
	fa := &analyzer.FileUploadAnalyzer{}

	for _, targetURL := range candidates {
		if ctx.Err() != nil || r.stopped() {
			return
		}
		dedupKey := targetURL + "|" + kindKey
		if _, loaded := r.uploadFollowUpSeen.LoadOrStore(dedupKey, struct{}{}); loaded {
			continue
		}
		if r.uploadFollowUpCount.Add(1) > maxUploadFollowUpsPerRun {
			return
		}

		parsedTarget, parseErr := url.Parse(targetURL)
		if parseErr != nil {
			continue
		}
		status, fHeaders, fBody, ok := r.fetchUploadFollowUp(ctx, client, baseParsed, targetURL, mergedHeaders, cookies, timeoutMs)
		if !ok {
			continue
		}

		input := analyzer.AcquireInput(analyzer.AnalysisInput{
			SentPayload:       payload,
			ResponseBody:      fBody,
			ResponseHeaders:   fHeaders,
			Profile:           profile,
			Endpoint:          originalPath,
			Method:            method,
			StatusCode:        status,
			FileUploadSent:    true,
			FollowUpSourceURL: "GET " + parsedTarget.RequestURI(),
			Settings:          settings,
		})
		followUpFindings := fa.Analyze(input)
		analyzer.ReleaseInput(input)

		if len(followUpFindings) > 0 {
			result.AnalyzerFindings = mergeFollowUpFindings(result.AnalyzerFindings, followUpFindings)
		}
	}
}

func (r *Runner) fetchUploadFollowUp(
	ctx context.Context,
	client *http.Client,
	baseParsed *url.URL,
	targetURL string,
	mergedHeaders map[string]string,
	cookies map[string]string,
	timeoutMs int,
) (int, http.Header, []byte, bool) {
	reqCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, targetURL, nil)
	if err != nil {
		return 0, nil, nil, false
	}
	for k, v := range mergedHeaders {
		if strings.EqualFold(k, "content-type") || strings.EqualFold(k, "content-length") || strings.EqualFold(k, "cookie") {
			continue
		}
		if strings.EqualFold(k, "host") {
			req.Host = v
		} else {
			req.Header.Set(k, v)
		}
	}
	for k, v := range cookies {
		req.AddCookie(&http.Cookie{Name: k, Value: v}) // #nosec G124
	}

	followClient := *client
	followClient.CheckRedirect = func(redirReq *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return http.ErrUseLastResponse
		}
		if redirReq.URL == nil || redirReq.URL.User != nil ||
			!strings.EqualFold(redirReq.URL.Scheme, baseParsed.Scheme) ||
			!strings.EqualFold(redirReq.URL.Host, baseParsed.Host) {
			return http.ErrUseLastResponse
		}
		return nil
	}

	// codeql[go/request-forgery] false positive: targetURL and redirects are strictly validated as same-origin with baseURL
	resp, err := followClient.Do(req)
	if err != nil {
		return 0, nil, nil, false
	}
	defer resp.Body.Close() // #nosec G104

	buf := bufPool.Get().(*bytes.Buffer)
	buf.Reset()
	_, _ = io.Copy(buf, io.LimitReader(resp.Body, 51200))
	raw := bytes.Clone(buf.Bytes())
	PutBuffer(buf)
	safenet.DrainBody(resp.Body, maxResponseRead-int64(len(raw)))

	return resp.StatusCode, resp.Header, raw, true
}

func (r *Runner) collectUploadFollowUpURLs(
	baseParsed, reqURL *url.URL,
	originalPath, method string,
	respHeaders http.Header,
	respBody any,
) []string {
	var out []string
	seen := make(map[string]bool)
	add := func(raw string) {
		if len(out) >= maxFollowUpsPerUpload {
			return
		}
		resolved, ok := sameOriginURL(baseParsed, reqURL, originalPath, raw)
		if !ok || seen[resolved] {
			return
		}
		seen[resolved] = true
		out = append(out, resolved)
	}

	for _, u := range extractUploadResponseURLs(respHeaders, respBody) {
		add(u)
	}
	if len(out) < maxFollowUpsPerUpload {
		for _, u := range r.extractAutoChainFollowUpURLs(baseParsed, originalPath, method, respHeaders, respBody) {
			add(u)
		}
	}
	return out
}

func sameOriginURL(baseParsed, reqURL *url.URL, uploadPath, rawCandidate string) (string, bool) {
	trimmed := strings.TrimSpace(rawCandidate)
	if trimmed == "" {
		return "", false
	}
	// Only follow relative paths (excluding protocol-relative //) or explicit http(s) URLs.
	if strings.HasPrefix(trimmed, "//") {
		return "", false
	}
	ref, err := url.Parse(trimmed)
	if err != nil {
		return "", false
	}
	if ref.Scheme != "" && !strings.EqualFold(ref.Scheme, "http") && !strings.EqualFold(ref.Scheme, "https") {
		return "", false
	}
	if ref.User != nil {
		return "", false
	}
	var resolved *url.URL
	if ref.IsAbs() {
		if !strings.EqualFold(ref.Scheme, baseParsed.Scheme) || !strings.EqualFold(ref.Host, baseParsed.Host) {
			return "", false
		}
		resolved = ref
	} else {
		resolveAgainst := baseParsed
		if reqURL != nil && reqURL.Scheme != "" && reqURL.Host != "" {
			resolveAgainst = reqURL
		}
		resolved = resolveAgainst.ResolveReference(ref)
		if !strings.EqualFold(resolved.Scheme, baseParsed.Scheme) || !strings.EqualFold(resolved.Host, baseParsed.Host) {
			return "", false
		}
	}
	if resolved.Path == "" || resolved.Path == "/" {
		return "", false
	}
	fullUploadPath := strings.TrimRight(baseParsed.Path, "/") + "/" + strings.TrimLeft(uploadPath, "/")
	if (resolved.Path == uploadPath || resolved.Path == fullUploadPath) && resolved.RawQuery == "" {
		return "", false
	}
	return resolved.String(), true
}

func extractUploadResponseURLs(headers http.Header, respBody any) []string {
	var urls []string
	if headers != nil {
		if loc := strings.TrimSpace(headers.Get("Location")); loc != "" {
			urls = append(urls, loc)
		}
	}
	if m, ok := respBody.(map[string]any); ok {
		collectURLFieldsFromMap(m, 0, &urls)
	}
	return urls
}

func collectURLFieldsFromMap(m map[string]any, depth int, out *[]string) {
	if depth > 1 || m == nil {
		return
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		v := m[k]
		lower := strings.ToLower(k)
		if s, ok := v.(string); ok && uploadURLFieldNames[lower] {
			if strings.HasPrefix(s, "/") || strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
				*out = append(*out, s)
			}
			continue
		}
		if sub, ok := v.(map[string]any); ok {
			if lower == "data" || lower == "file" || lower == "result" || lower == "upload" {
				collectURLFieldsFromMap(sub, depth+1, out)
			}
		}
	}
}

func (r *Runner) extractAutoChainFollowUpURLs(
	baseParsed *url.URL,
	originalPath, method string,
	respHeaders http.Header,
	respBody any,
) []string {
	st := r.chain.Load()
	if st == nil || st.plan == nil {
		return nil
	}
	prodIdx, ok := st.index[strings.ToUpper(method)+" "+originalPath]
	if !ok || prodIdx >= len(st.plan.Producers) {
		return nil
	}
	ids := extractUploadResponseIDs(respHeaders, respBody)
	if len(ids) == 0 {
		return nil
	}

	producedKeys := make(map[string]bool)
	for _, rule := range st.plan.Producers[prodIdx] {
		producedKeys[rule.PoolKey] = true
	}

	var urls []string
	for consIdx, consEP := range st.plan.Ordered {
		if !strings.EqualFold(consEP.Method, http.MethodGet) || consIdx >= len(st.plan.Bindings) {
			continue
		}
		bindings := st.plan.Bindings[consIdx]
		matched := false
		for _, b := range bindings {
			if b.PrimaryProd == prodIdx || producedKeys[b.PoolKey] {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}

		for _, idVal := range ids {
			builtPath := consEP.Path
			query := url.Values{}
			for _, b := range bindings {
				if b.PrimaryProd != prodIdx && !producedKeys[b.PoolKey] {
					continue
				}
				if len(b.ParamPath) == 0 {
					continue
				}
				paramName := b.ParamPath[len(b.ParamPath)-1]
				switch b.Location {
				case autochain.LocPath:
					builtPath = strings.ReplaceAll(builtPath, "{"+paramName+"}", url.PathEscape(idVal))
				case autochain.LocQuery:
					query.Set(paramName, idVal)
				}
			}
			if strings.Contains(builtPath, "{") {
				continue
			}
			u := *baseParsed
			u.Path = strings.TrimRight(baseParsed.Path, "/") + "/" + strings.TrimLeft(builtPath, "/")
			if len(query) > 0 {
				u.RawQuery = query.Encode()
			}
			urls = append(urls, u.String())
		}
	}
	return urls
}

func extractUploadResponseIDs(headers http.Header, respBody any) []string {
	var ids []string
	seen := make(map[string]bool)
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" || len(s) > 128 || seen[s] {
			return
		}
		seen[s] = true
		ids = append(ids, s)
	}

	if m, ok := respBody.(map[string]any); ok {
		collectIDFieldsFromMap(m, 0, add)
	}
	if headers != nil {
		if loc := strings.TrimSpace(headers.Get("Location")); loc != "" {
			if parsed, err := url.Parse(loc); err == nil {
				segs := strings.Split(strings.Trim(parsed.Path, "/"), "/")
				if len(segs) > 0 {
					add(segs[len(segs)-1])
				}
			}
		}
	}
	return ids
}

func collectIDFieldsFromMap(m map[string]any, depth int, add func(string)) {
	if depth > 1 || m == nil {
		return
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		v := m[k]
		lower := strings.ToLower(k)
		if uploadIDFieldNames[lower] {
			switch tv := v.(type) {
			case string:
				add(tv)
			case float64:
				add(strconv.FormatInt(int64(tv), 10))
			case int64:
				add(strconv.FormatInt(tv, 10))
			case int:
				add(strconv.Itoa(tv))
			}
			continue
		}
		if sub, ok := v.(map[string]any); ok {
			if lower == "data" || lower == "file" || lower == "result" || lower == "upload" {
				collectIDFieldsFromMap(sub, depth+1, add)
			}
		}
	}
}

func collectVerifiableProbeKeys(v any) []string {
	var keys []string
	seen := make(map[string]bool)
	var walk func(any)
	walk = func(cur any) {
		switch tv := cur.(type) {
		case swagger.UploadFile:
			k := tv.Filename + ":" + tv.ProbeKind
			if isVerifiableProbeKind(tv.ProbeKind) && !seen[k] {
				seen[k] = true
				keys = append(keys, k)
			}
		case *swagger.UploadFile:
			if tv != nil {
				k := tv.Filename + ":" + tv.ProbeKind
				if isVerifiableProbeKind(tv.ProbeKind) && !seen[k] {
					seen[k] = true
					keys = append(keys, k)
				}
			}
		case map[string]any:
			for _, item := range tv {
				walk(item)
			}
		case []any:
			for _, item := range tv {
				walk(item)
			}
		}
	}
	walk(v)
	sort.Strings(keys)
	return keys
}

func isVerifiableProbeKind(kind string) bool {
	return kind == "svg_upload_probe" ||
		// svg_oob_probe has no synchronous analyzer finding, but a follow-up GET triggers lazy
		// server-side SVG rendering so background OOB SSRF callbacks fire.
		kind == "svg_oob_probe" ||
		kind == "traversal_filename" ||
		kind == "eicar_av_probe" ||
		kind == "null_byte_filename" ||
		kind == "rtl_override_filename" ||
		kind == "gif_polyglot_probe" ||
		kind == "png_metadata_canary" ||
		strings.HasPrefix(kind, "mime_mismatch_") ||
		strings.HasPrefix(kind, "truncated_")
}

func mergeFollowUpFindings(existing, followUp []swagger.AnalysisFinding) []swagger.AnalysisFinding {
	out := make([]swagger.AnalysisFinding, len(existing))
	copy(out, existing)
	for _, f := range followUp {
		replaced := false
		for i := range out {
			if out[i].RuleID == f.RuleID && out[i].Level != "error" && sameEvidenceProbe(out[i].Evidence, f.Evidence) {
				out[i] = f
				replaced = true
				break
			}
		}
		if !replaced {
			out = append(out, f)
		}
	}
	return out
}

func sameEvidenceProbe(a, b string) bool {
	fa, fb := extractEvidenceTag(a, "Filename: "), extractEvidenceTag(b, "Filename: ")
	pa, pb := extractEvidenceTag(a, "ProbeKind: "), extractEvidenceTag(b, "ProbeKind: ")
	if fa != "" && fb != "" && fa != fb {
		return false
	}
	if pa != "" && pb != "" && pa != pb {
		return false
	}
	return true
}

func extractEvidenceTag(evidence, prefix string) string {
	idx := strings.Index(evidence, prefix)
	if idx < 0 {
		return ""
	}
	rest := evidence[idx+len(prefix):]
	if sep := strings.Index(rest, " | "); sep >= 0 {
		return rest[:sep]
	}
	return rest
}
