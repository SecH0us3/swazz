package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"

	"swazz-engine/internal/swagger"

	"github.com/manifoldco/promptui"
	"golang.org/x/term"
)

// isPromptCanceled returns true when the user pressed Ctrl+C or Ctrl+D,
// distinguishing a deliberate cancel from an unexpected I/O error.
func isPromptCanceled(err error) bool {
	return errors.Is(err, promptui.ErrInterrupt) || errors.Is(err, promptui.ErrEOF)
}

func runWizard() {
	fmt.Println("\033[1;34m⚡ Welcome to the Upgraded SWAZZ Configuration Wizard! ⚡\033[0m")
	fmt.Println("This wizard will help you configure advanced settings for the API fuzzer.")
	fmt.Println()

	var config CliConfig
	configPath := "swazz.config.json"

	// Continuation by Default
	if _, err := os.Stat(configPath); err == nil {
		fmt.Printf("Existing configuration found at %s.\n", configPath)
		prompt := promptui.Select{
			Label: "What would you like to do?",
			Items: []string{
				"📝 Edit existing configuration",
				"✨ Start a new configuration from scratch",
			},
		}
		index, _, err := prompt.Run()
		if err != nil {
			fmt.Println("Canceled.")
			return
		}

		if index == 0 {
			// Read existing
			data, err := os.ReadFile(configPath)
			if err != nil {
				fmt.Printf("\033[31mError reading existing config: %v. Starting fresh.\033[0m\n", err)
				config = CliConfig{Settings: swagger.DefaultSettings()}
			} else {
				if err := json.Unmarshal(data, &config); err != nil {
					fmt.Printf("\033[31mError parsing existing config: %v. Starting fresh.\033[0m\n", err)
					config = CliConfig{Settings: swagger.DefaultSettings()}
				} else {
					fmt.Println("\033[32mSuccessfully loaded existing configuration.\033[0m")
					defaultSettings := swagger.DefaultSettings()
					if config.Settings.Concurrency <= 0 {
						config.Settings.Concurrency = defaultSettings.Concurrency
					}
					if config.Settings.IterationsPerProfile <= 0 {
						config.Settings.IterationsPerProfile = defaultSettings.IterationsPerProfile
					}
					if config.Settings.TimeoutMs <= 0 {
						config.Settings.TimeoutMs = defaultSettings.TimeoutMs
					}
					if len(config.Settings.Profiles) == 0 {
						config.Settings.Profiles = defaultSettings.Profiles
					}
				}
			}
		} else {
			config = CliConfig{Settings: swagger.DefaultSettings()}
		}
	} else {
		config = CliConfig{Settings: swagger.DefaultSettings()}
	}

	// Initialize maps if nil
	if config.Headers == nil {
		config.Headers = make(map[string]string)
	}
	if config.Cookies == nil {
		config.Cookies = make(map[string]string)
	}
	if config.WordlistFiles == nil {
		config.WordlistFiles = make(map[string]string)
	}
	if config.Dictionaries == nil {
		config.Dictionaries = make(map[string][]any)
	}
	if config.AuthIdentities == nil {
		config.AuthIdentities = make(map[string]swagger.AuthIdentity)
	}

	for {
		prompt := promptui.Select{
			Label: "SWAZZ Configuration Main Menu",
			Items: []string{
				"📝 Base Settings (Swagger URLs, API Base URL)",
				"🔐 Authentication & Multi-Identity (Main Auth, BOLA / User B)",
				"🛡 Security Policy (SSRF / Allow Private IPs)",
				"⚙️ Fuzzing Controls (Concurrency, Profiles, Iterations, Rate Limiting)",
				"📁 File Paths & Filters (Custom wordlists, include/exclude endpoints)",
				"💾 Save & Run Fuzzer",
				"💾 Save & Exit",
				"❌ Cancel / Exit",
			},
		}

		index, _, err := prompt.Run()
		if err != nil {
			fmt.Println("Canceled.")
			return
		}

		switch index {
		case 0:
			configureBaseSettings(&config)
		case 1:
			configureAuthAndIdentity(&config)
		case 2:
			configureSecurityPolicy(&config)
		case 3:
			configureFuzzingControls(&config)
		case 4:
			configureFilePathsAndFilters(&config)
		case 5:
			if saveConfig(configPath, &config) {
				fmt.Println("\033[1;32mConfig saved! Starting fuzzing run...\033[0m")
				runCLI([]string{"--config", configPath})
				return
			}
		case 6:
			if saveConfig(configPath, &config) {
				fmt.Println("\033[1;32mConfig saved successfully!\033[0m")
				return
			}
		case 7:
			fmt.Println("Exiting wizard.")
			return
		}
	}
}

