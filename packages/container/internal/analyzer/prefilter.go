// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"bytes"
	"regexp"
)

// containsAnyLower reports whether the response body contains any of needles, ASCII
// case-insensitively, like containsAnyFoldASCII over input.ResponseBody. It searches the body
// lowercased once per input, using a 2-byte bigram index filter for bodies >= 256 bytes.
func (in *AnalysisInput) containsAnyLower(needles ...string) bool {
	body := in.lowerBody()
	if len(body) >= 256 {
		bg := in.bodyBigrams()
		for _, needle := range needles {
			n := lowerNeedle(needle)
			if len(n) >= 2 {
				p1 := uint16(n[0])<<8 | uint16(n[1])
				if bg[p1>>6]&(uint64(1)<<(p1&63)) == 0 {
					continue
				}
				last := len(n) - 1
				p2 := uint16(n[last-1])<<8 | uint16(n[last])
				if bg[p2>>6]&(uint64(1)<<(p2&63)) == 0 {
					continue
				}
				mid := len(n) / 2
				p3 := uint16(n[mid-1])<<8 | uint16(n[mid])
				if bg[p3>>6]&(uint64(1)<<(p3&63)) == 0 {
					continue
				}
			}
			if bytes.Contains(body, []byte(n)) {
				return true
			}
		}
		return false
	}

	for _, needle := range needles {
		if bytes.Contains(body, []byte(lowerNeedle(needle))) {
			return true
		}
	}
	return false
}

// lowerASCIIInto writes b with ASCII letters lowercased into *dst (len(b) long) and returns dst.
func lowerASCIIInto(dst *[]byte, b []byte) *[]byte {
	out := *dst
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		out[i] = c
	}
	return dst
}

// lowerNeedle returns needle with ASCII letters lowercased. Needles are lowercase literals in
// practice, so this returns needle itself without allocating.
func lowerNeedle(needle string) string {
	for i := 0; i < len(needle); i++ {
		if c := needle[i]; c >= 'A' && c <= 'Z' {
			b := []byte(needle)
			return string(*lowerASCIIInto(&b, b))
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
