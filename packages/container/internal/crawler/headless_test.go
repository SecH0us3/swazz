// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package crawler

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chromedp/chromedp"

	"github.com/stretchr/testify/assert"
)

func TestCheckChromeExecutable(t *testing.T) {
	path, err := CheckChromeExecutable()
	if err == nil {
		assert.NotEmpty(t, path)
	} else {
		assert.Error(t, err)
	}
}

func TestConfirmDestructiveActions_Headless(t *testing.T) {
	var buf bytes.Buffer
	assert.True(t, ConfirmDestructiveActions(strings.NewReader("yes\n"), &buf))
	assert.False(t, ConfirmDestructiveActions(strings.NewReader("no\n"), &buf))
	assert.False(t, ConfirmDestructiveActions(strings.NewReader("\n"), &buf))
}

func TestNewCrawler(t *testing.T) {
	cfg := DefaultCrawlerConfig()
	sniffer := NewSniffer()
	crawler := NewCrawler(cfg, sniffer)
	assert.NotNil(t, crawler)
}

func TestInjectCookies(t *testing.T) {
	cfg := DefaultCrawlerConfig()
	cfg.Cookies = map[string]string{"session_id": "123"}
	sniffer := NewSniffer()
	crawler := NewCrawler(cfg, sniffer)
	assert.NotNil(t, crawler)
}

func TestHashState(t *testing.T) {
	hash := hashState("http://example.com/api" + "some html content")
	assert.Len(t, hash, 64) // SHA256 hex string is 64 chars
}

func TestInjectCookies_Empty(t *testing.T) {
	err := InjectCookies(nil, "http://example.com", nil)
	assert.NoError(t, err)
}

func TestInjectCookies_InvalidUrl(t *testing.T) {
	err := InjectCookies(nil, ":\x00://invalid", map[string]string{"session": "123"})
	assert.Error(t, err)
}

func TestInjectCookies_ActionCreation(t *testing.T) {
	err := InjectCookies(context.Background(), "http://example.com", map[string]string{"session": "123"})
	assert.ErrorContains(t, err, "invalid context")
}

func TestCrawl_ContextTimeout(t *testing.T) {
	cfg := DefaultCrawlerConfig()
	cfg.MemoryLimitMB = 512
	cfg.UserAgent = "test-agent"
	cfg.Headers = map[string]string{"X-Test": "1"}
	cfg.Headless = true
	crawler := NewCrawler(cfg, NewSniffer())

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Millisecond)
	defer cancel()

	_, err := crawler.Crawl(ctx, "http://example.com")
	if err != nil {
		t.Logf("Crawl error: %v", err)
	}
}

func TestSniffer_WebMCPEndpoint(t *testing.T) {
	sniffer := NewSniffer()
	sniffer.AddEndpoint(DiscoveredEndpoint{
		URL:         "webmcp://tool/swazz_ui_start_scan",
		Method:      "CALL",
		ContentType: "application/json",
		BodySample:  "{}",
		Headers: map[string]string{
			"X-WebMCP-Consequential": "true",
			"X-WebMCP-ReadOnly":      "false",
		},
	})

	eps := sniffer.GetEndpoints()
	assert.Len(t, eps, 1)
	assert.Equal(t, "webmcp://tool/swazz_ui_start_scan", eps[0].URL)
	assert.Equal(t, "CALL", eps[0].Method)
	assert.Equal(t, "true", eps[0].Headers["X-WebMCP-Consequential"])
	assert.Equal(t, "false", eps[0].Headers["X-WebMCP-ReadOnly"])
}

// fakeChrome writes a stand-in browser that runs body, and returns its path and a function that
// counts its launches.
func fakeChrome(t *testing.T, body string) (string, func() int) {
	t.Helper()
	dir := t.TempDir()
	count := filepath.Join(dir, "launches")
	fake := filepath.Join(dir, "chrome")
	script := "#!/bin/sh\necho launch >> " + count + "\n" + body + "\n"
	if err := os.WriteFile(fake, []byte(script), 0o700); err != nil { // #nosec G306 -- test helper
		t.Fatal(err)
	}
	return fake, func() int {
		data, _ := os.ReadFile(count) // #nosec G304 -- test temp file
		return strings.Count(string(data), "launch")
	}
}

// A browser that comes up but cannot be reached is launched again once, then reported.
func TestStartBrowser_RetriesHandshakeFailureOnce(t *testing.T) {
	fake, launches := fakeChrome(t, "echo 'DevTools listening on ws://127.0.0.1:1/devtools/browser/x' >&2\nsleep 5")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, _, err := startBrowser(ctx, []chromedp.ExecAllocatorOption{chromedp.ExecPath(fake)})
	if err == nil || !strings.Contains(err.Error(), "failed to start the browser") {
		t.Fatalf("err = %v, want a start failure", err)
	}
	if n := launches(); n != browserStartAttempts {
		t.Fatalf("browser launched %d times, want %d", n, browserStartAttempts)
	}
}

// A browser that crashes on start would crash again, so it is not relaunched.
func TestStartBrowser_DoesNotRetryCrash(t *testing.T) {
	fake, launches := fakeChrome(t, "exit 1")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, _, err := startBrowser(ctx, []chromedp.ExecAllocatorOption{chromedp.ExecPath(fake)}); err == nil {
		t.Fatal("a crashing browser started")
	}
	if n := launches(); n != 1 {
		t.Fatalf("browser launched %d times, want 1", n)
	}
}

// A caller that gives up during the start is not retried.
func TestStartBrowser_StopsWhenCallerIsDone(t *testing.T) {
	fake, launches := fakeChrome(t, "sleep 5")
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(300*time.Millisecond, cancel)
	start := time.Now()
	if _, _, err := startBrowser(ctx, []chromedp.ExecAllocatorOption{chromedp.ExecPath(fake)}); err == nil {
		t.Fatal("started after the caller was done")
	}
	if d := time.Since(start); d > 5*time.Second {
		t.Fatalf("start took %v after the caller was done", d)
	}
	if n := launches(); n != 1 {
		t.Fatalf("browser launched %d times, want 1", n)
	}
}