func configureBaseSettings(config *CliConfig) {
	fmt.Println("\n\033[1;36m--- Base Settings ---\033[0m")

	// 1. Swagger URLs
	currentSwagger := strings.Join(config.SwaggerURLs, ", ")
	valSwagger := func(input string) error {
		if strings.TrimSpace(input) == "" {
			return errors.New("Swagger URL cannot be empty")
		}
		for _, u := range strings.Split(input, ",") {
			trimmed := strings.TrimSpace(u)
			if trimmed == "" {
				continue
			}
			if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
				if _, err := url.ParseRequestURI(trimmed); err != nil {
					return fmt.Errorf("invalid URL format: %v", err)
				}
			} else {
				if _, err := os.Stat(trimmed); err != nil {
					return fmt.Errorf("local file does not exist or is inaccessible: %s", trimmed)
				}
			}
		}
		return nil
	}
	promptSwagger := promptui.Prompt{
		Label:    "Swagger/OpenAPI or GraphQL URLs (comma-separated)",
		Default:  currentSwagger,
		Validate: valSwagger,
	}
	swaggerStr, err := promptSwagger.Run()
	if err != nil {
		if isPromptCanceled(err) {
			fmt.Println("\nCanceled — returning to menu.")
		}
		return
	}

	var urls []string
	for _, u := range strings.Split(swaggerStr, ",") {
		trimmed := strings.TrimSpace(u)
		if trimmed != "" {
			urls = append(urls, trimmed)
		}
	}
	config.SwaggerURLs = urls

	// 2. Base API URL
	var defaultBase string
	if len(config.SwaggerURLs) > 0 {
		parsedURL, err := url.Parse(config.SwaggerURLs[0])
		if err == nil && parsedURL.Host != "" {
			defaultBase = parsedURL.Scheme + "://" + parsedURL.Host
		}
	}
	if config.BaseURL != "" {
		defaultBase = config.BaseURL
	}

	promptBase := promptui.Prompt{
		Label:   "Base API URL (e.g. https://api.com/v1)",
		Default: defaultBase,
	}
	baseStr, err := promptBase.Run()
	if err != nil {
		if isPromptCanceled(err) {
			fmt.Println("\nCanceled — returning to menu.")
		}
		return
	}
	config.BaseURL = strings.TrimSpace(baseStr)

	// 3. Static headers
	fmt.Println("\nConfigure static headers:")
	for {
		fmt.Println("Current static headers:")
		if len(config.Headers) == 0 {
			fmt.Println("  (none)")
		} else {
			for k, v := range config.Headers {
				fmt.Printf("  %s: %s\n", k, v)
			}
		}

		selectHeader := promptui.Select{
			Label: "Modify headers",
			Items: []string{
				"➕ Add/Overwrite header",
				"➖ Remove header",
				"🔙 Back",
			},
		}
		idx, _, err := selectHeader.Run()
		if err != nil || idx == 2 {
			break
		}

		if idx == 0 {
			promptK := promptui.Prompt{
				Label: "Header Name",
				Validate: func(s string) error {
					if strings.TrimSpace(s) == "" {
						return errors.New("Header name cannot be empty")
					}
					return nil
				},
			}
			k, err := promptK.Run()
			if err != nil {
				continue
			}
			promptV := promptui.Prompt{
				Label: "Header Value",
			}
			v, err := promptV.Run()
			if err != nil {
				continue
			}
			config.Headers[strings.TrimSpace(k)] = strings.TrimSpace(v)
		} else if idx == 1 {
			if len(config.Headers) == 0 {
				fmt.Println("No headers to remove.")
				continue
			}
			var headerKeys []string
			for k := range config.Headers {
				headerKeys = append(headerKeys, k)
			}
			headerKeys = append(headerKeys, "Cancel")
			selectRemove := promptui.Select{
				Label: "Select header to remove",
				Items: headerKeys,
			}
			ridx, _, err := selectRemove.Run()
			if err == nil && ridx < len(headerKeys)-1 {
				delete(config.Headers, headerKeys[ridx])
			}
		}
	}
}

