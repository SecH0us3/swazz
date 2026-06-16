package main

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
)

// globToRegex converts a glob pattern into a full-match regular expression.
// Rules:
//   - ** matches any sequence of characters including path separators (/)
//   - *  matches any sequence of characters within a single path segment (no /)
//   - All other characters are treated as regex literals (escaped via QuoteMeta)
func globToRegex(p string) string {
	runes := []rune(p)
	var b strings.Builder
	b.WriteString("^")
	for i := 0; i < len(runes); i++ {
		switch {
		case runes[i] == '*' && i+1 < len(runes) && runes[i+1] == '*':
			b.WriteString(".*") // ** → cross-segment wildcard
			i++
		case runes[i] == '*':
			b.WriteString("[^/]*") // * → single-segment wildcard
		default:
			b.WriteString(regexp.QuoteMeta(string(runes[i])))
		}
	}
	b.WriteString("$")
	return b.String()
}

func matchesAny(key, path string, patterns []string) bool {
	for _, p := range patterns {
		regexPat := globToRegex(p)
		if matched, _ := regexp.MatchString(regexPat, key); matched {
			return true
		}
		if matched, _ := regexp.MatchString(regexPat, path); matched {
			return true
		}
	}
	return false
}

func writeJSON(path string, data any) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600) // #nosec G302 G304 G306
	if err != nil {
		return err
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	return enc.Encode(data)
}
