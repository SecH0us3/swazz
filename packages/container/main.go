package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"swazz-engine/api"
	"swazz-engine/internal/classifier"
	"swazz-engine/internal/output"
	"swazz-engine/internal/runner"
	"swazz-engine/internal/swagger"

	"github.com/gin-gonic/gin"
)

func main() {
	if len(os.Args) < 2 {
		printHelp()
		os.Exit(1)
	}

	command := os.Args[1]

	switch command {
	case "serve":
		runServer()
	case "start":
		runCLI(os.Args[2:])
	default:
		fmt.Printf("Unknown command: %s\n", command)
		printHelp()
		os.Exit(1)
	}
}

func printHelp() {
	fmt.Println("swazz-engine - Smart API Fuzzer")
	fmt.Println("\nUsage:")
	fmt.Println("  swazz-engine serve            Start the HTTP API server (for web dashboard/worker)")
	fmt.Println("  swazz-engine start [options]  Start a CLI fuzzing run")
	fmt.Println("\nCLI Options for 'start':")
	fmt.Println("  --config <path>       Path to swazz.config.json")
	fmt.Println("  --sarif <path>        Path to save SARIF report")
	fmt.Println("  --json <path>         Path to save JSON report")
	fmt.Println("  --html <path>         Path to save HTML report")
}

// ─── SERVER MODE ──────────────────────────────────────────

