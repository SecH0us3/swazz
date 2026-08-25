// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"nhooyr.io/websocket"
	"swazz-engine/internal/license"
	"swazz-engine/internal/logger"
	"swazz-engine/internal/safenet"
)

// startAgent parses the arguments and connects to the coordinator
func startAgent(args []string) {
	var coordinatorURL, token, name, keyPathOrHex, logLevelStr, logFilterStr string
	var dangerousNoContainer bool
	var hasQuiet, hasLogLevel bool
	var disableTelemetry bool

	// Simple arg parsing
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--dangerous-no-container":
			dangerousNoContainer = true
		case "--disable-telemetry":
			disableTelemetry = true
		case "--log-level", "-log-level":
			if i+1 < len(args) {
				logLevelStr = args[i+1]
				hasLogLevel = true
				i++
			}
		case "--quiet", "-quiet", "-q", "--q":
			hasQuiet = true
		case "--log-filter":
			if i+1 < len(args) {
				logFilterStr = args[i+1]
				logger.SetFilter(logFilterStr)
				i++
			}
		case "--coordinator":
			if i+1 < len(args) {
				coordinatorURL = args[i+1]
				i++
			}
		case "--token":
			if i+1 < len(args) {
				token = args[i+1]
				i++
			}
		case "--key":
			if i+1 < len(args) {
				keyPathOrHex = args[i+1]
				i++
			}
		case "--name":
			if i+1 < len(args) {
				name = args[i+1]
				i++
			}
		case "--help", "-h":
			printHelp()
			os.Exit(0)
		}
	}

	if os.Getenv("SWAZZ_DISABLE_TELEMETRY") == "true" {
		disableTelemetry = true
	}

	var finalLevel string
	envLevel := os.Getenv("SWAZZ_LOG_LEVEL")
	if envLevel != "" {
		finalLevel = envLevel
	} else {
		finalLevel = "info"
	}

	if hasQuiet {
		finalLevel = "error"
	}
	if hasLogLevel {
		finalLevel = logLevelStr
	}

	logger.SetLevelByName(finalLevel)

	agentLicenseKey := os.Getenv("SWAZZ_LICENSE_KEY")
	if agentLicenseKey != "" {
		lic, err := license.LoadAndVerify(agentLicenseKey)
		if err != nil {
			logWarn("⚠️  License verification failed: %v (running in community mode)", err)
		} else if lic != nil {
			logInfo("🔑 Enterprise license active: %s (expires %s)", lic.Company, lic.ExpiresAt.Format("2006-01-02"))
			if lic.IsExpiringSoon(3) {
				logWarn("⚠️  License expires soon: %d day(s) remaining (expires %s)", lic.DaysRemaining(), lic.ExpiresAt.Format("2006-01-02"))
			}
		}
	}

	safenet.AssertRunningInContainer(dangerousNoContainer)

	if coordinatorURL == "" {
		fmt.Println("Error: --coordinator is required for run-agent.")
		fmt.Println()
		printHelp()
		os.Exit(1)
	}

	var privKey ed25519.PrivateKey
	var pubKeyHex string
	var useSignatureAuth bool

	// If --key wasn't passed and --token wasn't passed, check default ./swazz_runner.key
	if keyPathOrHex == "" && token == "" {
		if _, err := os.Stat("./swazz_runner.key"); err == nil {
			keyPathOrHex = "./swazz_runner.key"
		}
	}

	if keyPathOrHex != "" {
		var err error
		privKey, err = loadPrivateKey(keyPathOrHex)
		if err != nil {
			log.Fatalf("Error loading private key: %v", err)
		}
		pubKey := privKey.Public().(ed25519.PublicKey)
		pubKeyHex = hex.EncodeToString(pubKey)
		useSignatureAuth = true
	} else {
		if token == "" {
			fmt.Println("Error: --coordinator and either --token or a private key are required for run-agent.")
			fmt.Println()
			printHelp()
			os.Exit(1)
		}
	}

	if name == "" {
		hostname, _ := os.Hostname()
		name = "runner-" + hostname
	}

	logInfo("Starting agent '%s', connecting to %s (log level: %s)", name, coordinatorURL, logLevelStr) // #nosec G706

	headers := make(http.Header)
	headers.Set("User-Agent", "Swazz/1.0 (+https://github.com/SecH0us3/swazz)")
	u, err := url.Parse(coordinatorURL)
	if err != nil {
		log.Fatalf("Failed to parse coordinator URL: %v", err)
	}
	q := u.Query()
	q.Set("name", name)
	agentVer := Version
	if agentVer == "dev" {
		agentVer = "v1.0.0"
	}
	q.Set("version", agentVer)
	u.RawQuery = q.Encode()
	urlWithParams := u.String()

	if useSignatureAuth {
		headers.Set("X-Runner-Public-Key", pubKeyHex)
	} else {
		// Validate token to prevent security issues
		if strings.Contains(token, ";") || strings.Contains(token, "&") || strings.Contains(token, "|") {
			log.Fatalf("Token contains suspicious characters")
		}
		headers.Set("Authorization", "Bearer "+token)
	}

	opts := &websocket.DialOptions{
		Subprotocols: []string{"swazz-agent"},
		HTTPHeader:   headers,
	}

	ctx := context.Background()

	// Auto-reconnect loop: `wrangler dev` can crash and restart mid-session
	// (miniflare "Network connection lost"), which drops this WebSocket. Instead
	// of terminating the agent, retry the connection with exponential backoff so
	// the runner survives coordinator restarts.
	backoff := 2 * time.Second
	const maxBackoff = 30 * time.Second
	for {
		runErr := runAgentConnection(ctx, urlWithParams, opts, coordinatorURL, token, name, useSignatureAuth, privKey, pubKeyHex, disableTelemetry)
		if runErr == nil {
			return
		}
		if errors.Is(runErr, errAgentShutdown) {
			return
		}
		if errors.Is(runErr, errAgentAuthFatal) {
			os.Exit(1)
		}
		logError("Agent connection lost (%v). Reconnecting in %v...", runErr, backoff)
		time.Sleep(backoff)
		if backoff < maxBackoff {
			backoff *= 2
		}
	}
}
