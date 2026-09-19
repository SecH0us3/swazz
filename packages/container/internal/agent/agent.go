// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package agent

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
func StartAgent(args []string) {
	var coordinatorURL, token, tokenFile, name, keyPathOrHex, logLevelStr, logFilterStr string
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
		case "--token-file":
			if i+1 < len(args) {
				tokenFile = args[i+1]
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
			fmt.Println("Usage: swazz-engine run-agent [options]")
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
			logInfo("🔑 %s license active: %s (expires %s)", lic.TierLabel(), lic.Company, lic.ExpiresAt.Format("2006-01-02"))
			if lic.IsExpiringSoon(3) {
				logWarn("⚠️  License expires soon: %d day(s) remaining (expires %s)", lic.DaysRemaining(), lic.ExpiresAt.Format("2006-01-02"))
			}
		}
	}

	safenet.AssertRunningInContainer(dangerousNoContainer)

	coordinatorURL = resolveCoordinatorURL(coordinatorURL)
	var err error
	token, err = resolveAgentToken(token, tokenFile)
	if err != nil {
		log.Fatalf("Error resolving token: %v", err)
	}

	if coordinatorURL == "" {
		fmt.Println("Error: --coordinator (or SWAZZ_COORDINATOR) is required for run-agent.")
		fmt.Println()
		fmt.Println("Usage: swazz-engine run-agent [options]")
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
			fmt.Println("Error: --coordinator and either --token (or SWAZZ_TOKEN / --token-file) or a private key are required for run-agent.")
			fmt.Println()
			fmt.Println("Usage: swazz-engine run-agent [options]")
			os.Exit(1)
		}
	}

	if name == "" {
		if envName := os.Getenv("SWAZZ_RUNNER_NAME"); envName != "" {
			name = envName
		} else {
			hostname, _ := os.Hostname()
			name = "runner-" + hostname
		}
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
	agentVer := "dev"
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

// resolveAgentToken resolves the runner authentication token with the following priority:
// 1. Explicit CLI --token flag
// 2. Explicit CLI --token-file flag (read from disk)
// 3. Environment variable SWAZZ_TOKEN_FILE (read from disk)
// 4. Environment variable SWAZZ_TOKEN
// 5. Environment variable SWAZZ_RUNNER_TOKEN
func resolveAgentToken(tokenFlag, tokenFileFlag string) (string, error) {
	if tokenFlag != "" {
		return strings.TrimSpace(tokenFlag), nil
	}
	if tokenFileFlag != "" {
		data, err := os.ReadFile(tokenFileFlag)
		if err != nil {
			return "", fmt.Errorf("reading token file %s: %w", tokenFileFlag, err)
		}
		return strings.TrimSpace(string(data)), nil
	}
	if envFile := os.Getenv("SWAZZ_TOKEN_FILE"); envFile != "" {
		data, err := os.ReadFile(envFile)
		if err != nil {
			return "", fmt.Errorf("reading token file from SWAZZ_TOKEN_FILE (%s): %w", envFile, err)
		}
		return strings.TrimSpace(string(data)), nil
	}
	if envToken := os.Getenv("SWAZZ_TOKEN"); envToken != "" {
		return strings.TrimSpace(envToken), nil
	}
	if envToken := os.Getenv("SWAZZ_RUNNER_TOKEN"); envToken != "" {
		return strings.TrimSpace(envToken), nil
	}
	return "", nil
}

// resolveCoordinatorURL resolves the coordinator URL from CLI flag or environment variables:
// 1. Explicit CLI --coordinator flag
// 2. Environment variable SWAZZ_COORDINATOR
// 3. Environment variable SWAZZ_COORDINATOR_URL
func resolveCoordinatorURL(coordinatorFlag string) string {
	if coordinatorFlag != "" {
		return strings.TrimSpace(coordinatorFlag)
	}
	if envCoord := os.Getenv("SWAZZ_COORDINATOR"); envCoord != "" {
		return strings.TrimSpace(envCoord)
	}
	if envCoord := os.Getenv("SWAZZ_COORDINATOR_URL"); envCoord != "" {
		return strings.TrimSpace(envCoord)
	}
	return ""
}

