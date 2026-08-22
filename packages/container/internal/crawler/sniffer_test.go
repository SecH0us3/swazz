// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package crawler

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/chromedp/cdproto/network"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSniffer_NoiseFiltering(t *testing.T) {
	sniffer := NewSniffer()

	// 1. Static extension blacklist
	assert.True(t, sniffer.IsNoise("http://example.com/app.js", "", "GET"))
	assert.True(t, sniffer.IsNoise("http://example.com/styles.css", "", "GET"))
	assert.True(t, sniffer.IsNoise("http://example.com/logo.png", "", "GET"))
	assert.True(t, sniffer.IsNoise("http://example.com/icon.ico", "", "GET"))
	assert.True(t, sniffer.IsNoise("http://example.com/font.woff2", "", "GET"))
	assert.True(t, sniffer.IsNoise("http://example.com/bundle.js.map", "", "GET"))
	assert.True(t, sniffer.IsNoise("http://example.com/document.pdf", "", "GET"))

	// 2. Analytics domain exclusion
	assert.True(t, sniffer.IsNoise("https://sentry.io/api/123/envelope/", "", "POST"))
	assert.True(t, sniffer.IsNoise("https://www.google-analytics.com/collect", "", "POST"))
	assert.True(t, sniffer.IsNoise("https://static.hotjar.com/c/hotjar.js", "", "GET"))

	// 3. Content-Type whitelist vs blacklist
	assert.False(t, sniffer.IsNoise("http://example.com/api/users", "application/json", "GET"))
	assert.False(t, sniffer.IsNoise("http://example.com/api/data", "application/xml", "POST"))
	assert.False(t, sniffer.IsNoise("http://example.com/graphql", "application/graphql", "POST"))
	assert.False(t, sniffer.IsNoise("http://example.com/upload", "multipart/form-data", "POST"))

	assert.True(t, sniffer.IsNoise("http://example.com/page", "text/html", "GET"))
	assert.True(t, sniffer.IsNoise("http://example.com/style", "text/css", "GET"))
	assert.True(t, sniffer.IsNoise("http://example.com/script", "application/javascript", "GET"))
}

func TestParameterizeRoute(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"/api/users/123", "/api/users/{id}"},
		{"/api/users/123/posts/456", "/api/users/{id}/posts/{id}"},
		{"/api/v1/orders/550e8400-e29b-41d4-a716-446655440000", "/api/v1/orders/{id}"},
		{"/api/items/60d5ecb8b3b3b3b3b3b3b3b3", "/api/items/{id}"},
		{"/api/v1/profile", "/api/v1/profile"},
		{"/", "/"},
		{"", ""},
	}

	for _, tt := range tests {
		result := ParameterizeRoute(tt.input)
		assert.Equal(t, tt.expected, result, "input: %s", tt.input)
	}
}

func TestSniffer_CDPEventsAndExports(t *testing.T) {
	sniffer := NewSniffer()

	// Simulate CDP EventRequestWillBeSent
	reqEvt := &network.EventRequestWillBeSent{
		RequestID: network.RequestID("req-1"),
		Request: &network.Request{
			URL:    "http://example.com/api/users/42",
			Method: "GET",
			Headers: network.Headers{
				"Accept": "application/json",
			},
		},
	}
	sniffer.OnRequestWillBeSent(reqEvt)

	// Simulate CDP EventResponseReceived
	respEvt := &network.EventResponseReceived{
		RequestID: network.RequestID("req-1"),
		Response: &network.Response{
			URL:      "http://example.com/api/users/42",
			MimeType: "application/json",
		},
	}
	sniffer.OnResponseReceived(respEvt)

	// Verify parameterization and capture
	endpoints := sniffer.GetEndpoints()
	require.Len(t, endpoints, 1)
	assert.Equal(t, "GET", endpoints[0].Method)
	assert.Equal(t, "http://example.com/api/users/{id}", endpoints[0].URL)

	// Test OpenAPI Export
	openAPIRaw, err := sniffer.ToOpenAPI()
	require.NoError(t, err)
	assert.Contains(t, string(openAPIRaw), "openapi")
	assert.Contains(t, string(openAPIRaw), "/api/users/{id}")

	var openAPIDoc map[string]interface{}
	err = json.Unmarshal(openAPIRaw, &openAPIDoc)
	require.NoError(t, err)
	assert.Equal(t, "3.0.3", openAPIDoc["openapi"])

	// Test HAR Export
	harRaw, err := sniffer.ToHAR()
	require.NoError(t, err)
	assert.Contains(t, string(harRaw), "log")
	assert.Contains(t, string(harRaw), "http://example.com/api/users/{id}")

	var harDoc map[string]interface{}
	err = json.Unmarshal(harRaw, &harDoc)
	require.NoError(t, err)
	logMap := harDoc["log"].(map[string]interface{})
	assert.Equal(t, "1.2", logMap["version"])
}

