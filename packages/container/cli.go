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
	"swazz-engine/internal/classifier"
	"swazz-engine/internal/graphql"
	"swazz-engine/internal/logger"
	"swazz-engine/internal/output"
	"swazz-engine/internal/postman"
	"swazz-engine/internal/har"
	"swazz-engine/internal/mcp"
	"swazz-engine/internal/runner"
	"swazz-engine/internal/safenet"
	"swazz-engine/internal/swagger"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/term"
)

type CliConfig struct {
	SwaggerURLs         []string                `json:"swagger_urls"`
	SwaggerURLsAlias    []string                `json:"_swagger_urls"`
	BaseURL             string                  `json:"base_url"`
	Headers             map[string]string       `json:"headers"`
	GlobalHeaders       map[string]string       `json:"global_headers"`
	Cookies             map[string]string       `json:"cookies"`
	WordlistFiles       map[string]string       `json:"wordlist_files"`
	Dictionaries        map[string][]any        `json:"dictionaries"`
	Settings            swagger.Settings        `json:"settings"`
	Endpoints           *struct {
		Include []string `json:"include"`
		Exclude []string `json:"exclude"`
	} `json:"endpoints"`
	// EndpointDefinitions holds pre-parsed endpoints (e.g. from browser extension HAR capture).
	// When populated, swagger_url is not required — the runner uses these directly.
	EndpointDefinitions []swagger.EndpointConfig         `json:"endpoint_definitions,omitempty"`
	DisabledEndpoints   []string                         `json:"disabled_endpoints"`
	Rules               *swagger.RulesConfig             `json:"rules"`
	AuthSequence        []swagger.AuthStep               `json:"auth_sequence"`
	AuthIdentities      map[string]swagger.AuthIdentity  `json:"auth_identities,omitempty"`
	Variables           map[string]any                   `json:"variables,omitempty"`
	Security            swagger.SecurityConfig           `json:"security"`
	MCPServer           *swagger.MCPServerConfig         `json:"mcp_server,omitempty"`
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

func (c *CliConfig) UnmarshalJSON(data []byte) error {
	type alias CliConfig
	var aux struct {
		*alias
		Endpoints json.RawMessage `json:"endpoints"`
	}
	aux.alias = (*alias)(c)
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}

	if len(aux.Endpoints) > 0 {
		trimmed := strings.TrimSpace(string(aux.Endpoints))
		if strings.HasPrefix(trimmed, "[") {
			// It's an array of endpoint definitions (e.g. browser extension HAR sync or imported config)
			var defs []swagger.EndpointConfig
			if err := json.Unmarshal(aux.Endpoints, &defs); err != nil {
				return fmt.Errorf("failed to parse endpoints array: %w", err)
			}
			c.EndpointDefinitions = append(c.EndpointDefinitions, defs...)
			c.Endpoints = nil
		} else if strings.HasPrefix(trimmed, "{") {
			// It's a standard include/exclude filter object
			var filter struct {
				Include []string `json:"include"`
				Exclude []string `json:"exclude"`
			}
			if err := json.Unmarshal(aux.Endpoints, &filter); err != nil {
				return fmt.Errorf("failed to parse endpoints object: %w", err)
			}
			c.Endpoints = &struct {
				Include []string `json:"include"`
				Exclude []string `json:"exclude"`
			}{
				Include: filter.Include,
				Exclude: filter.Exclude,
			}
		}
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
	logLevelFlag := flags.String("log-level", "", "Log level: debug, info, warn, error")
	quietFlag := flags.Bool("quiet", false, "Silence all progress output (only show errors)")
	qFlag := flags.Bool("q", false, "Silence all progress output (alias of -quiet)")
	progressOnChangeFlag := flags.Bool("progress-on-change", false, "Only print progress when the active endpoint changes")
	disableTelemetry := flags.Bool("disable-telemetry", false, "Disable reporting anonymous global scan count telemetry")

	if err := flags.Parse(args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	disableTelemetryVal := *disableTelemetry
	if os.Getenv("SWAZZ_DISABLE_TELEMETRY") == "true" {
		disableTelemetryVal = true
	}

	allowPrivateExplicit := false
	flags.Visit(func(f *flag.Flag) {
		if f.Name == "allow-private-ips" {
			allowPrivateExplicit = true
		}
	})

	hasDebug := *debugMode
	hasQuiet := *quietFlag || *qFlag
	hasLogLevel := *logLevelFlag != ""

	// 1. Read config
	configData, err := os.ReadFile(*configPath)
	if err != nil {
		log.Fatalf("Failed to read config file %s: %v", *configPath, err)
	}
	configData = swagger.StripJSONC(configData)

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

	var finalLevel string
	envLevel := os.Getenv("SWAZZ_LOG_LEVEL")
	if envLevel != "" {
		finalLevel = envLevel
	} else {
		finalLevel = "info"
	}

	if hasDebug {
		finalLevel = "debug"
	}
	if hasQuiet {
		finalLevel = "error"
	}
	if hasLogLevel {
		if hasDebug {
			fmt.Fprintf(os.Stderr, "Warning: both -debug and -log-level specified, using -log-level %s\n", *logLevelFlag)
		}
		finalLevel = *logLevelFlag
	}

	logger.SetLevelByName(finalLevel)
	cliCfg.Settings.Debug = (logger.GetLevel() == logger.LevelDebug)

	runCfg, err := BuildRunnerConfig(&cliCfg)
	if err != nil {
		log.Fatalf("Failed to build runner config: %v", err)
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
		var lastEndpoint string
		var lastProfile string
		for evt := range resultsCh {
			if evt.Type == runner.EventResult {
				if res, ok := evt.Data.(*swagger.FuzzResult); ok {
					resultsMu.Lock()
					results = append(results, res)
					resultsMu.Unlock()
				}
			} else if evt.Type == runner.EventProgress {
				if stats, ok := evt.Data.(swagger.RunStats); ok {
					if *progressOnChangeFlag {
						currEp := stats.Progress.CurrentEndpoint
						currProf := stats.Progress.CurrentProfile
						if (currEp != "" && currEp != lastEndpoint) || (currProf != "" && currProf != lastProfile) {
							lastEndpoint = currEp
							lastProfile = currProf
							printProgressClean(stats)
						}
					} else {
						printProgress(stats)
					}
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

	telemetryURL := "https://swazz.secmy.app/api/telemetry/scans/increment"
	if envURL := os.Getenv("SWAZZ_TELEMETRY_URL"); envURL != "" {
		telemetryURL = envURL
	}
	incrementGlobalScanTelemetry(telemetryURL, disableTelemetryVal)

	logger.Info("Starting fuzz run on %d endpoints across %d profiles...", len(runCfg.Endpoints), len(runCfg.Settings.Profiles))
	if err := r.Start(ctx); err != nil {
		restoreTerm()
		log.Fatalf("Run failed: %v", err)
	}

	restoreTerm()
	r.Unsubscribe(resultsCh)
	logger.Info("Run complete.")

	// 5. Generate outputs
	resultsMu.Lock()
	finalResults := results
	resultsMu.Unlock()

	// Load ignore rules
	ignoreRules, err := classifier.LoadIgnoreRules(*ignoreConfig)
	if err != nil {
		log.Fatalf("Failed to load ignore rules: %v", err)
	}

	var combinedIgnoreRules []classifier.IgnoreRule
	combinedIgnoreRules = append(combinedIgnoreRules, ignoreRules...)
	if runCfg.Rules != nil && len(runCfg.Rules.IgnoreRules) > 0 {
		combinedIgnoreRules = append(combinedIgnoreRules, runCfg.Rules.IgnoreRules...)
	}

	// Map swagger.RulesConfig to classifier.RulesConfig
	clsRules := &classifier.RulesConfig{
		IgnoreRules: combinedIgnoreRules,
	}
	if runCfg.Rules != nil {
		clsRules.Ignore = runCfg.Rules.Ignore
		// Only set Severity/Defaults when the user actually provided values.
		// Leaving them nil lets classifier.New fall back to the built-in defaults,
		// preventing an empty map from silently overriding defaultDefaults.
		if len(runCfg.Rules.Severity) > 0 {
			clsRules.Severity = make(map[string]classifier.Severity, len(runCfg.Rules.Severity))
			for k, v := range runCfg.Rules.Severity {
				clsRules.Severity[k] = classifier.Severity(v)
			}
		}
		if len(runCfg.Rules.Defaults) > 0 {
			clsRules.Defaults = make(map[string]classifier.Severity, len(runCfg.Rules.Defaults))
			for k, v := range runCfg.Rules.Defaults {
				clsRules.Defaults[k] = classifier.Severity(v)
			}
		}
	}

	cls := classifier.New(clsRules)
	findings := cls.ClassifyAll(finalResults)
	stats := r.GetStats()

	printSummary(findings, &stats)

	if *sarifOut != "" {
		report := output.ToSARIF(findings, "0.1.0", runCfg.BaseURL)
		if err := writeJSON(*sarifOut, report); err != nil {
			log.Printf("Failed to save SARIF: %v", err)
		} else {
			logger.Info("Saved SARIF to %s", *sarifOut)
		}
	}
	if *jsonOut != "" {
		report := output.ToJSON(findings, &stats, "0.1.0")
		if err := writeJSON(*jsonOut, report); err != nil {
			log.Printf("Failed to save JSON: %v", err)
		} else {
			logger.Info("Saved JSON to %s", *jsonOut)
		}
	}
	if *htmlOut != "" {
		html := output.ToHTML(findings, &stats)
		if err := os.WriteFile(*htmlOut, []byte(html), 0600); err != nil { // #nosec G306 -- report file, 0600 is appropriate
			log.Printf("Failed to write HTML report: %v", err)
		} else {
			logger.Info("Saved HTML to %s", *htmlOut)
		}
	}
	if *junitOut != "" {
		junitData := output.ToJUnit(findings, &stats)
		if err := os.WriteFile(*junitOut, junitData, 0600); err != nil { // #nosec G306
			log.Printf("Failed to write JUnit report: %v", err)
		} else {
			logger.Info("Saved JUnit XML to %s", *junitOut)
		}
	}
	if *markdownOut != "" {
		mdData := output.ToMarkdown(findings, &stats, Version)
		if err := os.WriteFile(*markdownOut, mdData, 0600); err != nil { // #nosec G306
			log.Printf("Failed to write Markdown report: %v", err)
		} else {
			logger.Info("Saved Markdown to %s", *markdownOut)
		}
	}

	if classifier.FindingsExceedThreshold(findings, *failOnSeverity) {
		fmt.Fprintf(os.Stderr, "\n\033[1;31m[CI/CD] Findings at or above '%s' severity detected. Exiting with code 2.\033[0m\n", *failOnSeverity)
		os.Exit(2)
	}
}

func BuildRunnerConfig(cliCfg *CliConfig) (*swagger.Config, error) {
	if safenet.AllowLocalNetwork {
		cliCfg.Security.AllowPrivateIPs = true
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
		return nil, fmt.Errorf("configuration validation failed: %v", err)
	}

	if cliCfg.MCPServer != nil {
		if cliCfg.MCPServer.Type != "stdio" && cliCfg.MCPServer.Type != "sse" && cliCfg.MCPServer.Type != "http" {
			return nil, fmt.Errorf("invalid mcp_server type: must be 'stdio', 'sse', or 'http'")
		}
		if cliCfg.MCPServer.Type == "stdio" {
			if cliCfg.MCPServer.Command == "" {
				return nil, fmt.Errorf("mcp_server command cannot be empty for stdio type")
			}
		}
		if cliCfg.MCPServer.Type == "sse" || cliCfg.MCPServer.Type == "http" {
			if cliCfg.MCPServer.URL == "" {
				return nil, fmt.Errorf("mcp_server url cannot be empty for %s type", cliCfg.MCPServer.Type)
			}
			if !strings.HasPrefix(cliCfg.MCPServer.URL, "http://") && !strings.HasPrefix(cliCfg.MCPServer.URL, "https://") {
				return nil, fmt.Errorf("mcp_server url must start with http:// or https://")
			}
		}
	}

	if len(cliCfg.SwaggerURLs) == 0 && len(cliCfg.EndpointDefinitions) == 0 && cliCfg.MCPServer == nil {
		return nil, fmt.Errorf("config must specify at least one swagger_url, provide endpoint_definitions (e.g. via browser extension sync), or configure mcp_server")
	}

	if cliCfg.Settings.IterationsPerProfile <= 0 {
		cliCfg.Settings = swagger.DefaultSettings()
	}
	if len(cliCfg.Settings.Profiles) == 0 {
		cliCfg.Settings.Profiles = swagger.DefaultSettings().Profiles
	}



	var allEndpoints []swagger.EndpointConfig
	basePath := cliCfg.BaseURL

	// Fast path: if endpoint_definitions are already provided (e.g. from browser extension
	// HAR capture synced via /api/parse), skip fetching/parsing swagger URLs entirely.
	if len(cliCfg.EndpointDefinitions) > 0 && len(cliCfg.SwaggerURLs) == 0 {
		logger.Debug("[Config] Using %d pre-parsed endpoint_definitions (browser extension mode)", len(cliCfg.EndpointDefinitions))
		allEndpoints = cliCfg.EndpointDefinitions
		if basePath == "" && cliCfg.MCPServer == nil {
			return nil, fmt.Errorf("no base_url found in config — required when using endpoint_definitions without swagger_url")
		}
	} else {
		// 2. Fetch and parse specs concurrently
		type specResult struct {
			urlStr    string
			endpoints []swagger.EndpointConfig
			basePath  string
			err       error
		}

		resChan := make(chan specResult, len(cliCfg.SwaggerURLs))
		var wg sync.WaitGroup

		for _, urlStr := range cliCfg.SwaggerURLs {
			wg.Add(1)
			go func(urlStr string) {
				defer wg.Done()
				logger.Debug("[Config] Fetching spec: %s", urlStr)
				startFetch := time.Now()

				headersCopy := make(map[string]string)
				for k, v := range cliCfg.Headers {
					headersCopy[k] = v
				}
				if len(cliCfg.Cookies) > 0 {
					var cookieParts []string
					for k, v := range cliCfg.Cookies {
						cookieParts = append(cookieParts, fmt.Sprintf("%s=%s", k, v))
					}
					headersCopy["Cookie"] = strings.Join(cookieParts, "; ")
				}

				specRaw, err := fetchSpec(urlStr, headersCopy, cliCfg.Security.AllowPrivateIPs)
				if err != nil {
					// fallback to MCP HTTP probe
					mcpClient := mcp.NewHTTPClient(urlStr)
					ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					defer cancel()
					if mcpErr := mcpClient.Connect(ctx); mcpErr == nil {
						// It is an MCP HTTP server!
						tools, _ := mcpClient.ListTools(ctx)
						var eps []swagger.EndpointConfig
						for _, t := range tools {
							eps = append(eps, swagger.EndpointConfig{
								Method: "MCP",
								Path:   t.Name,
								Schema: t.InputSchema,
							})
						}
						logger.Debug("[Config] Parsed MCP server %s: %d tools found", urlStr, len(eps))
						resChan <- specResult{
							urlStr:    urlStr,
							endpoints: eps,
							basePath:  urlStr,
						}
						return
					} else {
						logger.Debug("[Config] MCP fallback failed for %s: %v", urlStr, mcpErr)
					}
					resChan <- specResult{err: fmt.Errorf("failed to fetch spec %s: %w", urlStr, err)}
					return
				}

				fetchDur := time.Since(startFetch)
				logger.Debug("[Config] Fetched spec %s (size: %d bytes, took: %v)", urlStr, len(specRaw), fetchDur)

				var parseOpts []swagger.ParserOption
				if cliCfg.Settings.MaxNodesBudget > 0 {
					parseOpts = append(parseOpts, swagger.WithMaxNodes(cliCfg.Settings.MaxNodesBudget))
				}
				if cliCfg.Settings.MaxDepthLimit > 0 {
					parseOpts = append(parseOpts, swagger.WithMaxDepth(cliCfg.Settings.MaxDepthLimit))
				}

				parsed, err := swagger.ParseRawSpec(specRaw, parseOpts...)
				if err != nil {
					if swagger.IsHAR(specRaw) {
						parsedHAR, errHAR := har.ParseHAR(specRaw, cliCfg.Settings.HarDomainFilter)
						if errHAR != nil {
							resChan <- specResult{err: fmt.Errorf("failed to parse spec %s as HAR: %w", urlStr, errHAR)}
							return
						}
						parsed = parsedHAR
					} else if swagger.IsPostman(specRaw) {
						parsedPostman, errPostman := postman.ParsePostman(specRaw)
						if errPostman != nil {
							resChan <- specResult{err: fmt.Errorf("failed to parse spec %s as Postman Collection: %w", urlStr, errPostman)}
							return
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
							resChan <- specResult{err: fmt.Errorf("failed to parse spec %s as OpenAPI (%w) or GraphQL (%w)", urlStr, err, errGQL)}
							return
						}
						parsed = parsedGQL
					}
				}

				bp := ""
				if parsedURL, errURL := url.Parse(urlStr); errURL == nil && parsedURL.Host != "" {
					bp = parsedURL.Scheme + "://" + parsedURL.Host
				} else {
					bp = parsed.BasePath
				}

				logger.Debug("[Config] Parsed spec %s: %d endpoints found", urlStr, len(parsed.Endpoints))

				resChan <- specResult{
					urlStr:    urlStr,
					endpoints: parsed.Endpoints,
					basePath:  bp,
				}
			}(urlStr)
		}

		wg.Wait()
		close(resChan)

		// Collect results in the order of SwaggerURLs to keep order deterministic
		resultsMap := make(map[string]specResult)
		for res := range resChan {
			if res.err != nil {
				return nil, res.err
			}
			resultsMap[res.urlStr] = res
		}

		for _, urlStr := range cliCfg.SwaggerURLs {
			res := resultsMap[urlStr]
			if basePath == "" && res.basePath != "" {
				basePath = res.basePath
			}
			allEndpoints = append(allEndpoints, res.endpoints...)
		}

		// Also merge any pre-parsed endpoint_definitions on top of spec endpoints
		allEndpoints = append(allEndpoints, cliCfg.EndpointDefinitions...)

		if basePath == "" && cliCfg.MCPServer == nil {
			return nil, fmt.Errorf("no base_url found in config or specs")
		}
	}

	logger.Debug("[Config] Aggregated total endpoints: %d", len(allEndpoints))

	// 3. Filter endpoints
	if cliCfg.Endpoints != nil {
		logger.Debug("[Config] Filtering endpoints (Include: %d patterns, Exclude: %d patterns)",
			len(cliCfg.Endpoints.Include), len(cliCfg.Endpoints.Exclude))
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
		logger.Debug("[Config] Endpoints after filtering: %d", len(allEndpoints))
	}

	if len(allEndpoints) == 0 && cliCfg.MCPServer == nil {
		return nil, fmt.Errorf("no endpoints remaining after filtering")
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
		MCPServer:      cliCfg.MCPServer,
	}

	if err := swagger.LoadWordlists(runCfg); err != nil {
		return nil, fmt.Errorf("failed to load custom wordlists: %v", err)
	}

	return runCfg, nil
}
