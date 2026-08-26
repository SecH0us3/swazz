// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package wizard

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	swzconfig "swazz-engine/internal/config"
	"swazz-engine/internal/swagger"

	"github.com/manifoldco/promptui"
)

func configureAuthAndIdentity(config *swzconfig.CliConfig) {
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
					Label:    "Request JSON Body (optional, press Enter to skip)",
					Validate: ValidateJSONBody,
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
