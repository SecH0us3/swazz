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
	"swazz-engine/internal/output"
	"swazz-engine/internal/postman"
	"swazz-engine/internal/har"
	"swazz-engine/internal/runner"
	"swazz-engine/internal/swagger"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/term"
)

type CliConfig struct {
	SwaggerURLs      []string          `json:"swagger_urls"`
	SwaggerURLsAlias []string          `json:"_swagger_urls"`
	BaseURL          string            `json:"base_url"`
	Headers          map[string]string `json:"headers"`
	GlobalHeaders    map[string]string `json:"global_headers"`
	Cookies          map[string]string `json:"cookies"`
	WordlistFiles    map[string]string `json:"wordlist_files"`
	Dictionaries     map[string][]any  `json:"dictionaries"`
	Settings         swagger.Settings  `json:"settings"`
	Endpoints        *struct {
		Include []string `json:"include"`
		Exclude []string `json:"exclude"`
	} `json:"endpoints"`
	DisabledEndpoints []string                        `json:"disabled_endpoints"`
	Rules             *swagger.RulesConfig            `json:"rules"`
	AuthSequence      []swagger.AuthStep              `json:"auth_sequence"`
	AuthIdentities    map[string]swagger.AuthIdentity `json:"auth_identities,omitempty"`
	Variables         map[string]any                  `json:"variables,omitempty"`
	Security          swagger.SecurityConfig          `json:"security"`
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

	fmt.Printf("Starting fuzz run on %d endpoints across %d profiles...\n", len(runCfg.Endpoints), len(runCfg.Settings.Profiles))
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

func BuildRunnerConfig(cliCfg *CliConfig) (*swagger.Config, error) {
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

	if len(cliCfg.SwaggerURLs) == 0 {
		return nil, fmt.Errorf("config must specify at least one swagger_url")
	}

	if cliCfg.Settings.IterationsPerProfile <= 0 {
		cliCfg.Settings = swagger.DefaultSettings()
	}
	if len(cliCfg.Settings.Profiles) == 0 {
		cliCfg.Settings.Profiles = swagger.DefaultSettings().Profiles
	}

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
			fmt.Printf("[Config] Fetching spec: %s\n", urlStr)
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
				resChan <- specResult{err: fmt.Errorf("failed to fetch spec %s: %w", urlStr, err)}
				return
			}

			fetchDur := time.Since(startFetch)
			fmt.Printf("[Config] Fetched spec %s (size: %d bytes, took: %v)\n", urlStr, len(specRaw), fetchDur)

			parsed, err := swagger.ParseRawSpec(specRaw)
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

			fmt.Printf("[Config] Parsed spec %s: %d endpoints found\n", urlStr, len(parsed.Endpoints))

			resChan <- specResult{
				urlStr:    urlStr,
				endpoints: parsed.Endpoints,
				basePath:  bp,
			}
		}(urlStr)
	}

	wg.Wait()
	close(resChan)

	var allEndpoints []swagger.EndpointConfig
	basePath := cliCfg.BaseURL

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

	if basePath == "" {
		return nil, fmt.Errorf("no base_url found in config or specs")
	}

	fmt.Printf("[Config] Aggregated total endpoints: %d\n", len(allEndpoints))

	// 3. Filter endpoints
	if cliCfg.Endpoints != nil {
		fmt.Printf("[Config] Filtering endpoints (Include: %d patterns, Exclude: %d patterns)\n",
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
		fmt.Printf("[Config] Endpoints after filtering: %d\n", len(allEndpoints))
	}

	if len(allEndpoints) == 0 {
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
	}

	if err := swagger.LoadWordlists(runCfg); err != nil {
		return nil, fmt.Errorf("failed to load custom wordlists: %v", err)
	}

	return runCfg, nil
}
