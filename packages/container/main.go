package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/term"

	"swazz-engine/api"
	"swazz-engine/internal/classifier"
	"swazz-engine/internal/graphql"
	"swazz-engine/internal/output"
	"swazz-engine/internal/postman"
	"swazz-engine/internal/runner"
	"swazz-engine/internal/security"
	"swazz-engine/internal/swagger"

	"github.com/gin-gonic/gin"
)

var Version = "dev"

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
	fmt.Println("  --config <path>              Path to config file (default: swazz.config.json)")
	fmt.Println("  --sarif <path>               Export findings in SARIF format")
	fmt.Println("  --json <path>                Export findings in JSON format")
	fmt.Println("  --html <path>                Generate a standalone HTML report")
	fmt.Println("  --junit <path>               Export findings in JUnit XML format (for CI runners)")
	fmt.Println("  --markdown <path>            Export findings in Markdown format")
	fmt.Println("  --fail-on-severity <level>   Exit with code 2 if findings meet severity threshold")
	fmt.Println("                               Levels: error, warning, note, none (default: none)")
	fmt.Println("  --debug                      Enable debug logging for all HTTP interactions")
	fmt.Println()
	fmt.Println("Examples:")
	fmt.Println("  swazz-engine wizard")
	fmt.Println("  swazz-engine start --config production.json --html report.html")
	fmt.Println("  swazz-engine start --config ci.json --sarif results.sarif --fail-on-severity error")
	fmt.Println("  swazz-engine start --config ci.json --junit results.xml --fail-on-severity warning")
}



// ─── SERVER MODE ──────────────────────────────────────────

func runServer() {
	gin.SetMode(gin.ReleaseMode)

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(gin.Logger())

	// Content-Signal middleware to declare AI scraping policies
	r.Use(func(c *gin.Context) {
		c.Header("Content-Signal", "ai-train=no, search=yes")
		c.Next()
	})

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

	// Serve static files from web/dist if they exist
	if _, err := os.Stat("web/dist"); err == nil {
		r.StaticFS("/assets", http.Dir("web/dist/assets"))
		r.StaticFile("/favicon.svg", "web/dist/favicon.svg")
		r.StaticFile("/robots.txt", "web/dist/robots.txt")
		
		r.NoRoute(func(c *gin.Context) {
			if !strings.HasPrefix(c.Request.URL.Path, "/api") {
				c.File("web/dist/index.html")
				return
			}
			c.JSON(http.StatusNotFound, gin.H{"error": "API route not found"})
		})
	}

	// Routes
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"service": "swazz-engine",
			"version": Version,
		})
	})

	handler := api.NewHandler()
	apiGroup := r.Group("/api")
	{
		apiGroup.GET("/version", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"version": Version,
			})
		})
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
		apiGroup.Any("/oob/:uuid", handler.HandleOOB)
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
	SwaggerURLs      []string                      `json:"swagger_urls"`
	SwaggerURLsAlias []string                      `json:"_swagger_urls"`
	BaseURL          string                        `json:"base_url"`
	Headers          map[string]string             `json:"headers"`
	GlobalHeaders    map[string]string             `json:"global_headers"`
	Cookies          map[string]string             `json:"cookies"`
	WordlistFiles    map[string]string             `json:"wordlist_files"`
	Dictionaries     map[string][]any              `json:"dictionaries"`
	Settings         swagger.Settings              `json:"settings"`
	Endpoints        *struct {
		Include []string `json:"include"`
		Exclude []string `json:"exclude"`
	} `json:"endpoints"`
	DisabledEndpoints []string                     `json:"disabled_endpoints"`
	Rules            *swagger.RulesConfig          `json:"rules"`
	AuthSequence     []swagger.AuthStep            `json:"auth_sequence"`
	AuthIdentities map[string]swagger.AuthIdentity `json:"auth_identities,omitempty"`
	Variables      map[string]any                `json:"variables,omitempty"`
	Security       swagger.SecurityConfig        `json:"security"`
}

