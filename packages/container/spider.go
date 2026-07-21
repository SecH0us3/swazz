package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"swazz-engine/internal/crawler"
	"swazz-engine/internal/runner"
	"swazz-engine/internal/swagger"

	"golang.org/x/term"
)

func runSpiderCLI(args []string) {
	flags := flag.NewFlagSet("spider", flag.ExitOnError)
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
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	targetURL := flags.Arg(0)
	if targetURL == "" && *configPath == "" {
		fmt.Fprintln(os.Stderr, "Usage: swazz spider <target_url> [options]")
		flags.PrintDefaults()
		os.Exit(1)
	}

	var cliCfg CliConfig
	if *configPath != "" {
		configData, err := os.ReadFile(*configPath)
		if err != nil {
			log.Fatalf("Failed to read config file %s: %v", *configPath, err)
		}
		configData = swagger.StripJSONC(configData)
		if err := json.Unmarshal(configData, &cliCfg); err != nil {
			log.Fatalf("Invalid config JSON: %v", err)
		}
		if targetURL == "" {
			targetURL = cliCfg.BaseURL
		}
	}

	if targetURL == "" {
		log.Fatalf("No target URL specified. Please provide a URL argument or a config with base_url.")
	}

	// Safety prompt check if interactive terminal and --yes flag not passed
	if term.IsTerminal(int(os.Stdin.Fd())) && !*yes {
		if !crawler.ConfirmDestructiveActions(os.Stdin, os.Stdout) {
			fmt.Println("Aborted by user.")
			os.Exit(0)
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
		log.Fatalf("Spider failed: %v", err)
	}

	fmt.Printf("✓ Spider finished! Discovered %d endpoints across %d pages in %dms.\n",
		len(res.Endpoints), res.PagesVisited, res.DurationMs)

	var outputData []byte
	if *format == "har" || (*format == "openapi" && (len(*outPath) > 4 && (*outPath)[len(*outPath)-4:] == ".har")) {
		outputData, err = sniffer.ToHAR()
	} else {
		outputData, err = sniffer.ToOpenAPI()
	}

	if err != nil {
		log.Fatalf("Failed to export crawler results: %v", err)
	}

	if err := os.WriteFile(*outPath, outputData, 0600); err != nil {
		log.Fatalf("Failed to write output to %s: %v", *outPath, err)
	}

	fmt.Printf("💾 Discovered API specification exported to: %s\n", *outPath)
}