func runServer() {
	gin.SetMode(gin.ReleaseMode)

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(gin.Logger())

	// CORS middleware
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	})

	// Routes
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"service": "swazz-engine",
			"version": "0.1.0",
		})
	})

	handler := api.NewHandler()
	apiGroup := r.Group("/api")
	{
		apiGroup.POST("/parse", handler.ParseSpec)
		apiGroup.POST("/fuzz/start", handler.StartFuzz)
		apiGroup.POST("/fuzz/stop", handler.StopFuzz)
		apiGroup.POST("/fuzz/pause", handler.PauseFuzz)
		apiGroup.POST("/fuzz/resume", handler.ResumeFuzz)
		apiGroup.GET("/fuzz/stream", handler.StreamResults)
		apiGroup.GET("/stats", handler.GetStats)
		apiGroup.POST("/proxy", handler.Proxy)
		apiGroup.GET("/report", handler.GetReport)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("swazz-engine starting on :%s", port)
	if err := r.Run("0.0.0.0:" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

// ─── CLI MODE ─────────────────────────────────────────────

type CliConfig struct {
	SwaggerURLs  []string               `json:"swagger_urls"`
	BaseURL      string                 `json:"base_url"`
	Headers      map[string]string      `json:"headers"`
	Cookies      map[string]string      `json:"cookies"`
	Dictionaries map[string][]any       `json:"dictionaries"`
	Settings     swagger.Settings        `json:"settings"`
	Endpoints    *struct {
		Include []string `json:"include"`
		Exclude []string `json:"exclude"`
	} `json:"endpoints"`
}

func runCLI(args []string) {
	flags := flag.NewFlagSet("start", flag.ExitOnError)
	configPath := flags.String("config", "swazz.config.json", "Path to config file")
	sarifOut := flags.String("sarif", "", "Path to save SARIF output")
	jsonOut := flags.String("json", "", "Path to save JSON output")
	htmlOut := flags.String("html", "", "Path to save HTML output")

	if err := flags.Parse(args); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}

	// 1. Read config
	configData, err := os.ReadFile(*configPath)
	if err != nil {
		log.Fatalf("Failed to read config file %s: %v", *configPath, err)
	}

	var cliCfg CliConfig
	if err := json.Unmarshal(configData, &cliCfg); err != nil {
		log.Fatalf("Invalid config JSON: %v", err)
	}

	if len(cliCfg.SwaggerURLs) == 0 {
		log.Fatalf("Config must specify at least one swagger_url")
	}

	if cliCfg.Settings.IterationsPerProfile <= 0 {
		cliCfg.Settings = swagger.DefaultSettings()
	}
	if len(cliCfg.Settings.Profiles) == 0 {
		cliCfg.Settings.Profiles = swagger.DefaultSettings().Profiles
	}

	// 2. Fetch and parse swagger specs
	var allEndpoints []swagger.EndpointConfig
	basePath := cliCfg.BaseURL

	for _, url := range cliCfg.SwaggerURLs {
		specRaw, err := fetchSpec(url, cliCfg.Headers)
		if err != nil {
			log.Fatalf("Failed to fetch spec %s: %v", url, err)
		}
		parsed, err := swagger.ParseSpec(specRaw)
		if err != nil {
			log.Fatalf("Failed to parse spec %s: %v", url, err)
		}
		if basePath == "" {
			basePath = parsed.BasePath
		}
		allEndpoints = append(allEndpoints, parsed.Endpoints...)
	}

	if basePath == "" {
		log.Fatalf("No base_url found in config or specs")
	}

	// 3. Filter endpoints
	if cliCfg.Endpoints != nil {
		var filtered []swagger.EndpointConfig
		for _, ep := range allEndpoints {
			key := fmt.Sprintf("%s %s", ep.Method, ep.Path)
			included := true
			if len(cliCfg.Endpoints.Include) > 0 {
				included = matchesAny(key, ep.Path, cliCfg.Endpoints.Include)
			}
			if len(cliCfg.Endpoints.Exclude) > 0 {
				if matchesAny(key, ep.Path, cliCfg.Endpoints.Exclude) {
					included = false
				}
			}
			if included {
				filtered = append(filtered, ep)
			}
		}
		allEndpoints = filtered
	}

	if len(allEndpoints) == 0 {
		log.Fatalf("No endpoints remaining after filtering")
	}

	runCfg := &swagger.Config{
		BaseURL:       basePath,
		GlobalHeaders: cliCfg.Headers,
		Cookies:       cliCfg.Cookies,
		Dictionaries:  cliCfg.Dictionaries,
		Settings:      cliCfg.Settings,
		Endpoints:     allEndpoints,
	}

	// 4. Initialize and start runner
	client := &http.Client{Timeout: time.Duration(runCfg.Settings.TimeoutMs) * time.Millisecond}
	r := runner.New(runCfg, client)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigCh
		fmt.Println("\nStopping fuzzing run...")
		r.Stop()
	}()

	resultsCh := r.Subscribe()
	var results []*swagger.FuzzResult
	var resultsMu sync.Mutex

	go func() {
		for evt := range resultsCh {
			if evt.Type == runner.EventResult {
				if res, ok := evt.Data.(*swagger.FuzzResult); ok {
					resultsMu.Lock()
					results = append(results, res)
					resultsMu.Unlock()
				}
			} else if evt.Type == runner.EventProgress {
				if stats, ok := evt.Data.(swagger.RunStats); ok {
					printProgress(stats)
				}
			}
		}
	}()

	fmt.Printf("Starting fuzz run on %d endpoints across %d profiles...\n", len(allEndpoints), len(cliCfg.Settings.Profiles))
	if err := r.Start(ctx); err != nil {
		log.Fatalf("Run failed: %v", err)
	}

	r.Unsubscribe(resultsCh)
	fmt.Println("\nRun complete.")

	// 5. Generate outputs
	resultsMu.Lock()
	finalResults := results
	resultsMu.Unlock()

	cls := classifier.New(nil)
	findings := cls.ClassifyAll(finalResults)
	stats := r.GetStats()

	printSummary(findings, &stats)

	if *sarifOut != "" {
		report := output.ToSARIF(findings, "0.1.0")
		writeJSON(*sarifOut, report)
		fmt.Printf("Saved SARIF to %s\n", *sarifOut)
	}
	if *jsonOut != "" {
		report := output.ToJSON(findings, &stats, "0.1.0")
		writeJSON(*jsonOut, report)
		fmt.Printf("Saved JSON to %s\n", *jsonOut)
	}
	if *htmlOut != "" {
		html := output.ToHTML(findings, &stats)
		if err := os.WriteFile(*htmlOut, []byte(html), 0644); err != nil {
			log.Printf("Failed to write HTML report: %v", err)
		} else {
			fmt.Printf("Saved HTML to %s\n", *htmlOut)
		}
	}
}

func fetchSpec(url string, headers map[string]string) (json.RawMessage, error) {
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		return os.ReadFile(url)
	}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