func (c *CliConfig) Validate() error {
	if err := c.Settings.Validate(); err != nil {
		return err
	}
	if err := swagger.ValidateBaseURL(c.BaseURL); err != nil {
		return err
	}
	return nil
}

func runCLI(args []string) {
	flags := flag.NewFlagSet("start", flag.ExitOnError)
	configPath := flags.String("config", "swazz.config.json", "Path to config file")
	sarifOut := flags.String("sarif", "", "Path to save SARIF output")
	jsonOut := flags.String("json", "", "Path to save JSON output")
	htmlOut := flags.String("html", "", "Path to save HTML report")
	junitOut := flags.String("junit", "", "Path to save JUnit XML output")
	markdownOut := flags.String("markdown", "", "Path to save Markdown report")
	failOnSeverity := flags.String("fail-on-severity", "none", "Exit with code 2 if findings meet severity threshold (error|warning|note|none)")
	ignoreConfig := flags.String("ignore-config", "swazz.ignore.json", "Path to ignore rules JSON file")
	allowPrivateIps := flags.Bool("allow-private-ips", true, "Allow requests to private IP addresses (default: true for CLI mode)")
	debugMode := flags.Bool("debug", false, "Enable debug logging for HTTP interactions")

	if err := flags.Parse(args); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}

	allowPrivateExplicit := false
	flags.Visit(func(f *flag.Flag) {
		if f.Name == "allow-private-ips" {
			allowPrivateExplicit = true
		}
	})

	// 1. Read config
	configData, err := os.ReadFile(*configPath)
	if err != nil {
		log.Fatalf("Failed to read config file %s: %v", *configPath, err)
	}

	cliCfg := CliConfig{
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
	}
	if err := json.Unmarshal(configData, &cliCfg); err != nil {
		log.Fatalf("Invalid config JSON: %v", err)
	}

	if allowPrivateExplicit {
		cliCfg.Security.AllowPrivateIPs = *allowPrivateIps
	}

	if *debugMode {
		cliCfg.Settings.Debug = true
	}

	// Standardize compatibility aliases and merge them:
	if len(cliCfg.GlobalHeaders) > 0 {
		if cliCfg.Headers == nil {
			cliCfg.Headers = make(map[string]string)
		}
		for k, v := range cliCfg.GlobalHeaders {
			if _, exists := cliCfg.Headers[k]; !exists {
				cliCfg.Headers[k] = v
			}
		}
	}

	if len(cliCfg.SwaggerURLsAlias) > 0 {
		for _, urlStr := range cliCfg.SwaggerURLsAlias {
			found := false
			for _, existing := range cliCfg.SwaggerURLs {
				if existing == urlStr {
					found = true
					break
				}
			}
			if !found {
				cliCfg.SwaggerURLs = append(cliCfg.SwaggerURLs, urlStr)
			}
		}
	}

	if len(cliCfg.DisabledEndpoints) > 0 {
		if cliCfg.Endpoints == nil {
			cliCfg.Endpoints = &struct {
				Include []string `json:"include"`
				Exclude []string `json:"exclude"`
			}{}
		}
		for _, ep := range cliCfg.DisabledEndpoints {
			found := false
			for _, existing := range cliCfg.Endpoints.Exclude {
				if existing == ep {
					found = true
					break
				}
			}
			if !found {
				cliCfg.Endpoints.Exclude = append(cliCfg.Endpoints.Exclude, ep)
			}
		}
	}

	// Validate the configuration schema
	if err := cliCfg.Validate(); err != nil {
		log.Fatalf("Configuration validation failed: %v", err)
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

	// 2. Fetch and parse specs
	var allEndpoints []swagger.EndpointConfig
	basePath := cliCfg.BaseURL

	for _, urlStr := range cliCfg.SwaggerURLs {
		specRaw, err := fetchSpec(urlStr, cliCfg.Headers, cliCfg.Security.AllowPrivateIPs)
		if err != nil {
			log.Fatalf("Failed to fetch spec %s: %v", urlStr, err)
		}
		parsed, err := swagger.ParseRawSpec(specRaw)
		if err != nil {
			if swagger.IsPostman(specRaw) {
				parsedPostman, errPostman := postman.ParsePostman(specRaw)
				if errPostman != nil {
					log.Fatalf("Failed to parse spec %s as Postman Collection: %v", urlStr, errPostman)
				}
				parsed = parsedPostman
			} else {
				// Try GraphQL parser fallback
				defaultPath := "/graphql"
				if parsedURL, errURL := url.Parse(urlStr); errURL == nil {
					if parsedURL.Path != "" && parsedURL.Path != "/" {
						defaultPath = parsedURL.Path
					}
				}
				parsedGQL, errGQL := graphql.ParseGraphQLIntrospection(specRaw, defaultPath)
				if errGQL != nil {
					log.Fatalf("Failed to parse spec %s as OpenAPI (%v) or GraphQL (%v)", urlStr, err, errGQL)
				}
				parsed = parsedGQL
			}
		}
		if basePath == "" {
			if parsedURL, errURL := url.Parse(urlStr); errURL == nil && parsedURL.Host != "" {
				basePath = parsedURL.Scheme + "://" + parsedURL.Host
			} else {
				basePath = parsed.BasePath
			}
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
		BaseURL:        basePath,
		GlobalHeaders:  cliCfg.Headers,
		Cookies:        cliCfg.Cookies,
		WordlistFiles:  cliCfg.WordlistFiles,
		Dictionaries:   cliCfg.Dictionaries,
		Settings:       cliCfg.Settings,
		Endpoints:      allEndpoints,
		Rules:          cliCfg.Rules,
		AuthSequence:   cliCfg.AuthSequence,
		AuthIdentities: cliCfg.AuthIdentities,
		Variables:      cliCfg.Variables,
		Security:       cliCfg.Security,
	}

	if err := swagger.LoadWordlists(runCfg); err != nil {
		log.Fatalf("Failed to load custom wordlists: %v", err)
	}

	// 4. Initialize and start runner
	client := &http.Client{Timeout: time.Duration(runCfg.Settings.TimeoutMs) * time.Millisecond}
	r := runner.New(runCfg, client)
	defer r.Close()

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

	var oldState *term.State
	isRaw := false
	if state, err := term.MakeRaw(int(os.Stdin.Fd())); err == nil {
		oldState = state
		isRaw = true
	}

	restoreTerm := func() {
		if isRaw && oldState != nil {
			_ = term.Restore(int(os.Stdin.Fd()), oldState)
			isRaw = false
		}
	}
	defer restoreTerm()

	if isRaw {
		go func() {
			buf := make([]byte, 3)
			for {
				n, err := os.Stdin.Read(buf)
				if err != nil {
					break
				}
				if n == 1 {
					b := buf[0]
					if b == 3 || b == 4 { // Ctrl+C or Ctrl+D
						restoreTerm()
						fmt.Println("\nStopping fuzzing run...")
						r.Stop()
						return
					}
					if b == '+' || b == '=' {
						c := r.GetConcurrency()
						r.SetConcurrency(c + 1)
					}
					if b == '-' || b == '_' {
						c := r.GetConcurrency()
						if c > 1 {
							r.SetConcurrency(c - 1)
						}
					}
				} else if n >= 3 && buf[0] == 27 && buf[1] == 91 {
					if buf[2] == 65 { // Up arrow
						c := r.GetConcurrency()
						r.SetConcurrency(c + 1)
					} else if buf[2] == 66 { // Down arrow
						c := r.GetConcurrency()
						if c > 1 {
							r.SetConcurrency(c - 1)
						}
					}
				}
			}
		}()
	}

	fmt.Printf("Starting fuzz run on %d endpoints across %d profiles...\n", len(allEndpoints), len(cliCfg.Settings.Profiles))
	if err := r.Start(ctx); err != nil {
		restoreTerm()
		log.Fatalf("Run failed: %v", err)
	}

	restoreTerm()
	r.Unsubscribe(resultsCh)
	fmt.Println("\nRun complete.")

	// 5. Generate outputs
	resultsMu.Lock()
	finalResults := results
	resultsMu.Unlock()

	// Load ignore rules
	ignoreRules, err := classifier.LoadIgnoreRules(*ignoreConfig)
	if err != nil {
		log.Fatalf("Failed to load ignore rules: %v", err)
	}

	// Map swagger.RulesConfig to classifier.RulesConfig
	clsRules := &classifier.RulesConfig{
		IgnoreRules: ignoreRules,
	}
	if runCfg.Rules != nil {
		clsRules.Ignore = runCfg.Rules.Ignore
		clsRules.Severity = make(map[string]classifier.Severity)
		clsRules.Defaults = make(map[string]classifier.Severity)
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
		if err := writeJSON(*sarifOut, report); err != nil {
			log.Printf("Failed to save SARIF: %v", err)
		} else {
			fmt.Printf("Saved SARIF to %s\n", *sarifOut)
		}
	}
	if *jsonOut != "" {
		report := output.ToJSON(findings, &stats, "0.1.0")
		if err := writeJSON(*jsonOut, report); err != nil {
			log.Printf("Failed to save JSON: %v", err)
		} else {
			fmt.Printf("Saved JSON to %s\n", *jsonOut)
		}
	}
	if *htmlOut != "" {
		html := output.ToHTML(findings, &stats)
		if err := os.WriteFile(*htmlOut, []byte(html), 0600); err != nil { // #nosec G306 -- report file, 0600 is appropriate
			log.Printf("Failed to write HTML report: %v", err)
		} else {
			fmt.Printf("Saved HTML to %s\n", *htmlOut)
		}
	}
	if *junitOut != "" {
		junitData := output.ToJUnit(findings, &stats)
		if err := os.WriteFile(*junitOut, junitData, 0600); err != nil { // #nosec G306
			log.Printf("Failed to write JUnit report: %v", err)
		} else {
			fmt.Printf("Saved JUnit XML to %s\n", *junitOut)
		}
	}
	if *markdownOut != "" {
		mdData := output.ToMarkdown(findings, &stats, Version)
		if err := os.WriteFile(*markdownOut, mdData, 0600); err != nil { // #nosec G306
			log.Printf("Failed to write Markdown report: %v", err)
		} else {
			fmt.Printf("Saved Markdown to %s\n", *markdownOut)
		}
	}

	if classifier.FindingsExceedThreshold(findings, *failOnSeverity) {
		fmt.Printf("\n\033[1;31m[CI/CD] Findings at or above '%s' severity detected. Exiting with code 2.\033[0m\n", *failOnSeverity)
		os.Exit(2)
	}
}

func fetchSpec(urlStr string, headers map[string]string, allowPrivate bool) (json.RawMessage, error) {
	if !strings.HasPrefix(urlStr, "http://") && !strings.HasPrefix(urlStr, "https://") {
		return os.ReadFile(urlStr) // #nosec G304 -- path is a CLI-supplied swagger spec path, not attacker-controlled
	}

	client := security.NewSSRFProtectedClient(10 * time.Second, allowPrivate)
	return swagger.FetchRemoteSpec(context.Background(), client, urlStr, headers, graphql.IntrospectionQuery)
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

func writeJSON(path string, data any) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600) // #nosec G302 G306
	if err != nil {
		return err
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	return enc.Encode(data)
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

	fmt.Printf("⚡ \033[1;34mSWAZZ ENGINE\033[0m running...\033[K\r\n")
	fmt.Printf("🎯 \033[1mProgress:\033[0m [%d%%] %d/%d reqs | %.1f rps (concurrency: %d [+/- or Arrows to change])\033[K\r\n", pct, stats.TotalRequests, stats.TotalPlanned, stats.RequestsPerSec, stats.Concurrency)
	fmt.Printf("🌐 \033[1mActive:\033[0m   %s\033[K\r\n", ep)

	if len(sortedProfiles) == 0 {
		fmt.Printf("📊 \033[1mStatus:\033[0m   waiting...\033[K\r\n")
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
			fmt.Printf("📊 \033[1mStatus [%-10s]:\033[0m %s\033[K\r\n", p, statusStr)
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


	}
	fmt.Println("\n" + sep)
}