func configureAuthAndIdentity(config *CliConfig) {
	for {
		fmt.Println("\n\033[1;36m--- Authentication & Multi-Identity ---\033[0m")
		prompt := promptui.Select{
			Label: "Select Authentication Option",
			Items: []string{
				"🔑 Configure Main Auth Sequence (steps)",
				"👥 Configure BOLA User B Identity",
				"🛡 Edit Session Drop Lists (Headers/Cookies to omit for AuthZ testing)",
				"🔙 Back to main menu",
			},
		}
		index, _, err := prompt.Run()
		if err != nil || index == 3 {
			return
		}

		switch index {
		case 0:
			config.AuthSequence = configureAuthSteps(config.AuthSequence)
		case 1:
			userB := config.AuthIdentities["user_b"]
			fmt.Println("\nConfigure User B Authentication parameters:")
			promptUserBMenu := promptui.Select{
				Label: "User B config options",
				Items: []string{
					"🔑 Configure User B Auth Sequence",
					"📋 Add static Header for User B",
					"📋 Add static Cookie for User B",
					"🔙 Back",
				},
			}
			ubIdx, _, err := promptUserBMenu.Run()
			if err != nil || ubIdx == 3 {
				continue
			}
			if userB.Headers == nil {
				userB.Headers = make(map[string]string)
			}
			if userB.Cookies == nil {
				userB.Cookies = make(map[string]string)
			}

			if ubIdx == 0 {
				userB.AuthSequence = configureAuthSteps(userB.AuthSequence)
			} else if ubIdx == 1 {
				promptK := promptui.Prompt{Label: "Header Name"}
				k, err := promptK.Run()
				if err == nil && k != "" {
					promptV := promptui.Prompt{Label: "Header Value"}
					v, err := promptV.Run()
					if err == nil {
						userB.Headers[k] = v
					}
				}
			} else if ubIdx == 2 {
				promptK := promptui.Prompt{Label: "Cookie Name"}
				k, err := promptK.Run()
				if err == nil && k != "" {
					promptV := promptui.Prompt{Label: "Cookie Value"}
					v, err := promptV.Run()
					if err == nil {
						userB.Cookies[k] = v
					}
				}
			}
			config.AuthIdentities["user_b"] = userB

		case 2:
			// Edit session drop lists
			fmt.Println("\nConfigure headers and cookies to drop/replace for BOLA anonymous check:")
			fmt.Printf("Current Auth Headers to drop: %v\n", config.Settings.AuthHeaders)
			fmt.Printf("Current Auth Cookies to drop: %v\n", config.Settings.AuthCookies)

			promptDrop := promptui.Select{
				Label: "Modify list",
				Items: []string{
					"🔑 Edit Auth Headers list",
					"🍪 Edit Auth Cookies list",
					"🔙 Back",
				},
			}
			dIdx, _, err := promptDrop.Run()
			if err != nil || dIdx == 2 {
				continue
			}
			if dIdx == 0 {
				promptH := promptui.Prompt{
					Label:   "Enter auth headers comma-separated",
					Default: strings.Join(config.Settings.AuthHeaders, ","),
				}
				val, err := promptH.Run()
				if err == nil {
					var list []string
					for _, s := range strings.Split(val, ",") {
						trimmed := strings.TrimSpace(s)
						if trimmed != "" {
							list = append(list, trimmed)
						}
					}
					config.Settings.AuthHeaders = list
				}
			} else if dIdx == 1 {
				promptC := promptui.Prompt{
					Label:   "Enter auth cookies comma-separated",
					Default: strings.Join(config.Settings.AuthCookies, ","),
				}
				val, err := promptC.Run()
				if err == nil {
					var list []string
					for _, s := range strings.Split(val, ",") {
						trimmed := strings.TrimSpace(s)
						if trimmed != "" {
							list = append(list, trimmed)
						}
					}
					config.Settings.AuthCookies = list
				}
			}
		}
	}
}

