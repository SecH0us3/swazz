// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"swazz-engine/internal/discovery"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// discoverOptions holds all parsed CLI flags for the discover command.
type discoverOptions struct {
	Namespaces        []string
	ExcludeNamespaces []string
	LabelSelector     string
	Concurrency       int
	Profiles          []string
	Iterations        int
	OutputDir         string
	UploadTo          string // "local", "coordinator"
	UploadPath        string // local dir
	CoordinatorURL    string
	CoordinatorToken  string
	WebhookURL        string
	SARIF             bool
	HTML              bool
	JSON              bool
	DryRun            bool
}

func parseDiscoverFlags(args []string) (*discoverOptions, error) {
	flags := flag.NewFlagSet("discover", flag.ContinueOnError)
	opts := &discoverOptions{}

	var namespaces, excludeNS, profiles string

	flags.StringVar(&namespaces, "namespace", "", "Comma-separated namespaces to scan (default: all)")
	flags.StringVar(&excludeNS, "exclude-namespace", "kube-system,kube-public,kube-node-lease", "Comma-separated namespaces to exclude")
	flags.StringVar(&opts.LabelSelector, "label-selector", "", "Additional K8s label selector")
	flags.IntVar(&opts.Concurrency, "concurrency", 5, "Concurrent MCP probes and scan workers")
	flags.StringVar(&profiles, "profiles", "BOUNDARY,MALICIOUS", "Comma-separated fuzzing profiles")
	flags.IntVar(&opts.Iterations, "iterations", 10, "Iterations per fuzzing profile")
	flags.StringVar(&opts.OutputDir, "output-dir", "/tmp/swazz-discovery", "Directory for generated configs and reports")
	flags.StringVar(&opts.UploadTo, "upload-to", "local", "Upload target: local, coordinator")
	flags.StringVar(&opts.UploadPath, "upload-path", "", "Local path for report upload")
	flags.StringVar(&opts.CoordinatorURL, "coordinator-url", "", "Swazz Coordinator API URL for result upload")
	flags.StringVar(&opts.CoordinatorToken, "coordinator-token", "", "Auth token for Coordinator API")
	flags.StringVar(&opts.WebhookURL, "webhook-url", "", "Webhook URL for scan notifications")
	flags.BoolVar(&opts.SARIF, "sarif", false, "Generate SARIF reports")
	flags.BoolVar(&opts.HTML, "html", false, "Generate HTML reports")
	flags.BoolVar(&opts.JSON, "json", false, "Generate JSON reports")
	flags.BoolVar(&opts.DryRun, "dry-run", false, "Discover and probe only, don't fuzz")

	if err := flags.Parse(args); err != nil {
		return nil, err
	}

	if namespaces != "" {
		opts.Namespaces = strings.Split(namespaces, ",")
	}
	if excludeNS != "" {
		opts.ExcludeNamespaces = strings.Split(excludeNS, ",")
	}
	if profiles != "" {
		opts.Profiles = strings.Split(profiles, ",")
	}

	if opts.Concurrency <= 0 {
		return nil, fmt.Errorf("concurrency must be greater than 0")
	}
	if opts.Iterations <= 0 {
		return nil, fmt.Errorf("iterations must be greater than 0")
	}

	return opts, nil
}

func runDiscover(args []string) {
	if err := runDiscoverCLIErr(args); err != nil {
		log.Fatalf("%v", err)
	}
}

