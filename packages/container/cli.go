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
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"swazz-engine/internal/agent"
	"swazz-engine/internal/classifier"
	"swazz-engine/internal/config"
	"swazz-engine/internal/license"
	"swazz-engine/internal/logger"
	"swazz-engine/internal/output"
	"swazz-engine/internal/runner"
	"swazz-engine/internal/swagger"
	"swazz-engine/internal/wafcheck"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/term"
)

func runCLI(args []string) {
	if err := runCLIErr(args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func runCLIErr(args []string) error {
	flags := flag.NewFlagSet("start", flag.ContinueOnError)
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
	mcpListTools := flags.Bool("mcp-list-tools", false, "List the target MCP server's tools and exit without fuzzing")
	mcpFuzzMethods := flags.Bool("mcp-fuzz-methods", false, "Fuzz MCP server method/tool name dispatching for reflection, traversal and prototype pollution vulnerabilities")
	wafPatchVendor := flags.String("waf-patch", "", "Generate WAF virtual patch rules for vendor (e.g. cloudflare, aws, all)")
	wafPatchOutput := flags.String("waf-patch-output", "", "Path to save generated WAF virtual patch rules")

	if err := flags.Parse(args); err != nil {
		return err
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
		return fmt.Errorf("failed to read config file %s: %w", *configPath, err)
	}
	configData = swagger.StripJSONC(configData)

	cliCfg := config.CliConfig{
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: false,
		},
	}
	if err := json.Unmarshal(configData, &cliCfg); err != nil {
		return fmt.Errorf("invalid config JSON: %w", err)
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

	var activeLicense *license.License
	licenseKey := cliCfg.LicenseKey
	if licenseKey == "" {
		licenseKey = os.Getenv("SWAZZ_LICENSE_KEY")
	}
	if licenseKey != "" {
		lic, err := license.LoadAndVerify(licenseKey)
		if err != nil {
			logger.Warn("⚠️  License verification failed: %v (running in community mode)", err)
		} else if lic != nil {
			activeLicense = lic
			logger.Info("🔑 Enterprise license active: %s (expires %s)", lic.Company, lic.ExpiresAt.Format("2006-01-02"))
			if lic.IsExpiringSoon(3) {
				logger.Warn("⚠️  License expires soon: %d day(s) remaining (expires %s)", lic.DaysRemaining(), lic.ExpiresAt.Format("2006-01-02"))
			}
		}
	}
	gate := license.GateFromLicense(activeLicense)

	if *mcpFuzzMethods {
		b := true
		cliCfg.Settings.EnableMCPMethodFuzzing = &b
	}

	runCfg, err := config.BuildRunnerConfig(&cliCfg)
	if err != nil {
		log.Fatalf("Failed to build runner config: %v", err)
	}

	if *mcpListTools {
		return listMCPTools(runCfg)
	}

	// 4. Initialize and start runner
	client := &http.Client{Timeout: time.Duration(runCfg.Settings.TimeoutMs) * time.Millisecond}
	r := runner.New(runCfg, client, gate)
	defer r.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sigCh)
	go func() {
		select {
		case <-sigCh:
			fmt.Println("\nStopping fuzzing run...")
			r.Stop()
		case <-ctx.Done():
			return
		}
	}()

	// Run auth sequence if present
	if err := r.RunAuthSequence(ctx); err != nil {
		log.Fatalf("Authentication failed: %v", err)
	}

	resultsCh := r.Subscribe()
	var results []*swagger.FuzzResult
	var resultsMu sync.Mutex
	resultsDone := make(chan struct{})

	go func() {
		defer close(resultsDone)
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
		logger.SetRawTerminal(true)
	}

	restoreTerm := func() {
		if isRaw && oldState != nil {
			logger.SetRawTerminal(false)
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
	agent.IncrementGlobalScanTelemetry(telemetryURL, disableTelemetryVal)

	if err := r.Start(ctx); err != nil {
		restoreTerm()
		log.Fatalf("Run failed: %v", err)
	}

	restoreTerm()
	r.Unsubscribe(resultsCh)
	<-resultsDone

	stats := r.GetStats()
	runDuration := time.Duration(stats.TotalDurationMs) * time.Millisecond
	logger.Info("Run complete. Total scan time: %v (%d requests executed)", runDuration, stats.TotalRequests)

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

	printSummary(findings, &stats)

	requireExport := func(name string) error {
		if gate.Has(license.FeatureReportExports) {
			return nil
		}
		return fmt.Errorf("report export '%s' requires a paid plan (feature: %s)", name, license.FeatureReportExports)
	}

	if *sarifOut != "" {
		if err := requireExport("sarif"); err != nil {
			return err
		}
		report := output.ToSARIF(findings, "0.1.0", runCfg.BaseURL)
		if err := config.WriteJSON(*sarifOut, report); err != nil {
			log.Printf("Failed to save SARIF: %v", err)
		} else {
			logger.Info("Saved SARIF to %s", *sarifOut)
		}
	}
	if *jsonOut != "" {
		report := output.ToJSON(findings, &stats, "0.1.0")
		if err := config.WriteJSON(*jsonOut, report); err != nil {
			log.Printf("Failed to save JSON: %v", err)
		} else {
			logger.Info("Saved JSON to %s", *jsonOut)
		}
	}
	if *htmlOut != "" {
		if err := requireExport("html"); err != nil {
			return err
		}
		html := output.ToHTML(findings, &stats)
		cleanHTML := filepath.Clean(*htmlOut)
		if err := os.WriteFile(cleanHTML, []byte(html), 0600); err != nil { // #nosec G306,G703 -- report file output
			log.Printf("Failed to write HTML report: %v", err)
		} else {
			logger.Info("Saved HTML to %s", *htmlOut)
		}
	}
	if *junitOut != "" {
		if err := requireExport("junit"); err != nil {
			return err
		}
		junitData := output.ToJUnit(findings, &stats)
		cleanJUnit := filepath.Clean(*junitOut)
		if err := os.WriteFile(cleanJUnit, junitData, 0600); err != nil { // #nosec G306,G703 -- report file output
			log.Printf("Failed to write JUnit report: %v", err)
		} else {
			logger.Info("Saved JUnit XML to %s", *junitOut)
		}
	}
	if *markdownOut != "" {
		if err := requireExport("markdown"); err != nil {
			return err
		}
		mdData := output.ToMarkdown(findings, &stats, Version)
		cleanMD := filepath.Clean(*markdownOut)
		if err := os.WriteFile(cleanMD, mdData, 0600); err != nil { // #nosec G306,G703 -- report file output
			log.Printf("Failed to write Markdown report: %v", err)
		} else {
			logger.Info("Saved Markdown to %s", *markdownOut)
		}
	}
	if *wafPatchVendor != "" {
		if err := requireExport("waf-patch"); err != nil {
			return err
		}
		items := classifier.ToAuditResultItems(findings)
		if len(items) == 0 {
			logger.Info("no WAF-patchable findings in this scan")
		} else {
			patchClient := wafcheck.NewClient(runCfg.Settings.WAFCheckEndpoint)
			patchReport, err := patchClient.GeneratePatches(ctx, items, wafcheck.PatchOptions{
				Vendor:           *wafPatchVendor,
				TargetURL:        runCfg.BaseURL,
				IncludeTerraform: true,
			})
			if err != nil {
				// An optional report export must never fail the scan itself.
				log.Printf("Failed to generate WAF virtual patches: %v", err)
			} else {
				outPath := *wafPatchOutput
				if outPath == "" {
					outPath = fmt.Sprintf("waf-patch-%s.txt", *wafPatchVendor)
				}
				var nativeContent, tfContent string
				if bundle, ok := patchReport.Bundles[*wafPatchVendor]; ok {
					nativeContent = bundle.Native
					tfContent = bundle.Terraform
				} else {
					for v, b := range patchReport.Bundles {
						if b.Native != "" {
							nativeContent += fmt.Sprintf("# Vendor: %s\n%s\n\n", v, b.Native)
						}
						if b.Terraform != "" {
							tfContent += fmt.Sprintf("# Vendor: %s\n%s\n\n", v, b.Terraform)
						}
					}
				}
				cleanOut := filepath.Clean(outPath)
				if err := os.WriteFile(cleanOut, []byte(nativeContent), 0600); err != nil { // #nosec G306,G703 -- report file output
					log.Printf("Failed to write WAF patch output: %v", err)
				} else {
					logger.Info("Saved WAF patch rules to %s", outPath)
				}
				if tfContent != "" {
					cleanTF := strings.TrimSuffix(cleanOut, filepath.Ext(cleanOut)) + ".tf"
					if err := os.WriteFile(cleanTF, []byte(tfContent), 0600); err != nil { // #nosec G306,G703 -- report file output
						log.Printf("Failed to write WAF patch terraform output: %v", err)
					} else {
						logger.Info("Saved WAF patch Terraform to %s", cleanTF)
					}
				}
			}
		}
	}

	if classifier.FindingsExceedThreshold(findings, *failOnSeverity) {
		fmt.Fprintf(os.Stderr, "\n\033[1;31m[CI/CD] Findings at or above '%s' severity detected. Exiting with code 2.\033[0m\n", *failOnSeverity)
		os.Exit(2)
	}
	return nil
}
