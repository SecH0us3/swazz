// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package config

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"sync"
)

// globToRegex converts a glob pattern into a full-match regular expression.
// Rules:
//   - ** matches any sequence of characters including path separators (/)
//   - *  matches any sequence of characters within a single path segment (no /)
//   - All other characters are treated as regex literals (escaped via QuoteMeta)
//
// The returned pattern is always case-insensitive ((?i) prefix) so that
// exclude patterns like /api/admin also match /API/Admin (Task 61).
func globToRegex(p string) string {
	runes := []rune(p)
	var b strings.Builder
	b.WriteString("(?i)^") // (?i) → case-insensitive matching
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

var (
	globRegexMu    sync.RWMutex
	globRegexCache = make(map[string]*regexp.Regexp)
)

func getGlobRegex(p string) *regexp.Regexp {
	globRegexMu.RLock()
	re, ok := globRegexCache[p]
	globRegexMu.RUnlock()
	if ok {
		return re
	}

	globRegexMu.Lock()
	defer globRegexMu.Unlock()
	if re, ok = globRegexCache[p]; ok {
		return re
	}
	re = regexp.MustCompile(globToRegex(p))
	globRegexCache[p] = re
	return re
}

func matchesAny(key, path string, patterns []string) bool {
	for _, p := range patterns {
		// Fast path: if pattern has no wildcard, direct case-insensitive match
		if !strings.ContainsRune(p, '*') {
			if strings.EqualFold(p, key) || strings.EqualFold(p, path) {
				return true
			}
		}
		rx := getGlobRegex(p)
		if rx.MatchString(key) || rx.MatchString(path) {
			return true
		}
	}
	return false
}

func WriteJSON(path string, data any) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600) // #nosec G302 G304 G306
	if err != nil {
		return err
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	return enc.Encode(data)
}
