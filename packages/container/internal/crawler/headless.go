// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package crawler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	sysRuntime "runtime"
	"strings"
	"sync"
	"time"

	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/page"
	cdpRuntime "github.com/chromedp/cdproto/runtime"
	"github.com/chromedp/chromedp"
)

// CheckChromeExecutable checks if Chrome/Chromium is installed on the host system.
func CheckChromeExecutable() (string, error) {
	var candidates []string
	switch sysRuntime.GOOS {
	case "darwin":
		candidates = []string{
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
			"google-chrome",
			"chromium",
			"chromium-browser",
		}
	case "windows":
		candidates = []string{
			`C:\Program Files\Google\Chrome\Application\chrome.exe`,
			`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
			`C:\Users\` + os.Getenv("USERNAME") + `\AppData\Local\Google\Chrome\Application\chrome.exe`,
			"chrome.exe",
		}
	default:
		candidates = []string{
			"google-chrome",
			"google-chrome-stable",
			"chromium",
			"chromium-browser",
			"/usr/bin/google-chrome",
			"/usr/bin/chromium",
			"/usr/bin/chromium-browser",
		}
	}

	for _, path := range candidates {
		cleanPath := filepath.Clean(path)
		if strings.Contains(cleanPath, "/") || strings.Contains(cleanPath, `\`) {
			if _, err := os.Stat(cleanPath); err == nil { // #nosec G703 -- static hardcoded candidate paths for browser detection
				return cleanPath, nil
			}
		} else {
			if execPath, err := exec.LookPath(cleanPath); err == nil {
				return execPath, nil
			}
		}
	}

	return "", fmt.Errorf("Chrome or Chromium executable not found on system. Please install Google Chrome or Chromium to use headless crawling feature")
}

// ConfirmDestructiveActions displays a high-visibility terminal warning prompt requiring explicit "yes" input.
func ConfirmDestructiveActions(r io.Reader, w io.Writer) bool {
	warning := "\n\033[1;33m⚠️  WARNING: The headless crawler will interactively trigger clicks on single-page application (SPA) elements (buttons, links, forms).\n" +
		"It may cause unwanted state mutations, trigger form submissions, send emails, or delete data on the target system.\n" +
		"DO NOT RUN THIS CRAWLER ON PRODUCTION ENVIRONMENTS!\033[0m\n\n" +
		"Type \"yes\" to confirm and proceed: "

	fmt.Fprint(w, warning)

	var answer string
	_, _ = fmt.Fscan(r, &answer) // #nosec G104

	return strings.EqualFold(strings.TrimSpace(answer), "yes")
}

// Crawler manages headless browser crawling using chromedp.
type Crawler struct {
	config  CrawlerConfig
	sniffer *Sniffer
}

// NewCrawler creates a new Crawler instance.
func NewCrawler(cfg CrawlerConfig, sniffer *Sniffer) *Crawler {
	return &Crawler{
		config:  cfg,
		sniffer: sniffer,
	}
}

// InjectCookies injects cookies into Chrome session context via chromedp.
func InjectCookies(ctx context.Context, targetURL string, cookies map[string]string) error {
	if len(cookies) == 0 {
		return nil
	}

	u, err := url.Parse(targetURL)
	if err != nil {
		return fmt.Errorf("invalid target URL for cookie injection: %w", err)
	}

	domain := u.Hostname()

	var actions []chromedp.Action
	for k, v := range cookies {
		name := k
		val := v
		actions = append(actions, chromedp.ActionFunc(func(ctx context.Context) error {
			expr := network.SetCookie(name, val).WithDomain(domain).WithPath("/")
			return expr.Do(ctx)
		}))
	}

	return chromedp.Run(ctx, actions...)
}

// Crawl executes the headless browser crawling process on the target URL.
func (c *Crawler) Crawl(ctx context.Context, targetURL string) (*CrawlerResult, error) {
	startTime := time.Now()

	execPath, err := CheckChromeExecutable()
	if err != nil {
		fmt.Printf("⚠️  Chromium Check Notice: %v\n", err)
		return nil, err
	}

	allocOpts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.ExecPath(execPath),
		chromedp.NoSandbox,
		chromedp.DisableGPU,
		chromedp.Flag("disable-extensions", true),
		chromedp.Flag("disable-dev-shm-usage", true),
		chromedp.Flag("enable-features", "WebMCP"),
	)

	if c.config.Headless {
		allocOpts = append(allocOpts, chromedp.Headless)
	}

	if c.config.MemoryLimitMB > 0 {
		allocOpts = append(allocOpts, chromedp.Flag("js-flags", fmt.Sprintf("--max-old-space-size=%d", c.config.MemoryLimitMB)))
	}

	if c.config.UserAgent != "" {
		allocOpts = append(allocOpts, chromedp.UserAgent(c.config.UserAgent))
	}

	allocCtx, allocCancel := chromedp.NewExecAllocator(ctx, allocOpts...)
	defer allocCancel()

	browserCtx, browserCancel := chromedp.NewContext(allocCtx)
	defer browserCancel()

	pageTimeout := time.Duration(c.config.TimeoutPerPage) * time.Second
	if pageTimeout <= 0 {
		pageTimeout = 30 * time.Second
	}
	runCtx, runCancel := context.WithTimeout(browserCtx, pageTimeout*time.Duration(c.config.MaxPages))
	defer runCancel()

	// Enable CDP network domain listening
	if err := chromedp.Run(runCtx, network.Enable()); err != nil {
		return nil, fmt.Errorf("failed to enable CDP network domain: %w", err)
	}

	// Inject extra HTTP headers if configured
	if len(c.config.Headers) > 0 {
		headersMap := make(network.Headers)
		for k, v := range c.config.Headers {
			headersMap[k] = v
		}
		if err := chromedp.Run(runCtx, network.SetExtraHTTPHeaders(headersMap)); err != nil {
			fmt.Printf("Warning: failed to set extra HTTP headers: %v\n", err)
		}
	}

	// Listen for CDP network events
	chromedp.ListenTarget(runCtx, func(ev interface{}) {
		switch e := ev.(type) {
		case *network.EventRequestWillBeSent:
			c.sniffer.OnRequestWillBeSent(e)
		case *network.EventResponseReceived:
			c.sniffer.OnResponseReceived(e)
		}
	})

	// Inject cookies if configured
	if len(c.config.Cookies) > 0 {
		if err := InjectCookies(runCtx, targetURL, c.config.Cookies); err != nil {
			fmt.Printf("Warning: cookie injection failed: %v\n", err)
		}
	}

	// Enable CDP page domain and inject WebMCP discovery hook
	if err := chromedp.Run(runCtx, page.Enable()); err != nil {
		fmt.Printf("Warning: failed to enable CDP page domain: %v\n", err)
	}
	hookScript := `(function() {
		if (!window.__swazz_webmcp_tools) {
			window.__swazz_webmcp_tools = [];
		}
		const wrap = (mc) => {
			if (!mc || typeof mc.registerTool !== 'function' || mc.__swazz_hooked) return;
			const orig = mc.registerTool.bind(mc);
			mc.__swazz_hooked = true;
			mc.registerTool = function(tool) {
				try {
					if (tool && typeof tool.name === 'string' && /^[a-zA-Z0-9_.\-]{1,128}$/.test(tool.name)) {
						window.__swazz_webmcp_tools.push({
							name: tool.name,
							description: typeof tool.description === 'string' ? tool.description.slice(0, 1024) : '',
							inputSchema: tool.inputSchema ? JSON.stringify(tool.inputSchema).slice(0, 16384) : '{}',
							annotations: tool.annotations ? {
								consequentialHint: Boolean(tool.annotations.consequentialHint || tool.annotations.consequential),
								readOnlyHint: Boolean(tool.annotations.readOnlyHint || tool.annotations.readOnly),
							} : null
						});
					}
				} catch (e) {}
				return orig(tool);
			};
		};
		if (typeof navigator !== 'undefined' && navigator.modelContext) wrap(navigator.modelContext);
		if (typeof document !== 'undefined' && document.modelContext) wrap(document.modelContext);
	})();`
	if err := chromedp.Run(runCtx, chromedp.ActionFunc(func(ctx context.Context) error {
		_, err := page.AddScriptToEvaluateOnNewDocument(hookScript).Do(ctx)
		return err
	})); err != nil {
		fmt.Printf("Warning: failed to inject WebMCP discovery script: %v\n", err)
	}

	// Navigate to target URL
	if err := chromedp.Run(runCtx, chromedp.Navigate(targetURL)); err != nil {
		return nil, fmt.Errorf("failed to navigate to target URL %s: %w", targetURL, err)
	}

	// SPA state tracking
	visitedURLs := make(map[string]bool)
	visitedStates := make(map[string]bool)
	clickCounts := make(map[string]int)

	pagesVisited := 0
	maxPages := c.config.MaxPages
	if maxPages <= 0 {
		maxPages = 50
	}

	maxClicks := c.config.MaxClicksPerUrl
	if maxClicks <= 0 {
		maxClicks = 3
	}

	visitedURLs[targetURL] = true
	pagesVisited++

	// Wait for initial page load scripts to execute
	time.Sleep(1 * time.Second)

	// SPA click dispatch loop
	var mu sync.Mutex
	var currentURL string

	if err := chromedp.Run(runCtx, chromedp.Location(&currentURL)); err == nil {
		_ = currentURL
	}

	// Query interactive elements: a, button, [role="button"]
	for pagesVisited < maxPages {
		select {
		case <-runCtx.Done():
			goto Done
		default:
		}

		var currLocation string
		if err := chromedp.Run(runCtx, chromedp.Location(&currLocation)); err != nil {
			break
		}

		mu.Lock()
		clicks := clickCounts[currLocation]
		if clicks >= maxClicks {
			mu.Unlock()
			break
		}
		clickCounts[currLocation] = clicks + 1
		mu.Unlock()

		// Get DOM snapshot / state hash
		var htmlContent string
		if err := chromedp.Run(runCtx, chromedp.OuterHTML("html", &htmlContent)); err == nil {
			stateHash := hashState(currLocation + htmlContent)
			if visitedStates[stateHash] {
				// State already visited, skip further clicks on this exact state
				break
			}
			visitedStates[stateHash] = true
		}

		// CDP Runtime.evaluate JS click dispatch on interactive elements
		jsScript := `
		(function() {
			const selector = 'a, button, [role="button"]';
			const elements = Array.from(document.querySelectorAll(selector));
			const visibleElements = elements.filter(el => {
				const rect = el.getBoundingClientRect();
				if (el.tagName === 'A' && el.href) {
					try {
						const url = new URL(el.href);
						if (url.origin !== window.location.origin) return false;
					} catch(e) { return false; }
				}
				return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
			});
			if (visibleElements.length === 0) return { clicked: false, total: 0 };
			const target = visibleElements[Math.floor(Math.random() * visibleElements.length)];
			try {
				target.click();
				return { clicked: true, tag: target.tagName, href: target.href || '' };
			} catch(e) {
				return { clicked: false, error: e.message };
			}
		})()
		`

		var evalRes *cdpRuntime.RemoteObject
		var exceptionRes *cdpRuntime.ExceptionDetails
		errEval := chromedp.Run(runCtx, chromedp.ActionFunc(func(ctx context.Context) error {
			var err error
			evalRes, exceptionRes, err = cdpRuntime.Evaluate(jsScript).WithReturnByValue(true).Do(ctx)
			return err
		}))

		if errEval != nil || exceptionRes != nil {
			// Click failed for this element; continue to next iteration
			continue
		}
		_ = evalRes

		// Wait briefly after click to allow SPA router / fetch requests to complete
		select {
		case <-runCtx.Done():
			goto Done
		case <-time.After(500 * time.Millisecond):
		}

		var newLoc string
		if err := chromedp.Run(runCtx, chromedp.Location(&newLoc)); err == nil {
			if newLoc != "" && !visitedURLs[newLoc] {
				visitedURLs[newLoc] = true
				pagesVisited++
			}
		}
	}

Done:
	durationMs := time.Since(startTime).Milliseconds()

	// Extract discovered WebMCP tools
	var webmcpJSON string
	evalScript := `(async function() {
		const list = Array.isArray(window.__swazz_webmcp_tools) ? [...window.__swazz_webmcp_tools] : [];
		const seen = new Set(list.map(t => t.name));
		try {
			const mc = (typeof document !== 'undefined' && document.modelContext) || (typeof navigator !== 'undefined' && navigator.modelContext);
			if (mc && typeof mc.getTools === 'function') {
				const nativeTools = await mc.getTools();
				if (Array.isArray(nativeTools)) {
					for (const t of nativeTools) {
						if (t && typeof t.name === 'string' && /^[a-zA-Z0-9_.\-]{1,128}$/.test(t.name) && !seen.has(t.name)) {
							seen.add(t.name);
							list.push({
								name: t.name,
								description: typeof t.description === 'string' ? t.description.slice(0, 1024) : '',
								inputSchema: t.inputSchema ? JSON.stringify(t.inputSchema).slice(0, 16384) : '{}',
								annotations: t.annotations ? {
									consequentialHint: Boolean(t.annotations.consequentialHint || t.annotations.consequential),
									readOnlyHint: Boolean(t.annotations.readOnlyHint || t.annotations.readOnly),
								} : null
							});
						}
					}
				}
			}
		} catch (e) {}
		return JSON.stringify(list);
	})()`
	if err := chromedp.Run(runCtx, chromedp.Evaluate(evalScript, &webmcpJSON, func(p *cdpRuntime.EvaluateParams) *cdpRuntime.EvaluateParams {
		return p.WithAwaitPromise(true)
	})); err == nil && webmcpJSON != "" {
		type mcpAnnotation struct {
			ConsequentialHint bool `json:"consequentialHint"`
			ReadOnlyHint      bool `json:"readOnlyHint"`
		}
		type mcpToolItem struct {
			Name        string         `json:"name"`
			Description string         `json:"description"`
			InputSchema string         `json:"inputSchema"`
			Annotations *mcpAnnotation `json:"annotations"`
		}
		var rawTools []mcpToolItem
		if err := json.Unmarshal([]byte(webmcpJSON), &rawTools); err == nil {
			nameRx := regexp.MustCompile(`^[a-zA-Z0-9_.\-]{1,128}$`)
			for _, t := range rawTools {
				if !nameRx.MatchString(t.Name) {
					continue
				}
				schema := t.InputSchema
				if len(schema) > 16384 {
					schema = schema[:16384]
				}
				if schema == "" {
					schema = "{}"
				}
				headers := make(map[string]string)
				if t.Annotations != nil {
					headers["X-WebMCP-Consequential"] = fmt.Sprintf("%v", t.Annotations.ConsequentialHint)
					headers["X-WebMCP-ReadOnly"] = fmt.Sprintf("%v", t.Annotations.ReadOnlyHint)
				}
				c.sniffer.AddEndpoint(DiscoveredEndpoint{
					URL:         "webmcp://tool/" + t.Name,
					Method:      "CALL",
					ContentType: "application/json",
					BodySample:  schema,
					Headers:     headers,
				})
			}
		}
	}

	return &CrawlerResult{
		Endpoints:    c.sniffer.GetEndpoints(),
		PagesVisited: pagesVisited,
		DurationMs:   durationMs,
	}, nil
}

func hashState(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}
