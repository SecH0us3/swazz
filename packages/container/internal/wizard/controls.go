// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package wizard

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	swzconfig "swazz-engine/internal/config"

	"github.com/manifoldco/promptui"
	"golang.org/x/term"
)

func configureSecurityPolicy(config *swzconfig.CliConfig) {
	fmt.Println("\n\033[1;36m--- Security Policy ---\033[0m")
	currentStatus := "BLOCKED"
	if config.Security.AllowPrivateIPs {
		currentStatus = "ALLOWED"
	}
	fmt.Printf("SSRF Protection (Allow Private IPs / Localhost): %s\n", currentStatus)

	prompt := promptui.Select{
		Label: "SSRF Policy",
		Items: []string{
			"🔒 Block Private IPs (Recommended for public/shared deployments)",
			"🔓 Allow Private IPs & Localhost (Recommended for scanning local dev APIs)",
			"🔙 Back",
		},
	}
	index, _, err := prompt.Run()
	if err != nil || index == 2 {
		return
	}
	config.Security.AllowPrivateIPs = (index == 1)
	fmt.Println("Security policy updated.")
}

func configureFuzzingControls(config *swzconfig.CliConfig) {
	for {
		fmt.Println("\n\033[1;36m--- Fuzzing Controls ---\033[0m")
		fmt.Printf("  Concurrency:            %d\n", config.Settings.Concurrency)
		fmt.Printf("  Iterations per Profile: %d\n", config.Settings.IterationsPerProfile)
		fmt.Printf("  Timeout (ms):           %d\n", config.Settings.TimeoutMs)
		fmt.Printf("  BOLA testing:           %t\n", config.Settings.BOLATesting)
		fmt.Printf("  Rate limit check:       %t (Burst: %d)\n", config.Settings.RateLimitCheck, config.Settings.RateLimitBurstSize)

		prompt := promptui.Select{
			Label: "Select Fuzzing Control to modify",
			Items: []string{
				"🚀 Concurrency",
				"🔄 Iterations per Profile",
				"⏱️ Timeout",
				"👥 BOLA / IDOR Testing toggle",
				"🚦 Rate Limiting / Burst Size",
				"🔙 Back",
			},
		}

		index, _, err := prompt.Run()
		if err != nil || index == 5 {
			return
		}

		switch index {
		case 0:
			// Attempt to make terminal raw for interactive arrow adjustments
			oldState, err := term.MakeRaw(int(os.Stdin.Fd()))
			if err != nil {
				// Fallback to standard promptui if raw mode is not supported (non-interactive or not a TTY)
				promptC := promptui.Prompt{
					Label:    "Concurrency (number of parallel worker routines)",
					Default:  strconv.Itoa(config.Settings.Concurrency),
					Validate: ValidatePositiveInt,
				}
				val, err := promptC.Run()
				if err == nil {
					iVal, _ := strconv.Atoi(val)
					config.Settings.Concurrency = iVal
				}
				continue
			}

			restoreTerm := func() {
				_ = term.Restore(int(os.Stdin.Fd()), oldState)
			}
			defer restoreTerm()

			// Clean line drawing helper
			printPrompt := func(val int, showError bool) {
				if showError {
					fmt.Printf("\r\033[KConcurrency: %d (must be a positive integer) [Up/Down to adjust, type digits, Enter to save]", val)
				} else {
					fmt.Printf("\r\033[KConcurrency: %d [Up/Down to adjust, type digits, Enter to save]", val)
				}
			}

			currentVal := config.Settings.Concurrency
			printPrompt(currentVal, false)

			buf := make([]byte, 256)
			done := false
			showErr := false

			for !done {
				n, err := os.Stdin.Read(buf)
				if err != nil {
					break // Exit on EOF or read error
				}
				if n <= 0 {
					continue
				}

				// Handle control keys when read as a single byte
				if n == 1 {
					b := buf[0]
					if b == 3 || b == 4 { // Ctrl+C or Ctrl+D
						restoreTerm()
						fmt.Println()
						os.Exit(0)
					}
					if b == 13 || b == 10 { // Enter key
						if currentVal > 0 {
							config.Settings.Concurrency = currentVal
							done = true
						} else {
							showErr = true
							printPrompt(currentVal, showErr)
						}
						continue
					}
					if b == 127 || b == 8 { // Backspace (DEL or BS)
						s := strconv.Itoa(currentVal)
						if len(s) > 1 {
							s = s[:len(s)-1]
							currentVal, _ = strconv.Atoi(s)
						} else {
							currentVal = 0
						}
						printPrompt(currentVal, showErr)
						continue
					}
				}

				// Handle arrow key escape sequences
				if n >= 3 && buf[0] == 27 && buf[1] == 91 {
					if buf[2] == 65 { // Up arrow
						currentVal++
						printPrompt(currentVal, showErr)
						continue
					} else if buf[2] == 66 { // Down arrow
						if currentVal > 1 {
							currentVal--
						}
						printPrompt(currentVal, showErr)
						continue
					}
				}

				// Parse any digits typed or pasted
				var digits []byte
				for i := 0; i < n; i++ {
					if buf[i] >= '0' && buf[i] <= '9' {
						digits = append(digits, buf[i])
					}
				}
				if len(digits) > 0 {
					if currentVal == 0 {
						currentVal, _ = strconv.Atoi(string(digits))
					} else {
						newValStr := strconv.Itoa(currentVal) + string(digits)
						if parsed, err := strconv.Atoi(newValStr); err == nil {
							currentVal = parsed
						}
					}
					printPrompt(currentVal, showErr)
				}
			}
			restoreTerm()
			fmt.Println()
		case 1:
			promptI := promptui.Prompt{
				Label:    "Iterations per profile",
				Default:  strconv.Itoa(config.Settings.IterationsPerProfile),
				Validate: ValidatePositiveInt,
			}
			val, err := promptI.Run()
			if err == nil {
				iVal, _ := strconv.Atoi(val)
				config.Settings.IterationsPerProfile = iVal
			}
		case 2:
			promptT := promptui.Prompt{
				Label:    "Timeout (ms)",
				Default:  strconv.Itoa(config.Settings.TimeoutMs),
				Validate: ValidatePositiveInt,
			}
			val, err := promptT.Run()
			if err == nil {
				iVal, _ := strconv.Atoi(val)
				config.Settings.TimeoutMs = iVal
			}
		case 3:
			promptB := promptui.Select{
				Label: "Enable BOLA / IDOR testing?",
				Items: []string{"Disabled", "Enabled"},
			}
			bIdx, _, err := promptB.Run()
			if err == nil {
				config.Settings.BOLATesting = (bIdx == 1)
			}
		case 4:
			promptR := promptui.Select{
				Label: "Enable Rate Limit Absence check?",
				Items: []string{"Disabled", "Enabled"},
			}
			rIdx, _, err := promptR.Run()
			if err == nil {
				config.Settings.RateLimitCheck = (rIdx == 1)
				if config.Settings.RateLimitCheck {
					promptBurst := promptui.Prompt{
						Label:    "Burst size (requests sent in rapid succession)",
						Default:  strconv.Itoa(config.Settings.RateLimitBurstSize),
						Validate: ValidatePositiveInt,
					}
					bVal, err := promptBurst.Run()
					if err == nil {
						ibVal, _ := strconv.Atoi(bVal)
						config.Settings.RateLimitBurstSize = ibVal
					}
				}
			}
		}
	}
}

