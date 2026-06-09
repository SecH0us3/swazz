package main

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
)

func matchesAny(key, path string, patterns []string) bool {
	for _, p := range patterns {
		p = strings.ReplaceAll(p, "**", ".*")
		p = strings.ReplaceAll(p, "*", "[^/]*")
		if matched, _ := regexpMatch(p, key); matched {
			return true
		}
		if matched, _ := regexpMatch(p, path); matched {
			return true
		}
	}
	return false
}

// We implement simple regex matching for globs
func regexpMatch(pattern, s string) (bool, error) {
	importRegexp := `^` + pattern + `$`
	return regexp.MatchString(importRegexp, s)
}

func writeJSON(path string, data any) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600) // #nosec G302 G306
	if err != nil {
		return err
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	return enc.Encode(data)
}
