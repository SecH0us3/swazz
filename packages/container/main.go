package main

import (
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
	fmt.Println()
	fmt.Println("Options for 'run-agent':")
	fmt.Println("  --coordinator <ws-url>       WebSocket URL of the Swazz Coordinator (e.g. wss://swazz.secmy.app/api/runners/connect)")
	fmt.Println("  --token <secret>             Runner authentication token")
	fmt.Println("  --name <name>                (Optional) Name to identify this runner")
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
	fmt.Println("  swazz-engine start --config production.json --html report.html")
}

// ─── AGENT MODE ───────────────────────────────────────────

func runAgent(args []string) {
	// Implementation will go to agent package
	startAgent(args)
}

// ─── CLI MODE ─────────────────────────────────────────────

// ─── CLI Console Output ────────────────────────────────────

var numLinesPrinted int
