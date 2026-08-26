// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package wizard

import (
	"fmt"
	"net/url"
	"strings"

	swzconfig "swazz-engine/internal/config"

	"github.com/manifoldco/promptui"
)

func configureBaseSettings(config *swzconfig.CliConfig) {
	fmt.Println("\n\033[1;36m--- Base Settings ---\033[0m")

	// 1. Swagger URLs
	currentSwagger := strings.Join(config.SwaggerURLs, ", ")
	promptSwagger := promptui.Prompt{
		Label:    "Swagger/OpenAPI or GraphQL URLs (comma-separated)",
		Default:  currentSwagger,
		Validate: ValidateSwaggerURLInput,
	}
	swaggerStr, err := promptSwagger.Run()
	if err != nil {
		if IsPromptCanceled(err) {
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
		if IsPromptCanceled(err) {
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
				Label:    "Header Name",
				Validate: ValidateHeaderName,
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
