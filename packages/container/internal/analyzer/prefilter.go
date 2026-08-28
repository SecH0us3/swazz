// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

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
