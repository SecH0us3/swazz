// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package wizard

import (
	"encoding/json"
	"fmt"
	"os"

	swzconfig "swazz-engine/internal/config"
	"swazz-engine/internal/swagger"

	"github.com/manifoldco/promptui"
)

// RunWizard launches the interactive terminal configuration wizard.
func RunWizard(runCLIFunc func([]string)) {
	fmt.Println("\033[1;34m⚡ Welcome to the Upgraded SWAZZ Configuration Wizard! ⚡\033[0m")
	fmt.Println("This wizard will help you configure advanced settings for the API fuzzer.")
	fmt.Println()

	var config swzconfig.CliConfig
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
				config = swzconfig.CliConfig{Settings: swagger.DefaultSettings()}
			} else {
				data = swagger.StripJSONC(data)
				if err := json.Unmarshal(data, &config); err != nil {
					fmt.Printf("\033[31mError parsing existing config: %v. Starting fresh.\033[0m\n", err)
					config = swzconfig.CliConfig{Settings: swagger.DefaultSettings()}
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
			config = swzconfig.CliConfig{Settings: swagger.DefaultSettings()}
		}
	} else {
		config = swzconfig.CliConfig{Settings: swagger.DefaultSettings()}
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
			if SaveConfig(configPath, &config) {
				fmt.Println("\033[1;32mConfig saved! Starting fuzzing run...\033[0m")
				if runCLIFunc != nil {
					runCLIFunc([]string{"--config", configPath})
				}
				return
			}
		case 6:
			if SaveConfig(configPath, &config) {
				fmt.Println("\033[1;32mConfig saved successfully!\033[0m")
				return
			}
		case 7:
			fmt.Println("Exiting wizard.")
			return
		}
	}
}
