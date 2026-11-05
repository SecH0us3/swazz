// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package crawler

import (
	"context"
	"encoding/json"
	"regexp"
	"strconv"
	"sync"
	"time"

	cdpRuntime "github.com/chromedp/cdproto/runtime"
	"github.com/chromedp/chromedp"
)

const (
	// webMcpBindingName is the CDP runtime binding the page-side hook reports
	// through. A binding pushes each registration to Go the moment it happens, so
	// tools survive full-page navigations during the SPA click loop and are not
	// lost when the crawl hits its overall timeout.
	webMcpBindingName = "__swazzWebMcpReport"

	maxWebMcpSchemaBytes      = 16384
	maxWebMcpDescriptionBytes = 1024
	// maxWebMcpTools bounds how many tools one crawl will record. The target page
	// can call the binding directly, so this is the only thing keeping a hostile
	// page from flooding the sniffer.
	maxWebMcpTools = 256
)

var webMcpToolNameRx = regexp.MustCompile(`^[a-zA-Z0-9_.\-]{1,128}$`)

// webMcpSerializeJS defines __swazzSerializeTool inside the page. It is shared by
// the document-start hook and the end-of-crawl collector so both emit the same
// payload shape. An oversized or unserializable schema becomes null rather than a
// truncated (and therefore invalid) JSON string.
const webMcpSerializeJS = `
	const __swazzNameRx = /^[a-zA-Z0-9_.\-]{1,128}$/;
	const __swazzSerializeTool = (tool) => {
		try {
			if (!tool || typeof tool.name !== 'string' || !__swazzNameRx.test(tool.name)) return null;
			let schema = null;
			try {
				const s = JSON.stringify(tool.inputSchema);
				if (typeof s === 'string' && s.length <= ` + "16384" + `) schema = s;
			} catch (e) {}
			const a = (tool.annotations && typeof tool.annotations === 'object') ? tool.annotations : {};
			return JSON.stringify({
				name: tool.name,
				description: typeof tool.description === 'string' ? tool.description.slice(0, 1024) : '',
				inputSchema: schema,
				annotations: {
					consequential: Boolean(a.consequentialHint || a.consequential),
					readOnly: Boolean(a.readOnlyHint || a.readOnly)
				}
			});
		} catch (e) { return null; }
	};
`

// webMcpHookScript runs at document start in every new document. It wraps
// registerTool on navigator.modelContext / document.modelContext, including a
// polyfill installed later by the page's own bundle.
//
// It deliberately does NOT define a modelContext accessor up front: that would
// make "'modelContext' in navigator" true, and a polyfill feature-detecting that
// way would skip installing itself and break the target app. Instead it observes
// Object.defineProperty / Reflect.defineProperty (how polyfills install) and
// rechecks on DOMContentLoaded and load (catches plain assignment).
const webMcpHookScript = `(function() {
	if (window.__swazzWebMcpHooked) return;
	window.__swazzWebMcpHooked = true;
` + webMcpSerializeJS + `
	const send = (tool) => {
		try {
			const payload = __swazzSerializeTool(tool);
			const b = window.` + webMcpBindingName + `;
			if (payload && typeof b === 'function') b(payload);
		} catch (e) {}
	};
	const wrap = (mc) => {
		try {
			if (!mc || (typeof mc !== 'object' && typeof mc !== 'function')) return;
			if (typeof mc.registerTool !== 'function' || mc.__swazz_hooked) return;
			const orig = mc.registerTool;
			// Forward every argument: registerTool takes an options bag (e.g. an
			// AbortSignal for unregistration) that must reach the real implementation.
			mc.registerTool = function(tool) {
				send(tool);
				return orig.apply(this, arguments);
			};
			mc.__swazz_hooked = true;
		} catch (e) {}
	};
	const recheck = () => {
		try { wrap(navigator.modelContext); } catch (e) {}
		try { wrap(document.modelContext); } catch (e) {}
	};
	const isTarget = (obj, prop) => prop === 'modelContext' && (obj === navigator || obj === document);
	try {
		const origDefine = Object.defineProperty;
		Object.defineProperty = function defineProperty(obj, prop) {
			const r = origDefine.apply(this, arguments);
			if (isTarget(obj, prop)) recheck();
			return r;
		};
		if (typeof Reflect !== 'undefined' && typeof Reflect.defineProperty === 'function') {
			const origReflect = Reflect.defineProperty;
			Reflect.defineProperty = function defineProperty(obj, prop) {
				const r = origReflect.apply(this, arguments);
				if (isTarget(obj, prop)) recheck();
				return r;
			};
		}
	} catch (e) {}
	recheck();
	document.addEventListener('DOMContentLoaded', recheck);
	window.addEventListener('load', recheck);
})();`

