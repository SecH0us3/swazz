// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package crawler

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWebMcpToolToEndpoint(t *testing.T) {
	ep, ok := webMcpToolToEndpoint(`{"name":"delete_account","description":"d","inputSchema":"{\"type\":\"object\",\"properties\":{\"confirm\":{\"type\":\"boolean\"}}}","annotations":{"consequential":true,"readOnly":false}}`)
	require.True(t, ok)
	assert.Equal(t, "webmcp://tool/delete_account", ep.URL)
	assert.Equal(t, "CALL", ep.Method)
	assert.JSONEq(t, `{"type":"object","properties":{"confirm":{"type":"boolean"}}}`, ep.BodySample)
	assert.Equal(t, "true", ep.Headers["X-WebMCP-Consequential"])
	assert.Equal(t, "false", ep.Headers["X-WebMCP-ReadOnly"])
}

func TestWebMcpToolToEndpoint_FailsClosed(t *testing.T) {
	// Rejected outright.
	for _, p := range []string{
		``,
		`not json`,
		`{"name":"../../etc/passwd"}`,
		`{"name":"a b"}`,
		`{"name":"` + strings.Repeat("a", 129) + `"}`,
	} {
		_, ok := webMcpToolToEndpoint(p)
		assert.False(t, ok, "payload %q must be rejected", p)
	}

	// Accepted, but any schema that is not a bounded JSON object becomes "{}".
	for _, schema := range []string{
		`null`,
		`"\"a string\""`,
		`"[1,2,3]"`,
		`"{\"type\":\"obj"`, // truncated JSON
		`"` + strings.Repeat("x", maxWebMcpSchemaBytes+1) + `"`,
	} {
		ep, ok := webMcpToolToEndpoint(`{"name":"t","inputSchema":` + schema + `}`)
		require.True(t, ok)
		assert.Equal(t, "{}", ep.BodySample, "schema %.40q", schema)
	}
}

func TestWebMcpCollector_DedupAndCap(t *testing.T) {
	s := NewSniffer()
	c := newWebMcpCollector(s)

	assert.True(t, c.add(`{"name":"dup"}`))
	assert.False(t, c.add(`{"name":"dup"}`))

	for i := 0; i < maxWebMcpTools+50; i++ {
		c.add(fmt.Sprintf(`{"name":"tool_%d"}`, i))
	}
	assert.Len(t, s.GetEndpoints(), maxWebMcpTools, "a hostile page must not flood the sniffer")
}

// TestCrawl_WebMCPDiscovery drives a real Chrome against a page whose polyfill
// (1) feature-detects with "'modelContext' in navigator", (2) installs itself with
// Object.defineProperty after document start, (3) exposes no getTools, and
// (4) needs the second registerTool argument. Only the binding-based hook can
// capture the tool, and the page must keep working.
func TestCrawl_WebMCPDiscovery(t *testing.T) {
	if testing.Short() {
		t.Skip("launches Chrome")
	}
	if _, err := CheckChromeExecutable(); err != nil {
		t.Skip("Chrome not available")
	}

	const page = `<!doctype html><html><body><p>webmcp</p><script>
(function () {
  if ('modelContext' in navigator) {
    window.__native = true;
  } else {
    Object.defineProperty(navigator, 'modelContext', {
      configurable: true,
      value: { registerTool: function (tool, opts) { window.__opts = opts; } }
    });
  }
  const mc = navigator.modelContext;
  if (!mc) { document.title = 'BROKEN'; return; }
  mc.registerTool({
    name: 'search_data',
    description: 'Search',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    annotations: { readOnlyHint: true },
    execute: async function () { return { content: [] }; }
  }, { signal: new AbortController().signal });
  if (!window.__native && !(window.__opts && window.__opts.signal)) {
    mc.registerTool({ name: 'opts_dropped', description: 'x', execute: async function () { return { content: [] }; } });
  }
})();
</script></body></html>`

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte(page))
	}))
	defer srv.Close()

	cfg := DefaultCrawlerConfig()
	cfg.Headless = true
	cfg.MaxPages = 1
	cfg.TimeoutPerPage = 20
	sniffer := NewSniffer()

	// Room for every browser start attempt plus the page budget.
	startBudget := browserStartAttempts * (browserStartTimeout + 10*time.Second)
	ctx, cancel := context.WithTimeout(context.Background(), startBudget+time.Duration(cfg.TimeoutPerPage)*time.Second+10*time.Second)
	defer cancel()
	res, err := NewCrawler(cfg, sniffer).Crawl(ctx, srv.URL)
	require.NoError(t, err)

	byURL := map[string]DiscoveredEndpoint{}
	for _, ep := range res.Endpoints {
		byURL[ep.URL] = ep
	}
	ep, ok := byURL["webmcp://tool/search_data"]
	require.True(t, ok, "tool registered by a late polyfill must be discovered; got %v", res.Endpoints)
	assert.Equal(t, "CALL", ep.Method)
	assert.Contains(t, ep.BodySample, `"q"`)
	assert.Equal(t, "true", ep.Headers["X-WebMCP-ReadOnly"])
	_, dropped := byURL["webmcp://tool/opts_dropped"]
	assert.False(t, dropped, "the hook must forward registerTool's options argument")
}
