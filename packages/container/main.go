package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"runtime"
	"sort"
	"strconv"
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
	runtime.GOMAXPROCS(2)

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
	case "wizard":
		runWizard()
	default:
		fmt.Printf("Unknown command: %s\n", command)
		printHelp()
		os.Exit(1)
	}
}

func printHelp() {
	fmt.Println("\033[1;34m⚡ SWAZZ ENGINE\033[0m - Smart API Fuzzer")
	fmt.Println()
	fmt.Println("Usage:")
	fmt.Println("  swazz-engine serve            Start the HTTP API server (for web dashboard)")
	fmt.Println("  swazz-engine start [options]  Start a CLI fuzzing run using config")
	fmt.Println("  swazz-engine wizard           Interactive setup to generate swazz.config.json")
	fmt.Println()
	fmt.Println("Options for 'start':")
	fmt.Println("  --config <path>   Path to config file (default: swazz.config.json)")
	fmt.Println("  --sarif <path>    Export findings in SARIF format (for CI/CD)")
	fmt.Println("  --json <path>     Export findings in JSON format")
	fmt.Println("  --html <path>     Generate a standalone HTML report")
	fmt.Println("  --fail-on-error   Exit with code 1 if any 'error' level findings are detected (useful for CI/CD)")
	fmt.Println("  --debug           Enable debug logging for all HTTP interactions")
	fmt.Println()
	fmt.Println("Examples:")
	fmt.Println("  swazz-engine wizard")
	fmt.Println("  swazz-engine start --config production.json --html report.html")
}

// ─── WIZARD MODE ──────────────────────────────────────────