func configureAuthSteps(steps []swagger.AuthStep) []swagger.AuthStep {
	for {
		fmt.Println("\nCurrent Auth steps:")
		if len(steps) == 0 {
			fmt.Println("  (none)")
		} else {
			for i, step := range steps {
				bodySnippet := ""
				if step.Body != nil {
					bodySnippet = " with body"
				}
				fmt.Printf("  [%d] %s %s%s\n", i+1, step.Method, step.URL, bodySnippet)
			}
		}

		prompt := promptui.Select{
			Label: "Modify steps",
			Items: []string{
				"➕ Add auth step",
				"🧹 Clear all steps",
				"🔙 Back",
			},
		}
		idx, _, err := prompt.Run()
		if err != nil || idx == 2 {
			break
		}

		if idx == 0 {
			step := swagger.AuthStep{}
			promptURL := promptui.Prompt{
				Label: "Request URL (relative to BaseURL or absolute)",
				Validate: func(s string) error {
					if strings.TrimSpace(s) == "" {
						return errors.New("URL cannot be empty")
					}
					return nil
				},
			}
			u, err := promptURL.Run()
			if err != nil {
				continue
			}
			step.URL = strings.TrimSpace(u)

			promptMethod := promptui.Select{
				Label: "HTTP Method",
				Items: []string{"GET", "POST", "PUT", "DELETE"},
			}
			_, m, err := promptMethod.Run()
			if err != nil {
				continue
			}
			step.Method = m

			if m == "POST" || m == "PUT" {
				promptBody := promptui.Prompt{
					Label: "Request JSON Body (optional, press Enter to skip)",
					Validate: func(s string) error {
						trimmed := strings.TrimSpace(s)
						if trimmed == "" {
							return nil
						}
						var js any
						if err := json.Unmarshal([]byte(trimmed), &js); err != nil {
							return fmt.Errorf("Invalid JSON body: %v", err)
						}
						return nil
					},
				}
				b, err := promptBody.Run()
				if err == nil && strings.TrimSpace(b) != "" {
					var js any
					_ = json.Unmarshal([]byte(b), &js)
					step.Body = js
				}
			}

			// Extraction options
			promptExtract := promptui.Select{
				Label: "Do you need to extract values from the response?",
				Items: []string{"No", "Yes"},
			}
			eIdx, _, _ := promptExtract.Run()
			if eIdx == 1 {
				promptCookie := promptui.Prompt{
					Label: "Specific cookies to save (comma-separated, leave blank for all)",
				}
				cVal, _ := promptCookie.Run()
				if strings.TrimSpace(cVal) != "" {
					for _, s := range strings.Split(cVal, ",") {
						step.ExtractCookies = append(step.ExtractCookies, strings.TrimSpace(s))
					}
				}

				promptJSON := promptui.Prompt{
					Label: "Extract JSON field to header (e.g. data.token:Authorization, comma-separated, or enter to skip)",
				}
				jVal, _ := promptJSON.Run()
				if strings.TrimSpace(jVal) != "" {
					step.ExtractJSON = make(map[string]string)
					for _, part := range strings.Split(jVal, ",") {
						sp := strings.SplitN(part, ":", 2)
						if len(sp) == 2 {
							step.ExtractJSON[strings.TrimSpace(sp[0])] = strings.TrimSpace(sp[1])
						}
					}
				}

				promptVars := promptui.Prompt{
					Label: "Extract JSON field to variable (e.g. data.userId:user_id, comma-separated, or enter to skip)",
				}
				vVal, _ := promptVars.Run()
				if strings.TrimSpace(vVal) != "" {
					step.ExtractVariables = make(map[string]string)
					for _, part := range strings.Split(vVal, ",") {
						sp := strings.SplitN(part, ":", 2)
						if len(sp) == 2 {
							step.ExtractVariables[strings.TrimSpace(sp[0])] = strings.TrimSpace(sp[1])
						}
					}
				}
			}

			steps = append(steps, step)
		} else if idx == 1 {
			steps = nil
		}
	}
	return steps
}

func configureSecurityPolicy(config *CliConfig) {
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

func configureFuzzingControls(config *CliConfig) {
	validateInt := func(s string) error {
		val, err := strconv.Atoi(s)
		if err != nil || val <= 0 {
			return errors.New("must be a valid positive integer")
		}
		return nil
	}

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
					Validate: validateInt,
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
				Validate: validateInt,
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
				Validate: validateInt,
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
						Validate: validateInt,
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

func configureFilePathsAndFilters(config *CliConfig) {
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

func saveConfig(path string, config *CliConfig) bool {
	tmpPath := path + ".tmp"
	f, err := os.OpenFile(tmpPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600) // #nosec G304
	if err != nil {
		fmt.Printf("\033[31mFailed to open temp config file for writing: %v\033[0m\n", err)
		return false
	}

	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	if err := enc.Encode(config); err != nil {
		_ = f.Close()
		_ = os.Remove(tmpPath)
		fmt.Printf("\033[31mFailed to serialize configuration to JSON: %v\033[0m\n", err)
		return false
	}
	_ = f.Close()

	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath) // best-effort cleanup
		fmt.Printf("\033[31mFailed to replace config file: %v\033[0m\n", err)
		return false
	}
	return true
}
