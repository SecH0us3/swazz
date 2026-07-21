package crawler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