func runDiscoverCLIErr(args []string) error {
	opts, err := parseDiscoverFlags(args)
	if err != nil {
		return fmt.Errorf("failed to parse discover flags: %w", err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// 1. Build K8s client (in-cluster config)
	config, err := rest.InClusterConfig()
	if err != nil {
		return fmt.Errorf("failed to get in-cluster K8s config (are you running inside a K8s pod?): %w", err)
	}
	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return fmt.Errorf("failed to create K8s client: %w", err)
	}

	// 2. Discover MCP services
	fmt.Println("🔍 Discovering MCP services in cluster...")
	services, err := discovery.ListMCPServices(ctx, clientset, discovery.ListOptions{
		NamespaceInclude: opts.Namespaces,
		NamespaceExclude: opts.ExcludeNamespaces,
		LabelSelector:    opts.LabelSelector,
	})
	if err != nil {
		return fmt.Errorf("discovery failed: %w", err)
	}
	fmt.Printf("   Found %d MCP-annotated services\n", len(services))

	if len(services) == 0 {
		fmt.Println("✅ No MCP services found. Nothing to scan.")
		return nil
	}

	// 3. Probe each service
	fmt.Println("🔌 Probing MCP endpoints...")
	secretResolver := makeK8sSecretResolver(ctx, clientset)
	probed := discovery.ProbeAll(ctx, services, opts.Concurrency, secretResolver)

	var validServers []discovery.ProbedServer
	for _, p := range probed {
		if p.ProbeError != nil {
			fmt.Printf("   ⚠️  %s/%s — probe failed: %v\n", p.Namespace, p.Name, p.ProbeError)
			continue
		}
		fmt.Printf("   ✅ %s/%s — %d tools discovered\n", p.Namespace, p.Name, len(p.Tools))
		validServers = append(validServers, p)
	}

	if len(validServers) == 0 {
		fmt.Println("⚠️  No valid MCP servers found after probing.")
		return nil
	}

	// 4. Generate configs
	configDir := filepath.Join(opts.OutputDir, "configs")
	reportDir := filepath.Join(opts.OutputDir, "reports")
	if err := os.MkdirAll(configDir, 0o750); err != nil {
		fmt.Printf("   ⚠️  Failed to create config directory %s: %v\n", configDir, err)
		return nil
	}
	if err := os.MkdirAll(reportDir, 0o750); err != nil {
		fmt.Printf("   ⚠️  Failed to create report directory %s: %v\n", reportDir, err)
		return nil
	}

	fmt.Println("📝 Generating scan configs...")
	var configPaths []string
	for _, server := range validServers {
		path, err := discovery.GenerateConfigFile(server, discovery.DiscoveryConfig{
			Profiles:             opts.Profiles,
			Concurrency:          opts.Concurrency,
			IterationsPerProfile: opts.Iterations,
			WebhookURL:           opts.WebhookURL,
		}, configDir)
		if err != nil {
			fmt.Printf("   ⚠️  Config generation failed for %s/%s: %v\n", server.Namespace, server.Name, err)
			continue
		}
		configPaths = append(configPaths, path)
		fmt.Printf("   📄 %s\n", path)
	}

	if opts.DryRun {
		fmt.Println("\n🏁 Dry run complete. Generated configs are in:", configDir)
		return nil
	}

	// 5. Run fuzzing for each generated config
	fmt.Println("\n⚡️ Starting security scans...")
	for _, cfgPath := range configPaths {
		base := strings.TrimSuffix(filepath.Base(cfgPath), ".json")
		fmt.Printf("\n   🔫 Scanning: %s\n", base)

		scanArgs := []string{"--config", cfgPath, "--allow-private-ips", "--quiet"}
		if opts.SARIF {
			scanArgs = append(scanArgs, "--sarif", filepath.Join(reportDir, base+".sarif"))
		}
		if opts.HTML {
			scanArgs = append(scanArgs, "--html", filepath.Join(reportDir, base+".html"))
		}
		if opts.JSON {
			scanArgs = append(scanArgs, "--json", filepath.Join(reportDir, base+".json"))
		}

		if err := runCLIErr(scanArgs); err != nil {
			fmt.Printf("   ⚠️  Scan failed for %s: %v\n", base, err)
		}
	}

	// 6. Upload results
	if opts.UploadTo != "" {
		if opts.UploadTo == "coordinator" && opts.CoordinatorURL == "" {
			fmt.Println("   ⚠️  Upload skipped: --coordinator-url is required for coordinator upload target")
		} else if opts.UploadTo == "local" && opts.UploadPath == "" {
			fmt.Println("   ⚠️  Upload skipped: --upload-path is required for local upload target")
		} else {
			fmt.Println("\n📤 Uploading reports...")
			uploadTarget := discovery.UploadTarget{
				Type:           opts.UploadTo,
				Prefix:         opts.UploadPath,
				CoordinatorURL: opts.CoordinatorURL,
				Token:          opts.CoordinatorToken,
			}
			if err := discovery.UploadReports(ctx, reportDir, uploadTarget); err != nil {
				fmt.Printf("   ⚠️  Upload failed: %v\n", err)
			} else {
				fmt.Println("   ✅ Reports uploaded successfully")
			}
		}
	}

	fmt.Printf("\n🏁 Discovery scan complete. Reports in: %s\n", reportDir)
	return nil
}

func makeK8sSecretResolver(ctx context.Context, clientset kubernetes.Interface) discovery.SecretResolver {
	return func(namespace, secretName string) (string, error) {
		secret, err := clientset.CoreV1().Secrets(namespace).Get(ctx, secretName, metav1.GetOptions{})
		if err != nil {
			return "", err
		}
		if token, ok := secret.Data["token"]; ok {
			return string(token), nil
		}
		return "", fmt.Errorf("secret %s/%s has no 'token' key", namespace, secretName)
	}
}
