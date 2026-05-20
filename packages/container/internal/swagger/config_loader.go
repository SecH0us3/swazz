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
	if config.WordlistFiles == nil {
		return nil
	}
	if config.Dictionaries == nil {
		config.Dictionaries = make(map[string][]any)
	}

	const maxCapacity = 1024 * 1024
	buf := make([]byte, maxCapacity)

	for category, filePath := range config.WordlistFiles {
		if !strings.HasSuffix(filePath, ".txt") {
			return fmt.Errorf("invalid wordlist file: %s (must be a .txt file)", filePath)
		}

		// Prevent path traversal by extracting only the filename and forcing the 'wordlists' directory.
		safePath := filepath.Join("wordlists", filepath.Base(filePath))
		file, err := os.Open(safePath)
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