func runWizard() {
	fmt.Println("\033[1;34mWelcome to the SWAZZ Configuration Wizard!\033[0m")
	fmt.Println("I'll help you create a 'swazz.config.json' file.")
	fmt.Println()

	config := CliConfig{
		Settings: swagger.DefaultSettings(),
	}

	var swaggerURL string
	for {
		swaggerURL = ask("\033[1;32m1. Swagger/OpenAPI URL (e.g., https://api.com/swagger.json):\033[0m ")
		if swaggerURL != "" {
			break
		}
		fmt.Println("   \033[31mSwagger URL cannot be empty.\033[0m")
	}
	config.SwaggerURLs = []string{swaggerURL}

	parsedURL, err := url.Parse(swaggerURL)
	var defaultBase string
	if err == nil && parsedURL.Host != "" {
		defaultBase = parsedURL.Scheme + "://" + parsedURL.Host
	}

	basePrompt := "\033[1;32m2. Base API URL (e.g., https://api.com/v1):\033[0m "
	if defaultBase != "" {
		basePrompt = fmt.Sprintf("\033[1;32m2. Base API URL [Default: %s]:\033[0m ", defaultBase)
	}
	base := ask(basePrompt)
	if base == "" && defaultBase != "" {
		base = defaultBase
	}
	config.BaseURL = base

	if askYesNo("\033[1;32m3. Do you want to set any static Global Headers or Cookies (e.g., a static Authorization token)?\033[0m") {
		fmt.Println()
		fmt.Println("\033[1;36m--- Static Variables ---\033[0m")
		
		config.Headers = make(map[string]string)
		config.Cookies = make(map[string]string)

		for {
			h := ask("   \033[36mAdd a Header\033[0m (format Name:Value, or enter to skip): ")
			if h == "" {
				break
			}
			parts := strings.SplitN(h, ":", 2)
			if len(parts) == 2 {
				config.Headers[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
			} else {
				fmt.Println("   \033[31mInvalid format, must be Name:Value\033[0m")
			}
		}

		for {
			c := ask("   \033[35mAdd a Cookie\033[0m (format Name=Value, or enter to skip): ")
			if c == "" {
				break
			}
			parts := strings.SplitN(c, "=", 2)
			if len(parts) == 2 {
				config.Cookies[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
			} else {
				fmt.Println("   \033[31mInvalid format, must be Name=Value\033[0m")
			}
		}
		fmt.Println()
	}

	if askYesNo("4. Do you need an authentication sequence (multi-step login before fuzzing)?") {
		for {
			step := swagger.AuthStep{}
			fmt.Println()
			fmt.Println("\033[1;33m--- New Auth Step ---\033[0m")
			step.URL = ask("   URL (relative to BaseURL or absolute): ")
			step.Method = strings.ToUpper(ask("   Method (GET/POST/PUT): "))
			if step.Method == "" {
				step.Method = "GET"
			}
			if step.Method == "POST" || step.Method == "PUT" {
				bodyStr := ask("   Body JSON (single-line, optional, press enter to skip): ")
				if bodyStr != "" {
					var body any
					if err := json.Unmarshal([]byte(bodyStr), &body); err == nil {
						step.Body = body
					} else {
						fmt.Println("   \033[31mInvalid JSON, skipping body.\033[0m")
					}
				}
			}

			if askYesNo("   Extract data from this response (cookies/token)?") {
				cookieStr := ask("   Specific cookies to save (comma separated, or enter for all): ")
				if cookieStr != "" {
					for _, s := range strings.Split(cookieStr, ",") {
						step.ExtractCookies = append(step.ExtractCookies, strings.TrimSpace(s))
					}
				}

				jsonStr := ask("   Extract JSON field to header? (format: field:Header, e.g., data.token:Authorization, or enter to skip): ")
				if jsonStr != "" {
					step.ExtractJSON = make(map[string]string)
					for _, pair := range strings.Split(jsonStr, ",") {
						parts := strings.SplitN(pair, ":", 2)
						if len(parts) == 2 {
							step.ExtractJSON[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
						}
					}
				}
			}

			config.AuthSequence = append(config.AuthSequence, step)
			if !askYesNo("   Add another step?") {
				break
			}
		}
	}

	if askYesNo("\033[1;32m5. Customize status code rules (which statuses to ignore/flag)?\033[0m") {
		config.Rules = &swagger.RulesConfig{
			Severity: make(map[string]string),
		}
		ignoreStr := ask("   Status codes to IGNORE (comma separated, e.g., 401,404,405): ")
		if ignoreStr != "" {
			for _, s := range strings.Split(ignoreStr, ",") {
				if code, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
					config.Rules.Ignore = append(config.Rules.Ignore, code)
				}
			}
		}
		warnStr := ask("   Status codes to treat as WARNING (comma separated, e.g., 200,400): ")
		if warnStr != "" {
			for _, s := range strings.Split(warnStr, ",") {
				config.Rules.Severity[strings.TrimSpace(s)] = "warning"
			}
		}
	}

	fmt.Println()
	fmt.Println("--- Configuration Summary ---")
	fmt.Printf("   Swagger:  %s\n", config.SwaggerURLs[0])
	fmt.Printf("   Base URL: %s\n", config.BaseURL)
	fmt.Printf("   Headers:  %d static headers\n", len(config.Headers))
	fmt.Printf("   Cookies:  %d static cookies\n", len(config.Cookies))
	fmt.Printf("   Auth:     %d steps\n", len(config.AuthSequence))
	fmt.Println()

	if askYesNo("Save to 'swazz.config.json'?") {
		writeJSON("swazz.config.json", config)
		fmt.Println("\033[1;32mConfig saved successfully!\033[0m")
		fmt.Println()
		fmt.Println("You can now start the fuzzer. Here are some examples:")
		fmt.Println("  \033[90m# Run normally:\033[0m")
		fmt.Println("  \033[36m./swazz-engine start --config swazz.config.json\033[0m")
		fmt.Println()
		fmt.Println("  \033[90m# Run and save a visual HTML report:\033[0m")
		fmt.Println("  \033[36m./swazz-engine start --config swazz.config.json --html report.html\033[0m")
		fmt.Println()
		fmt.Println("  \033[90m# Run in CI/CD (fails the build if errors are found, exports SARIF for GitHub/GitLab):\033[0m")
		fmt.Println("  \033[36m./swazz-engine start --config swazz.config.json --fail-on-error --sarif report.sarif\033[0m")
	} else {
		fmt.Println("Aborted. No changes made.")
	}
}

func ask(question string) string {
	fmt.Print(question)
	var input string
	scanner := bufio.NewScanner(os.Stdin)
	if scanner.Scan() {
		input = scanner.Text()
	}
	return strings.TrimSpace(input)
}

func askYesNo(question string) bool {
	for {
		res := strings.ToLower(ask(question + " (y/n): "))
		if res == "y" || res == "yes" {
			return true
		}
		if res == "n" || res == "no" || res == "" {
			return false
		}
	}
}

// ─── SERVER MODE ──────────────────────────────────────────

func runServer() {
	gin.SetMode(gin.ReleaseMode)

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(gin.Logger())

	allowedOrigin := os.Getenv("ALLOWED_ORIGIN")
	if allowedOrigin == "" {
		allowedOrigin = "http://localhost:5173" // Default for local dev
	}

	// CORS middleware
	r.Use(func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		
		// If origin is empty, it might be a direct request, but for CORS we need to check it
		// For local dev, we'll be permissive if it's localhost
		isLocalhost := strings.HasPrefix(origin, "http://localhost:") || strings.HasPrefix(origin, "http://127.0.0.1:")
		
		if allowedOrigin == "*" || origin == allowedOrigin || isLocalhost {
			if origin != "" {
				c.Header("Access-Control-Allow-Origin", origin)
			} else if allowedOrigin == "*" {
				c.Header("Access-Control-Allow-Origin", "*")
			}
		}

		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
		c.Header("Access-Control-Allow-Credentials", "true")

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
		apiGroup.GET("/payload-catalog", handler.GetPayloadCatalog)
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
	Settings     swagger.Settings       `json:"settings"`
	Endpoints    *struct {
		Include []string `json:"include"`
		Exclude []string `json:"exclude"`
	} `json:"endpoints"`
	Rules        *swagger.RulesConfig `json:"rules"`
	AuthSequence []swagger.AuthStep   `json:"auth_sequence"`
}

func runCLI(args []string) {
	flags := flag.NewFlagSet("start", flag.ExitOnError)
	configPath := flags.String("config", "swazz.config.json", "Path to config file")
	sarifOut := flags.String("sarif", "", "Path to save SARIF output")
	jsonOut := flags.String("json", "", "Path to save JSON output")
	htmlOut := flags.String("html", "", "Path to save HTML output")
	failOnError := flags.Bool("fail-on-error", false, "Exit with code 1 if error level findings exist")
	debugMode := flags.Bool("debug", false, "Enable debug logging for HTTP interactions")

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

	if *debugMode {
		cliCfg.Settings.Debug = true
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
		Rules:         cliCfg.Rules,
		AuthSequence:  cliCfg.AuthSequence,
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

	// Run auth sequence if present
	if err := r.RunAuthSequence(ctx); err != nil {
		log.Fatalf("Authentication failed: %v", err)
	}

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

	// Map swagger.RulesConfig to classifier.RulesConfig
	var clsRules *classifier.RulesConfig
	if runCfg.Rules != nil {
		clsRules = &classifier.RulesConfig{
			Ignore:   runCfg.Rules.Ignore,
			Severity: make(map[string]classifier.Severity),
			Defaults: make(map[string]classifier.Severity),
		}
		for k, v := range runCfg.Rules.Severity {
			clsRules.Severity[k] = classifier.Severity(v)
		}
		for k, v := range runCfg.Rules.Defaults {
			clsRules.Defaults[k] = classifier.Severity(v)
		}
	}

	cls := classifier.New(clsRules)
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

	if *failOnError {
		for _, f := range findings {
			if f.Level == classifier.SeverityError {
				fmt.Println("\n\033[1;31m[CI/CD] Error level findings detected. Exiting with code 1.\033[0m")
				os.Exit(1)
			}
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

var numLinesPrinted int

func printProgress(stats swagger.RunStats) {
	pct := 0
	if stats.TotalPlanned > 0 {
		pct = int(float64(stats.TotalRequests) / float64(stats.TotalPlanned) * 100)
	}

	ep := ""
	if stats.Progress.CurrentEndpoint != "" {
		iterInfo := ""
		if stats.Progress.TotalIterations > 0 {
			iterInfo = fmt.Sprintf(" \033[90m[test %d/%d]\033[0m", stats.Progress.CurrentIteration, stats.Progress.TotalIterations)
		}
		ep = fmt.Sprintf("\033[1;33m%s\033[0m (\033[1;35m%s\033[0m)%s", stats.Progress.CurrentEndpoint, stats.Progress.CurrentProfile, iterInfo)
	}

	// Calculate how many lines we will print
	linesToPrint := 3 // Header, Progress, Active
	var sortedProfiles []swagger.FuzzingProfile
	for p := range stats.StatusByProfile {
		sortedProfiles = append(sortedProfiles, p)
	}
	sort.Slice(sortedProfiles, func(i, j int) bool {
		return string(sortedProfiles[i]) < string(sortedProfiles[j])
	})
	// Add 1 line for each profile, or at least 1 for overall status if empty
	if len(sortedProfiles) == 0 {
		linesToPrint += 1
	} else {
		linesToPrint += len(sortedProfiles)
	}

	// ANSI clear up `numLinesPrinted` lines (if not first time)
	if numLinesPrinted > 0 {
		fmt.Printf("\033[%dA", numLinesPrinted)
	}

	fmt.Printf("⚡ \033[1;34mSWAZZ ENGINE\033[0m running...\033[K\n")
	fmt.Printf("🎯 \033[1mProgress:\033[0m [%d%%] %d/%d reqs | %.1f rps\033[K\n", pct, stats.TotalRequests, stats.TotalPlanned, stats.RequestsPerSec)
	fmt.Printf("🌐 \033[1mActive:\033[0m   %s\033[K\n", ep)

	if len(sortedProfiles) == 0 {
		fmt.Printf("📊 \033[1mStatus:\033[0m   waiting...\033[K\n")
	} else {
		for _, p := range sortedProfiles {
			var parts []string
			var codes []int
			for code := range stats.StatusByProfile[p] {
				codes = append(codes, code)
			}
			sort.Ints(codes)

			for _, code := range codes {
				count := stats.StatusByProfile[p][code]
				var colorCode string
				if code >= 200 && code < 300 {
					colorCode = "35" // Purple
				} else if code >= 300 && code < 400 {
					colorCode = "90" // Gray
				} else if code >= 400 && code < 500 {
					colorCode = "33" // Orange/Yellow
				} else if code >= 500 {
					colorCode = "31" // Red
				} else {
					colorCode = "36" // Cyan default
				}

				parts = append(parts, fmt.Sprintf("\033[1;%sm%03d\033[0m: %-4d", colorCode, code, count))
			}
			statusStr := strings.Join(parts, "  ")
			if len(statusStr) > 200 { // Increased limit because of more ANSI characters
				statusStr = statusStr[:197] + "..."
			}
			fmt.Printf("📊 \033[1mStatus [%-10s]:\033[0m %s\033[K\n", p, statusStr)
		}
	}

	numLinesPrinted = linesToPrint
}

func printSummary(findings []*classifier.Finding, stats *swagger.RunStats) {
	if numLinesPrinted > 0 {
		// Clear lines downwards
		fmt.Printf("\033[%dA\033[0J", numLinesPrinted)
	}
	numLinesPrinted = 0

	sep := strings.Repeat("-", 60)
	fmt.Println("\n" + sep)
	fmt.Println("  swazz scan complete")
	fmt.Println(sep)
	fmt.Printf("  Total requests:  %d\n", stats.TotalRequests)

	duration := (time.Now().UnixMilli() - stats.StartTime) / 1000
	fmt.Printf("  Duration:        %ds\n", duration)
	fmt.Printf("  Avg RPS:         %.1f\n", stats.RequestsPerSec)

	fmt.Println("\n  Status distribution:")
	var statCodes []int
	for code := range stats.StatusCounts {
		statCodes = append(statCodes, code)
	}
	sort.Ints(statCodes)
	for _, code := range statCodes {
		fmt.Printf("    %03d: %5d\n", code, stats.StatusCounts[code])
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
				fmt.Printf("      HTTP %03d (%s) x%d [%s]\n", status, level, len(sf), strings.Join(profiles, ","))
			}
		}
	}
	fmt.Println("\n" + sep)
}