func matchesAny(key, path string, patterns []string) bool {
	for _, p := range patterns {
		p = strings.ReplaceAll(p, "**", ".*")
		p = strings.ReplaceAll(p, "*", "[^/]*")
		if matched, _ := regexpMatch(p, key); matched {
			return true
		}
		if matched, _ := regexpMatch(p, path); matched {
			return true
		}
	}
	return false
}

// We implement simple regex matching for globs
func regexpMatch(pattern, s string) (bool, error) {
	importRegexp := `^` + pattern + `$`
	return regexp.MatchString(importRegexp, s)
}

func writeJSON(path string, data any) {
	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		log.Printf("Failed to marshal JSON for %s: %v", path, err)
		return
	}
	if err := os.WriteFile(path, b, 0644); err != nil {
		log.Printf("Failed to write %s: %v", path, err)
	}
}

// ─── CLI Console Output ────────────────────────────────────

var lastLineLength int

func printProgress(stats swagger.RunStats) {
	pct := 0
	if stats.TotalPlanned > 0 {
		pct = int(float64(stats.TotalRequests) / float64(stats.TotalPlanned) * 100)
	}

	var parts []string
	for code, count := range stats.StatusCounts {
		parts = append(parts, fmt.Sprintf("%d:%d", code, count))
	}
	statusStr := strings.Join(parts, " ")

	ep := ""
	if stats.Progress.CurrentEndpoint != "" {
		ep = fmt.Sprintf("%s (%s)", stats.Progress.CurrentEndpoint, stats.Progress.CurrentProfile)
	}

	line := fmt.Sprintf("\r  [%d%%] %d/%d reqs | %.1f rps | %s | %s",
		pct, stats.TotalRequests, stats.TotalPlanned, stats.RequestsPerSec, ep, statusStr)

	// Clear previous
	fmt.Print("\r" + strings.Repeat(" ", lastLineLength))
	fmt.Print(line)
	lastLineLength = len(line)
}

func printSummary(findings []*classifier.Finding, stats *swagger.RunStats) {
	fmt.Print("\r" + strings.Repeat(" ", lastLineLength) + "\r")
	lastLineLength = 0

	sep := strings.Repeat("-", 60)
	fmt.Println("\n" + sep)
	fmt.Println("  swazz scan complete")
	fmt.Println(sep)
	fmt.Printf("  Total requests:  %d\n", stats.TotalRequests)

	duration := (time.Now().UnixMilli() - stats.StartTime) / 1000
	fmt.Printf("  Duration:        %ds\n", duration)
	fmt.Printf("  Avg RPS:         %.1f\n", stats.RequestsPerSec)

	fmt.Println("\n  Status distribution:")
	for code, count := range stats.StatusCounts {
		fmt.Printf("    %3d: %5d\n", code, count)
	}

	var errs, warns, notes int
	for _, f := range findings {
		switch f.Level {
		case classifier.SeverityError:
			errs++
		case classifier.SeverityWarning:
			warns++
		case classifier.SeverityNote:
			notes++
		}
	}

	fmt.Printf("\n  Findings: %d\n", len(findings))
	if len(findings) > 0 {
		if errs > 0 {
			fmt.Printf("    errors:   %d\n", errs)
		}
		if warns > 0 {
			fmt.Printf("    warnings: %d\n", warns)
		}
		if notes > 0 {
			fmt.Printf("    notes:    %d\n", notes)
		}

		byEndpoint := make(map[string][]*classifier.Finding)
		for _, f := range findings {
			k := f.Method + " " + f.Endpoint
			byEndpoint[k] = append(byEndpoint[k], f)
		}

		fmt.Println()
		for ep, epFindings := range byEndpoint {
			fmt.Printf("    %s:\n", ep)
			byStatus := make(map[int][]*classifier.Finding)
			for _, f := range epFindings {
				byStatus[f.Status] = append(byStatus[f.Status], f)
			}
			for status, sf := range byStatus {
				profilesMap := make(map[string]bool)
				for _, f := range sf {
					profilesMap[string(f.Profile)] = true
				}
				var profiles []string
				for p := range profilesMap {
					profiles = append(profiles, p)
				}
				level := sf[0].Level
				fmt.Printf("      HTTP %d (%s) x%d [%s]\n", status, level, len(sf), strings.Join(profiles, ","))
			}
		}
	}
	fmt.Println("\n" + sep)
}
