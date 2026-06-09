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

// ─── CLI MODE ─────────────────────────────────────────────

// ─── CLI Console Output ────────────────────────────────────

var numLinesPrinted int