func TestConfirmDestructiveActions(t *testing.T) {
	// Test "yes" confirmation
	inYes := bytes.NewBufferString("yes\n")
	outBuf := new(bytes.Buffer)
	assert.True(t, ConfirmDestructiveActions(inYes, outBuf))
	assert.Contains(t, outBuf.String(), "WARNING")

	// Test "no" rejection
	inNo := bytes.NewBufferString("no\n")
	outBuf2 := new(bytes.Buffer)
	assert.False(t, ConfirmDestructiveActions(inNo, outBuf2))
}

func TestSniffer_CustomIgnoredPatterns(t *testing.T) {
	sniffer := NewSniffer("/admin", "logout", "token=")

	assert.True(t, sniffer.IsNoise("http://example.com/admin/dashboard", "application/json", "GET"))
	assert.True(t, sniffer.IsNoise("http://example.com/api/logout", "application/json", "POST"))
	assert.True(t, sniffer.IsNoise("http://example.com/api/data?token=12345", "application/json", "GET"))

	assert.False(t, sniffer.IsNoise("http://example.com/api/users", "application/json", "GET"))
}

func TestSniffer_AddEndpoint(t *testing.T) {
	sniffer := NewSniffer()

	ep := DiscoveredEndpoint{
		URL:         "http://example.com/api/items/999",
		Method:      "POST",
		Headers:     map[string]string{"Authorization": "Bearer token"},
		QueryParams: map[string]string{"verbose": "true"},
		BodySample:  `{"item":"widget"}`,
		ContentType: "application/json",
	}

	sniffer.AddEndpoint(ep)

	endpoints := sniffer.GetEndpoints()
	require.Len(t, endpoints, 1)
	assert.Equal(t, "POST", endpoints[0].Method)
	assert.Equal(t, "http://example.com/api/items/{id}", endpoints[0].URL)
	assert.Equal(t, `{"item":"widget"}`, endpoints[0].BodySample)
	assert.Equal(t, map[string]string{"verbose": "true"}, endpoints[0].QueryParams)
}

func TestSniffer_QueryParamsAndBodySample(t *testing.T) {
	sniffer := NewSniffer()

	reqEvt := &network.EventRequestWillBeSent{
		RequestID: network.RequestID("req-2"),
		Request: &network.Request{
			URL:    "http://example.com/api/search?q=test&page=1",
			Method: "POST",
			Headers: network.Headers{
				"Content-Type": "application/json",
			},
			PostDataEntries: []*network.PostDataEntry{
				{Bytes: `{"filter":"active"}`},
			},
		},
	}
	sniffer.OnRequestWillBeSent(reqEvt)

	endpoints := sniffer.GetEndpoints()
	require.Len(t, endpoints, 1)
	ep := endpoints[0]
	assert.Equal(t, "POST", ep.Method)
	assert.Equal(t, "http://example.com/api/search", ep.URL)
	assert.Equal(t, map[string]string{"q": "test", "page": "1"}, ep.QueryParams)
	assert.Equal(t, `{"filter":"active"}`, ep.BodySample)

	// Test OpenAPI export with query params and body sample
	openAPIRaw, err := sniffer.ToOpenAPI()
	require.NoError(t, err)
	openAPIStr := string(openAPIRaw)
	assert.Contains(t, openAPIStr, "q")
	assert.Contains(t, openAPIStr, "page")
	assert.Contains(t, openAPIStr, "filter")

	// Test HAR export with query params and body sample
	harRaw, err := sniffer.ToHAR()
	require.NoError(t, err)
	harStr := string(harRaw)
	assert.Contains(t, harStr, "q")
	assert.Contains(t, harStr, "page")
	assert.Contains(t, harStr, "filter")
}


func TestDefaultCrawlerConfig(t *testing.T) {
	cfg := DefaultCrawlerConfig()

	assert.True(t, cfg.Enabled)
	assert.True(t, cfg.Headless)
	assert.Equal(t, 3, cfg.MaxDepth)
	assert.Equal(t, 3, cfg.MaxClicksPerUrl)
	assert.Equal(t, 50, cfg.MaxPages)
	assert.Equal(t, 30, cfg.TimeoutPerPage)
	assert.Equal(t, 512, cfg.MemoryLimitMB)
	assert.NotNil(t, cfg.Cookies)
	assert.NotNil(t, cfg.Headers)
}


func TestSniffer_OnResponseReceived_EdgeCases(t *testing.T) {
	sniffer := NewSniffer()
	
	// Test nil events
	sniffer.OnResponseReceived(nil)
	sniffer.OnResponseReceived(&network.EventResponseReceived{Response: nil})
	
	// Test IsNoise true
	reqEvt := &network.EventRequestWillBeSent{
		RequestID: network.RequestID("req-noise"),
		Request: &network.Request{
			URL:    "http://example.com/style.css",
			Method: "GET",
		},
	}
	sniffer.OnRequestWillBeSent(reqEvt)
	
	respEvt := &network.EventResponseReceived{
		RequestID: network.RequestID("req-noise"),
		Response: &network.Response{
			URL:      "http://example.com/style.css",
			MimeType: "text/css",
		},
	}
	sniffer.OnResponseReceived(respEvt)
	
	endpoints := sniffer.GetEndpoints()
	assert.Len(t, endpoints, 0)
}

