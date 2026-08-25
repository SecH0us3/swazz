// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"swazz-engine/internal/crawler"
	"swazz-engine/internal/runner"
	"swazz-engine/internal/swagger"

	"golang.org/x/term"
)

func runSpiderCLI(args []string) {
	if err := runSpiderCLIErr(args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func runSpiderCLIErr(args []string) error {
	flags := flag.NewFlagSet("spider", flag.ContinueOnError)
	configPath := flags.String("config", "", "Path to config file (optional)")
	outPath := flags.String("out", "openapi.json", "Output file path (openapi.json or crawler.har)")
	format := flags.String("format", "openapi", "Output format (openapi|har)")
	headless := flags.Bool("headless", true, "Use headless browser crawler")
	maxDepth := flags.Int("max-depth", 3, "Maximum crawling depth")
	maxClicks := flags.Int("max-clicks", 3, "Maximum clicks per URL route")
	maxPages := flags.Int("max-pages", 50, "Maximum pages to visit")
	timeoutPerPage := flags.Int("timeout", 30, "Timeout per page in seconds")
	yes := flags.Bool("yes", false, "Skip interactive warning prompt")

	if err := flags.Parse(args); err != nil {
		return err
	}

	targetURL := flags.Arg(0)
	if targetURL == "" && *configPath == "" {
		flags.PrintDefaults()
		return fmt.Errorf("usage: swazz spider <target_url> [options]")
	}

	var cliCfg CliConfig
	if *configPath != "" {
		configData, err := os.ReadFile(*configPath)
		if err != nil {
			return fmt.Errorf("failed to read config file %s: %w", *configPath, err)
		}
		configData = swagger.StripJSONC(configData)
		if err := json.Unmarshal(configData, &cliCfg); err != nil {
			return fmt.Errorf("invalid config JSON: %w", err)
		}
		if targetURL == "" {
			targetURL = cliCfg.BaseURL
		}
	}

	if targetURL == "" {
		return fmt.Errorf("no target URL specified. Please provide a URL argument or a config with base_url")
	}

	// Safety prompt check if interactive terminal and --yes flag not passed
	if term.IsTerminal(int(os.Stdin.Fd())) && !*yes {
		if !crawler.ConfirmDestructiveActions(os.Stdin, os.Stdout) {
			return fmt.Errorf("aborted by user")
		}
	}

	ctx := context.Background()

	// Execute AuthSequence if config is provided
	cookies := make(map[string]string)
	headers := make(map[string]string)
	if len(cliCfg.AuthSequence) > 0 {
		runCfg, err := BuildRunnerConfig(&cliCfg)
		if err == nil {
			r := runner.New(runCfg, nil)
			if authHeaders, authCookies, errAuth := r.ExecuteAuthSequence(ctx, cliCfg.AuthSequence, cliCfg.Headers, cliCfg.Cookies); errAuth == nil {
				cookies = authCookies
				headers = authHeaders
			} else {
				log.Printf("Warning: AuthSequence failed: %v", errAuth)
			}
		}
	}

	cfg := crawler.CrawlerConfig{
		Enabled:         true,
		Headless:        *headless,
		MaxDepth:        *maxDepth,
		MaxClicksPerUrl: *maxClicks,
		MaxPages:        *maxPages,
		TimeoutPerPage:  *timeoutPerPage,
		MemoryLimitMB:   512,
		Cookies:         cookies,
		Headers:         headers,
	}

	sniffer := crawler.NewSniffer()
	c := crawler.NewCrawler(cfg, sniffer)

	fmt.Printf("🕷️  Starting Headless Spider against %s ...\n", targetURL)
	res, err := c.Crawl(ctx, targetURL)
	if err != nil {
		return fmt.Errorf("spider failed: %w", err)
	}

	fmt.Printf("✓ Spider finished! Discovered %d endpoints across %d pages in %dms.\n",
		len(res.Endpoints), res.PagesVisited, res.DurationMs)

	var outputData []byte
	if *format == "har" || (*format == "openapi" && strings.HasSuffix(strings.ToLower(*outPath), ".har")) {
		outputData, err = sniffer.ToHAR()
	} else {
		outputData, err = sniffer.ToOpenAPI()
	}

	if err != nil {
		return fmt.Errorf("failed to export crawler results: %w", err)
	}

	if err := os.WriteFile(*outPath, outputData, 0600); err != nil {
		return fmt.Errorf("failed to write output to %s: %w", *outPath, err)
	}

	fmt.Printf("💾 Discovered API specification exported to: %s\n", *outPath)
	return nil
}
