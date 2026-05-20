package swagger

import (
	"bufio"
	"fmt"
	"os"
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

	for category, filePath := range config.WordlistFiles {
		if !strings.HasSuffix(filePath, ".txt") {
			// Skip or enforce .txt, instruction says "reads each .txt file specified"
			// But maybe the path is just expected to be .txt
		}

		file, err := os.Open(filePath)
		if err != nil {
			return fmt.Errorf("failed to open wordlist for category %s: %w", category, err)
		}

		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line != "" {
				config.Dictionaries[category] = append(config.Dictionaries[category], line)
			}
		}

		if err := scanner.Err(); err != nil {
			file.Close()
			return fmt.Errorf("error reading wordlist for category %s: %w", category, err)
		}
		file.Close()
	}

	return nil
}
