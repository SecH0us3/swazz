package swagger

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// LoadWordlists reads each file specified in config.WordlistFiles
// and appends its lines to config.Dictionaries[category].
func LoadWordlists(config *Config) error {
	if len(config.WordlistFiles) == 0 {
		return nil
	}
	if config.Dictionaries == nil {
		config.Dictionaries = make(map[string][]any)
	}

	const maxCapacity = 1024 * 1024
	buf := make([]byte, maxCapacity)

	for category, filePath := range config.WordlistFiles {
		filePath = strings.TrimSpace(filePath)
		if filePath == "" {
			return fmt.Errorf("invalid wordlist file for category %s: empty file name", category)
		}
		if filePath != filepath.Base(filePath) ||
			strings.Contains(filePath, "/") ||
			strings.Contains(filePath, "\\") ||
			strings.Contains(filePath, "..") {
			return fmt.Errorf("invalid wordlist file: %s (must be a simple file name)", filePath)
		}
		if !strings.HasSuffix(strings.ToLower(filePath), ".txt") {
			return fmt.Errorf("invalid wordlist file: %s (must be a .txt file)", filePath)
		}

		// Only allow validated single-file names under the fixed 'wordlists' directory.
		safePath := filepath.Join("wordlists", filePath)
		file, err := os.Open(safePath) // #nosec G304 -- filename validated as a single component + fixed base dir
		if err != nil {
			return fmt.Errorf("failed to open wordlist for category %s: %w", category, err)
		}
		
		// Use anonymous function to safely defer file.Close() inside the loop
		err = func() error {
			defer file.Close()
			scanner := bufio.NewScanner(file)
			scanner.Buffer(buf, maxCapacity)

			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if line != "" {
					config.Dictionaries[category] = append(config.Dictionaries[category], line)
				}
			}

			if err := scanner.Err(); err != nil {
				return fmt.Errorf("error reading wordlist for category %s: %w", category, err)
			}
			return nil
		}()
		
		if err != nil {
			return err
		}
	}

	return nil
}