// webMcpCollectScript runs once at the end of the crawl and enumerates tools the
// browser (or a polyfill) knows about, catching anything registered before the
// hook could wrap registerTool. It returns a JSON array of serialized payloads.
const webMcpCollectScript = `(async function() {
` + webMcpSerializeJS + `
	const out = [];
	for (const mc of [document.modelContext, navigator.modelContext]) {
		try {
			if (!mc) continue;
			const fn = mc.getTools || mc.listTools;
			if (typeof fn !== 'function') continue;
			const tools = await fn.call(mc);
			if (!Array.isArray(tools)) continue;
			for (const t of tools) {
				const p = __swazzSerializeTool(t);
				if (p) out.push(p);
			}
		} catch (e) {}
	}
	return JSON.stringify(out);
})()`

// webMcpToolReport is the payload produced by __swazzSerializeTool.
type webMcpToolReport struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	InputSchema *string `json:"inputSchema"`
	Annotations struct {
		Consequential bool `json:"consequential"`
		ReadOnly      bool `json:"readOnly"`
	} `json:"annotations"`
}

// webMcpToolToEndpoint validates a page-supplied payload and converts it into a
// DiscoveredEndpoint. Everything in the payload is attacker-influenced, so it
// fails closed: bad names are rejected and any schema that is not a bounded JSON
// object is replaced by "{}".
func webMcpToolToEndpoint(payload string) (DiscoveredEndpoint, bool) {
	var r webMcpToolReport
	if len(payload) > maxWebMcpSchemaBytes*2 || json.Unmarshal([]byte(payload), &r) != nil {
		return DiscoveredEndpoint{}, false
	}
	if !webMcpToolNameRx.MatchString(r.Name) {
		return DiscoveredEndpoint{}, false
	}

	schema := "{}"
	if r.InputSchema != nil && len(*r.InputSchema) <= maxWebMcpSchemaBytes {
		var obj map[string]any
		if json.Unmarshal([]byte(*r.InputSchema), &obj) == nil && obj != nil {
			schema = *r.InputSchema
		}
	}

	return DiscoveredEndpoint{
		URL:         "webmcp://tool/" + r.Name,
		Method:      "CALL",
		ContentType: "application/json",
		BodySample:  schema,
		Headers: map[string]string{
			"X-WebMCP-Consequential": strconv.FormatBool(r.Annotations.Consequential),
			"X-WebMCP-ReadOnly":      strconv.FormatBool(r.Annotations.ReadOnly),
		},
	}, true
}

// webMcpCollector deduplicates tool reports and enforces maxWebMcpTools before
// handing them to the sniffer. Safe for concurrent use from CDP event callbacks.
type webMcpCollector struct {
	mu      sync.Mutex
	seen    map[string]bool
	sniffer *Sniffer
}

func newWebMcpCollector(s *Sniffer) *webMcpCollector {
	return &webMcpCollector{seen: make(map[string]bool), sniffer: s}
}

// add records one serialized payload. It reports whether a new tool was added.
func (c *webMcpCollector) add(payload string) bool {
	ep, ok := webMcpToolToEndpoint(payload)
	if !ok {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.seen[ep.URL] || len(c.seen) >= maxWebMcpTools {
		return false
	}
	c.seen[ep.URL] = true
	c.sniffer.AddEndpoint(ep)
	return true
}

// collectWebMcpTools enumerates tools via getTools/listTools on the current page.
func (c *Crawler) collectWebMcpTools(browserCtx context.Context, collector *webMcpCollector) {
	ctx, cancel := context.WithTimeout(browserCtx, 5*time.Second)
	defer cancel()

	var raw string
	if err := chromedp.Run(ctx, chromedp.Evaluate(webMcpCollectScript, &raw, func(p *cdpRuntime.EvaluateParams) *cdpRuntime.EvaluateParams {
		return p.WithAwaitPromise(true)
	})); err != nil || raw == "" {
		return
	}
	var payloads []string
	if json.Unmarshal([]byte(raw), &payloads) != nil {
		return
	}
	for _, p := range payloads {
		collector.add(p)
	}
}
