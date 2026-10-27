// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"bytes"
	"regexp"
	"strings"
)

// containsFoldASCII checks if haystack contains needle (ASCII case-insensitive) without any heap allocations.
func containsFoldASCII(haystack []byte, needle string) bool {
	nLen := len(needle)
	hLen := len(haystack)
	if nLen == 0 {
		return true
	}
	if hLen < nLen {
		return false
	}

	firstLower := needle[0]
	firstUpper := firstLower
	if firstLower >= 'a' && firstLower <= 'z' {
		firstUpper = firstLower - 32
	} else if firstLower >= 'A' && firstLower <= 'Z' {
		firstLower = firstLower + 32
	}

	limit := hLen - nLen
	for i := 0; i <= limit; i++ {
		c := haystack[i]
		if c == firstLower || c == firstUpper {
			match := true
			for j := 1; j < nLen; j++ {
				hc := haystack[i+j]
				nc := needle[j]
				if hc != nc {
					if hc >= 'A' && hc <= 'Z' {
						hc += 32
					}
					if nc >= 'A' && nc <= 'Z' {
						nc += 32
					}
					if hc != nc {
						match = false
						break
					}
				}
			}
			if match {
				return true
			}
		}
	}
	return false
}

// containsAnyFoldASCII checks if haystack contains any of the provided needles (ASCII case-insensitive).
func containsAnyFoldASCII(haystack []byte, needles ...string) bool {
	for _, needle := range needles {
		if containsFoldASCII(haystack, needle) {
			return true
		}
	}
	return false
}

// containsLower reports whether the response body contains needle, ASCII case-insensitively,
// like containsFoldASCII over input.ResponseBody. It searches the body lowercased once per
// input, so a run of prefilters costs one fast strings.Index pass per needle.
func (in *AnalysisInput) containsLower(needle string) bool {
	return strings.Contains(in.lowerBody(), lowerNeedle(needle))
}

// containsAnyLower reports whether the response body contains any of needles (see containsLower).
func (in *AnalysisInput) containsAnyLower(needles ...string) bool {
	body := in.lowerBody()
	for _, needle := range needles {
		if strings.Contains(body, lowerNeedle(needle)) {
			return true
		}
	}
	return false
}

// lowerASCII returns b as a string with ASCII letters lowercased and every other byte unchanged.
func lowerASCII(b []byte) string {
	var sb strings.Builder
	sb.Grow(len(b))
	for _, c := range b {
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		sb.WriteByte(c)
	}
	return sb.String()
}

// lowerNeedle returns needle with ASCII letters lowercased. Needles are lowercase literals in
// practice, so this returns needle itself without allocating.
func lowerNeedle(needle string) string {
	for i := 0; i < len(needle); i++ {
		if c := needle[i]; c >= 'A' && c <= 'Z' {
			return lowerASCII([]byte(needle))
		}
	}
	return needle
}

// indexFoldASCII returns the index of the first instance of needle in haystack (ASCII case-insensitive), or -1 if needle is not present.
func indexFoldASCII(haystack []byte, needle string) int {
	nLen := len(needle)
	hLen := len(haystack)
	if nLen == 0 {
		return 0
	}
	if hLen < nLen {
		return -1
	}

	firstLower := needle[0]
	firstUpper := firstLower
	if firstLower >= 'a' && firstLower <= 'z' {
		firstUpper = firstLower - 32
	} else if firstLower >= 'A' && firstLower <= 'Z' {
		firstLower = firstLower + 32
	}

	limit := hLen - nLen
	for i := 0; i <= limit; i++ {
		c := haystack[i]
		if c == firstLower || c == firstUpper {
			match := true
			for j := 1; j < nLen; j++ {
				hc := haystack[i+j]
				nc := needle[j]
				if hc != nc {
					if hc >= 'A' && hc <= 'Z' {
						hc += 32
					}
					if nc >= 'A' && nc <= 'Z' {
						nc += 32
					}
					if hc != nc {
						match = false
						break
					}
				}
			}
			if match {
				return i
			}
		}
	}
	return -1
}

// anchoredRegexp compiles pattern to match only at the start of its input. Run at each position
// a match can start, it finds what FindIndex finds without the engine stepping through every
// byte: Go's regexp has no literal prefix to skip ahead to when a pattern opens with (?i) or \b.
func anchoredRegexp(pattern string) *regexp.Regexp {
	return regexp.MustCompile(`^(?:` + pattern + `)`)
}

// findFrom returns the leftmost match of the anchored regexp in body, like FindIndex of the
// pattern it was made from. Every match must begin with first, and canStart(i) must hold for each
// position i a match can begin at: it may let through positions where none does, never the other
// way round.
func findFrom(body []byte, anchored *regexp.Regexp, first byte, canStart func(i int) bool) []int {
	for i := 0; i < len(body); {
		j := bytes.IndexByte(body[i:], first)
		if j < 0 {
			return nil
		}
		i += j
		if canStart(i) {
			if loc := anchored.FindIndex(body[i:]); loc != nil {
				return []int{i + loc[0], i + loc[1]}
			}
		}
		i++
	}
	return nil
}

// isWordASCII reports whether c is a word character for \b: [0-9A-Za-z_].
func isWordASCII(c byte) bool {
	return c == '_' || c >= '0' && c <= '9' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z'
}
