// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package wizard

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"

	swzconfig "swazz-engine/internal/config"

	"github.com/manifoldco/promptui"
)

// IsPromptCanceled returns true when the user pressed Ctrl+C or Ctrl+D,
// distinguishing a deliberate cancel from an unexpected I/O error.
func IsPromptCanceled(err error) bool {
	return errors.Is(err, promptui.ErrInterrupt) || errors.Is(err, promptui.ErrEOF)
}

func ValidatePositiveInt(s string) error {
	val, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || val <= 0 {
		return errors.New("must be a valid positive integer")
	}
	return nil
}

func ValidateJSONBody(s string) error {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return nil
	}
	var js any
	if err := json.Unmarshal([]byte(trimmed), &js); err != nil {
		return fmt.Errorf("invalid JSON body: %v", err)
	}
	return nil
}

func ValidateHeaderName(s string) error {
	if strings.TrimSpace(s) == "" {
		return errors.New("header name cannot be empty")
	}
	return nil
}

func ValidateSwaggerURLInput(input string) error {
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

func SaveConfig(path string, config *swzconfig.CliConfig) bool {
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
