// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package crawler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
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

// browserStartTimeout bounds Chrome's DevTools handshake on each start attempt; a loaded CI
// runner can take well over chromedp's default 20s.
const browserStartTimeout = 45 * time.Second

// browserStartAttempts is how often startBrowser launches Chrome before giving up.
const browserStartAttempts = 2

var errBrowserStartTimeout = errors.New("browser did not start")

// isTransientStartError reports whether a start failure is worth another launch: Chrome came up
// but missed or dropped its DevTools handshake, as it can on a loaded machine. A crash or a bad
// executable fails the same way again, so it is not retried.
func isTransientStartError(err error) bool {
	msg := err.Error()
	return errors.Is(err, errBrowserStartTimeout) ||
		strings.Contains(msg, "websocket url timeout reached") ||
		strings.Contains(msg, "could not dial")
}

// startBrowser launches Chrome and opens its first tab, retrying once when Chrome misses its
// DevTools handshake. The crawl's page budget starts only once the browser is up, so a slow start
// no longer eats it. The returned cancel closes the browser.
func startBrowser(ctx context.Context, opts []chromedp.ExecAllocatorOption) (context.Context, context.CancelFunc, error) {
	opts = append(opts[:len(opts):len(opts)], chromedp.WSURLReadTimeout(browserStartTimeout))
	var lastErr error
	for range browserStartAttempts {
		allocCtx, allocCancel := chromedp.NewExecAllocator(ctx, opts...)
		browserCtx, browserCancel := chromedp.NewContext(allocCtx)
		cancel := func() { browserCancel(); allocCancel() }

		// The first Run starts the browser. Its context must not carry a timeout, which would
		// close the browser when it fires, so the start is bounded from outside instead.
		done := make(chan error, 1)
		go func() { done <- chromedp.Run(browserCtx) }()
		timer := time.NewTimer(browserStartTimeout + 10*time.Second)
		select {
		case lastErr = <-done:
		case <-timer.C:
			cancel()
			lastErr = fmt.Errorf("%w within %v: %w", errBrowserStartTimeout, browserStartTimeout+10*time.Second, <-done)
		}
		timer.Stop()
		if lastErr == nil {
			return browserCtx, cancel, nil
		}
		cancel()
		if ctx.Err() != nil || !isTransientStartError(lastErr) {
			break
		}
	}
	return nil, nil, fmt.Errorf("failed to start the browser: %w", lastErr)
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

	browserCtx, browserCancel, err := startBrowser(ctx, allocOpts)
	if err != nil {
		return nil, err
	}
	defer browserCancel()

	pageTimeout := time.Duration(c.config.TimeoutPerPage) * time.Second
	if pageTimeout <= 0 {
		pageTimeout = 30 * time.Second
	}
	maxPages := c.config.MaxPages
	if maxPages <= 0 {
		maxPages = 50
	}
	runCtx, runCancel := context.WithTimeout(browserCtx, pageTimeout*time.Duration(maxPages))
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

	// WebMCP discovery: the page-side hook reports each registerTool call through
	// a CDP binding, so tools are captured as they happen (across navigations and
	// even if the crawl later times out) rather than read back once at the end.
	webmcp := newWebMcpCollector(c.sniffer)
	chromedp.ListenTarget(runCtx, func(ev interface{}) {
		if e, ok := ev.(*cdpRuntime.EventBindingCalled); ok && e.Name == webMcpBindingName {
			webmcp.add(e.Payload)
		}
	})
	if err := chromedp.Run(runCtx,
		page.Enable(),
		cdpRuntime.AddBinding(webMcpBindingName),
		chromedp.ActionFunc(func(ctx context.Context) error {
			_, err := page.AddScriptToEvaluateOnNewDocument(webMcpHookScript).Do(ctx)
			return err
		}),
	); err != nil {
		fmt.Printf("Warning: failed to install WebMCP discovery hook: %v\n", err)
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

	// Final sweep for tools registered before the hook could wrap registerTool.
	// runCtx may already be expired (that is one way to reach Done), so use a
	// short context of its own off the still-live browser context.
	c.collectWebMcpTools(browserCtx, webmcp)

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
