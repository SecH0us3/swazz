// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"bytes"
	"fmt"
	"net/http"
	"testing"

	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/swagger"
)

// benchJSONBody is a ~50 KiB clean JSON list response: the size the HTTP executor caps a body at,
// with the null values and status/role fields a typical API returns and no vulnerability markers.
func benchJSONBody() []byte {
	var b bytes.Buffer
	b.WriteString(`{"status":"ok","items":[`)
	for i := 0; b.Len() < 50*1024; i++ {
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, `{"id":%d,"name":"Item %d","role":"member","description":"A regular catalogue entry with some text","parent":null,"price":%d.99,"tags":["alpha","beta"]}`, i, i, i%100)
	}
	b.WriteString(`]}`)
	return b.Bytes()
}

// benchHTMLBody is a ~50 KiB clean HTML page.
func benchHTMLBody() []byte {
	var b bytes.Buffer
	b.WriteString(`<!doctype html><html><head><title>Catalogue</title></head><body><ul>`)
	for i := 0; b.Len() < 50*1024; i++ {
		fmt.Fprintf(&b, `<li class="item"><a href="/items/%d">Item %d</a> <span>A regular catalogue entry</span></li>`, i, i)
	}
	b.WriteString(`</ul></body></html>`)
	return b.Bytes()
}

// benchSentPayload is a nested request body carrying malicious strings, like a MALICIOUS iteration's.
func benchSentPayload() any {
	return map[string]any{
		"name":    payloads.MaliciousXSS[0],
		"comment": payloads.MaliciousSQLi[0],
		"status":  "active",
		"profile": map[string]any{
			"bio":   payloads.MaliciousXSS[1],
			"links": []any{"https://example.com", payloads.MaliciousPathTraversal[0]},
		},
	}
}

func benchmarkRegistry(b *testing.B, body []byte, contentType string, profile swagger.FuzzingProfile) {
	reg := NewRegistry(nil)
	headers := http.Header{"Content-Type": []string{contentType}}
	settings := swagger.DefaultSettings()
	payload := benchSentPayload()
	b.SetBytes(int64(len(body)))
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		input := &AnalysisInput{
			SentPayload:     payload,
			ResponseBody:    body,
			ResponseHeaders: headers,
			Duration:        20,
			Profile:         profile,
			Endpoint:        "/items",
			Method:          "POST",
			ResponseSize:    int64(len(body)),
			Settings:        settings,
		}
		_ = reg.Analyze(input)
	}
}

func BenchmarkRegistryAnalyze_JSON50K_Malicious(b *testing.B) {
	benchmarkRegistry(b, benchJSONBody(), "application/json", swagger.ProfileMalicious)
}

func BenchmarkRegistryAnalyze_JSON50K_Random(b *testing.B) {
	benchmarkRegistry(b, benchJSONBody(), "application/json", swagger.ProfileRandom)
}

func BenchmarkRegistryAnalyze_HTML50K_Malicious(b *testing.B) {
	benchmarkRegistry(b, benchHTMLBody(), "text/html; charset=utf-8", swagger.ProfileMalicious)
}
