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

		// Resolve against a trusted absolute base directory and verify containment.
		safeBaseDir, err := filepath.Abs("wordlists")
		if err != nil {
			return fmt.Errorf("failed to resolve wordlists directory: %w", err)
		}
		safePath, err := filepath.Abs(filepath.Join(safeBaseDir, base))
		if err != nil {
			return fmt.Errorf("failed to resolve wordlist file path for category %s: %w", category, err)
		}
		rel, err := filepath.Rel(safeBaseDir, safePath)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
			return fmt.Errorf("invalid wordlist file: %q resolved outside wordlists directory", filePath)
		}
		file, err := os.Open(safePath) // #nosec G304
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