func TestSniffer_GetEndpoints_Sorting(t *testing.T) {
	sniffer := NewSniffer()
	
	sniffer.AddEndpoint(DiscoveredEndpoint{URL: "http://example.com/b", Method: "POST"})
	sniffer.AddEndpoint(DiscoveredEndpoint{URL: "http://example.com/a", Method: "GET"})
	sniffer.AddEndpoint(DiscoveredEndpoint{URL: "http://example.com/b", Method: "GET"})
	
	endpoints := sniffer.GetEndpoints()
	require.Len(t, endpoints, 3)
	assert.Equal(t, "http://example.com/a", endpoints[0].URL)
	assert.Equal(t, "GET", endpoints[0].Method)
	
	assert.Equal(t, "http://example.com/b", endpoints[1].URL)
	assert.Equal(t, "GET", endpoints[1].Method)
	
	assert.Equal(t, "http://example.com/b", endpoints[2].URL)
	assert.Equal(t, "POST", endpoints[2].Method)
}

func TestSniffer_IsAllowedContentType_Extra(t *testing.T) {
	assert.True(t, IsAllowedContentType("text/xml"))
	assert.True(t, IsAllowedContentType("application/x-www-form-urlencoded"))
	assert.True(t, IsAllowedContentType("form-data"))
	assert.True(t, IsAllowedContentType(""))
}

func TestSniffer_Exports_EdgeCases(t *testing.T) {
	sniffer := NewSniffer()
	
	ep1 := DiscoveredEndpoint{
		URL:    "http://example.com", // empty path
		Method: "",                   // empty method
	}
	ep2 := DiscoveredEndpoint{
		URL:         ":://invalid-url",
		Method:      "POST",
		BodySample:  "some-body",
		ContentType: "", // should default to application/json in ToOpenAPI, but it's not valid JSON
	}
	
	sniffer.AddEndpoint(ep1)
	sniffer.AddEndpoint(ep2)
	
	openAPIRaw, err := sniffer.ToOpenAPI()
	require.NoError(t, err)
	assert.Contains(t, string(openAPIRaw), "openapi")
	
	harRaw, err := sniffer.ToHAR()
	require.NoError(t, err)
	assert.Contains(t, string(harRaw), "log")
}

func TestSniffer_IsNoise_EdgeCases(t *testing.T) {
	// invalid URLs
	assert.False(t, IsStaticBlacklist(":\x00://invalid"))
	assert.False(t, IsAnalyticsDomain(":\x00://invalid"))
}

func TestSniffer_IsAllowedContentType_Blacklist(t *testing.T) {
	assert.False(t, IsAllowedContentType("application/x-javascript"))
	assert.False(t, IsAllowedContentType("text/javascript"))
	assert.False(t, IsAllowedContentType("image/png"))
	assert.False(t, IsAllowedContentType("font/woff2"))
	assert.False(t, IsAllowedContentType("audio/mp3"))
	assert.False(t, IsAllowedContentType("video/mp4"))
	// unknown type is allowed
	assert.True(t, IsAllowedContentType("application/unknown"))
}

func TestSniffer_OnRequestWillBeSent_EdgeCases(t *testing.T) {
	sniffer := NewSniffer()
	
	sniffer.OnRequestWillBeSent(nil)
	sniffer.OnRequestWillBeSent(&network.EventRequestWillBeSent{Request: nil})
	
	sniffer.OnRequestWillBeSent(&network.EventRequestWillBeSent{
		Request: &network.Request{
			URL:    ":\x00://invalid",
			Method: "GET",
		},
	})
	
	sniffer.OnRequestWillBeSent(&network.EventRequestWillBeSent{
		Request: &network.Request{
			URL:    "/relative-path-no-host",
			Method: "GET",
		},
	})
}

func TestSniffer_OnResponseReceived_BecomesNoise(t *testing.T) {
	sniffer := NewSniffer()
	
	reqEvt := &network.EventRequestWillBeSent{
		RequestID: network.RequestID("req-late-noise"),
		Request: &network.Request{
			URL:    "http://example.com/unknown-endpoint",
			Method: "GET",
		},
	}
	// Initially not noise (no mime type, not in blacklist)
	sniffer.OnRequestWillBeSent(reqEvt)
	
	// Ensure it was added
	assert.Len(t, sniffer.GetEndpoints(), 1)
	
	respEvt := &network.EventResponseReceived{
		RequestID: network.RequestID("req-late-noise"),
		Response: &network.Response{
			URL:      "http://example.com/unknown-endpoint",
			MimeType: "text/css", // Makes it noise
		},
	}
	sniffer.OnResponseReceived(respEvt)
	
	// Should have been deleted
	assert.Len(t, sniffer.GetEndpoints(), 0)
}
