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

		// Validate that filePath is a plain filename with no path components.
		// filepath.Base strips any directory prefix; if the result differs, the
		// input contained a path separator or traversal sequence.
		base := filepath.Base(filePath)
		if base != filePath || strings.ContainsAny(filePath, `/\`) || strings.Contains(filePath, "..") {
			return fmt.Errorf("invalid wordlist file: %q (must be a plain filename with no path components)", filePath)
		}
		if !strings.HasSuffix(strings.ToLower(filePath), ".txt") {
			return fmt.Errorf("invalid wordlist file: %q (must be a .txt file)", filePath)
		}

		// Build the safe path by joining only the validated base name under the
		// fixed 'wordlists/' directory, then re-clean and assert the prefix.
		safePath := filepath.Join("wordlists", base)
		if !strings.HasPrefix(filepath.Clean(safePath), "wordlists") {
			return fmt.Errorf("invalid wordlist file: %q resolved outside wordlists directory", filePath)
		}
		file, err := os.Open(safePath) //nolint:gosec // G304: path constructed from validated base + fixed prefix
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
