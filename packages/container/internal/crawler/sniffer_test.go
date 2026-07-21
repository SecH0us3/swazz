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

