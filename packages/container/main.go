package main

import (
	"crypto/ed25519"
	"encoding/hex"
	"fmt"
	"os"
	"runtime"
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
	case "run-agent":
		runAgent(os.Args[2:])
	case "start":
		runCLI(os.Args[2:])
	case "wizard":
		runWizard()
	case "generate-keys":
		runGenerateKeys()
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
	fmt.Println("  swazz-engine run-agent [options]  Start headless runner connected to Cloudflare Coordinator")
	fmt.Println("  swazz-engine start [options]      Start a CLI fuzzing run using config (Local offline mode)")
	fmt.Println("  swazz-engine wizard               Interactive setup to generate swazz.config.json")
	fmt.Println("  swazz-engine generate-keys        Generate asymmetric keypair for runner signing authentication")
	fmt.Println()
	fmt.Println("Options for 'run-agent':")
	fmt.Println("  --coordinator <ws-url>       WebSocket URL of the Swazz Coordinator (e.g. wss://swazz.secmy.app/api/runners/connect)")
	fmt.Println("  --token <secret>             Runner authentication token (fallback if key is not used)")
	fmt.Println("  --key <file-or-hex>          Private key file path or hex string (default: ./swazz_runner.key)")
	fmt.Println("  --name <name>                (Optional) Name to identify this runner")
	fmt.Println("  --dangerous-no-container     Allow running directly on the host machine without Docker")
	fmt.Println("  --log-level <level>          Log level: debug, info, warn, error (default: info)")
	fmt.Println("  --log-filter <substring>     Only output log lines containing the substring (case-insensitive)")
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
	fmt.Println("  swazz-engine run-agent --coordinator wss://swazz.secmy.app/api/runners/connect --token xxx")
	fmt.Println("  swazz-engine run-agent --coordinator wss://swazz.secmy.app/api/runners/connect --key ./swazz_runner.key")
	fmt.Println("  swazz-engine generate-keys")
	fmt.Println("  swazz-engine start --config production.json --html report.html")
}

// ─── AGENT MODE ───────────────────────────────────────────

func runAgent(args []string) {
	// Implementation will go to agent package
	startAgent(args)
}

func runGenerateKeys() {
	pub, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		fmt.Printf("Error generating keys: %v\n", err)
		os.Exit(1)
	}

	privHex := hex.EncodeToString(priv)
	pubHex := hex.EncodeToString(pub)

	keyFile := "./swazz_runner.key"
	pubFile := "./swazz_runner.pub"

	err = os.WriteFile(keyFile, []byte(privHex+"\n"), 0600)
	if err != nil {
		fmt.Printf("Error writing private key file: %v\n", err)
		os.Exit(1)
	}

	err = os.WriteFile(pubFile, []byte(pubHex+"\n"), 0644)
	if err != nil {
		fmt.Printf("Error writing public key file: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("\033[1;32m✓ Keys generated successfully!\033[0m\n")
	fmt.Printf("  Private key saved to: %s (permissions: 0600)\n", keyFile)
	fmt.Printf("  Public key saved to:  %s (permissions: 0644)\n\n", pubFile)
	fmt.Printf("Your Public Key (hex):\n\033[1;36m%s\033[0m\n\n", pubHex)
	fmt.Printf("Please register this Public Key in the Web settings page before starting the agent.\n")
}

// ─── CLI MODE ─────────────────────────────────────────────

// ─── CLI Console Output ────────────────────────────────────

var numLinesPrinted int