func configureFilePathsAndFilters(config *swzconfig.CliConfig) {
	for {
		fmt.Println("\n\033[1;36m--- File Paths & Endpoint Filters ---\033[0m")
		includeStr := "all"
		excludeStr := "none"
		if config.Endpoints != nil {
			if len(config.Endpoints.Include) > 0 {
				includeStr = strings.Join(config.Endpoints.Include, ", ")
			}
			if len(config.Endpoints.Exclude) > 0 {
				excludeStr = strings.Join(config.Endpoints.Exclude, ", ")
			}
		}

		fmt.Printf("  Endpoint Include filters: %s\n", includeStr)
		fmt.Printf("  Endpoint Exclude filters: %s\n", excludeStr)
		fmt.Printf("  Custom wordlist files:    %d configured\n", len(config.WordlistFiles))

		prompt := promptui.Select{
			Label: "Select Filter Option",
			Items: []string{
				"📥 Set Endpoint Include Filters",
				"📤 Set Endpoint Exclude Filters",
				"📁 Configure custom wordlist file paths",
				"🔙 Back",
			},
		}

		index, _, err := prompt.Run()
		if err != nil || index == 3 {
			return
		}

		if config.Endpoints == nil {
			config.Endpoints = &struct {
				Include []string `json:"include"`
				Exclude []string `json:"exclude"`
			}{
				Include: []string{},
				Exclude: []string{},
			}
		}

		switch index {
		case 0:
			promptI := promptui.Prompt{
				Label:   "Include patterns (comma-separated, e.g. GET /api/users/**)",
				Default: strings.Join(config.Endpoints.Include, ", "),
			}
			val, err := promptI.Run()
			if err == nil {
				var list []string
				for _, s := range strings.Split(val, ",") {
					trimmed := strings.TrimSpace(s)
					if trimmed != "" {
						list = append(list, trimmed)
					}
				}
				config.Endpoints.Include = list
			}
		case 1:
			promptE := promptui.Prompt{
				Label:   "Exclude patterns (comma-separated, e.g. /auth/**)",
				Default: strings.Join(config.Endpoints.Exclude, ", "),
			}
			val, err := promptE.Run()
			if err == nil {
				var list []string
				for _, s := range strings.Split(val, ",") {
					trimmed := strings.TrimSpace(s)
					if trimmed != "" {
						list = append(list, trimmed)
					}
				}
				config.Endpoints.Exclude = list
			}
		case 2:
			// Custom wordlists
			for {
				fmt.Println("\nConfigure custom wordlist files:")
				if len(config.WordlistFiles) == 0 {
					fmt.Println("  (none - using engine defaults)")
				} else {
					for k, v := range config.WordlistFiles {
						fmt.Printf("  %s: %s\n", k, v)
					}
				}

				promptW := promptui.Select{
					Label: "Wordlist settings",
					Items: []string{
						"➕ Add/Overwrite custom wordlist mapping",
						"🧹 Remove custom wordlist mapping",
						"🔙 Back",
					},
				}
				wIdx, _, err := promptW.Run()
				if err != nil || wIdx == 2 {
					break
				}
				if wIdx == 0 {
					promptK := promptui.Prompt{
						Label: "Category (e.g. xss, sqli, boundaries)",
						Validate: func(s string) error {
							if strings.TrimSpace(s) == "" {
								return errors.New("category cannot be empty")
							}
							return nil
						},
					}
					k, err := promptK.Run()
					if err != nil {
						continue
					}
					promptV := promptui.Prompt{
						Label: "Local file path",
						Validate: func(s string) error {
							if strings.TrimSpace(s) == "" {
								return errors.New("file path cannot be empty")
							}
							if _, err := os.Stat(s); os.IsNotExist(err) {
								return fmt.Errorf("file does not exist: %s", s)
							}
							return nil
						},
					}
					v, err := promptV.Run()
					if err != nil {
						continue
					}
					config.WordlistFiles[strings.TrimSpace(k)] = strings.TrimSpace(v)
				} else if wIdx == 1 {
					if len(config.WordlistFiles) == 0 {
						fmt.Println("No wordlist mappings to remove.")
						continue
					}
					var keys []string
					for k := range config.WordlistFiles {
						keys = append(keys, k)
					}
					keys = append(keys, "Cancel")
					selectRemove := promptui.Select{
						Label: "Select category to remove",
						Items: keys,
					}
					ridx, _, err := selectRemove.Run()
					if err == nil && ridx < len(keys)-1 {
						delete(config.WordlistFiles, keys[ridx])
					}
				}
			}
		}
	}
}
