package bola

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"unicode"
)

// CheckSimilarity calculates the similarity between two response bodies.
// Returns a value between 0.0 and 1.0.
func CheckSimilarity(bodyA, bodyB []byte) float64 {
	bodyA = bytes.TrimSpace(bodyA)
	bodyB = bytes.TrimSpace(bodyB)

	if len(bodyA) == 0 && len(bodyB) == 0 {
		return 1.0
	}
	if len(bodyA) == 0 || len(bodyB) == 0 {
		return 0.0
	}

	// Safeguard: refuse to calculate similarity for extremely large payloads
	// to prevent CPU exhaustion and integer overflow.
	if len(bodyA) > 50000 || len(bodyB) > 50000 {
		return 0.0
	}

	var valA, valB any
	isJSONA := json.Unmarshal(bodyA, &valA) == nil
	isJSONB := json.Unmarshal(bodyB, &valB) == nil

	if isJSONA && isJSONB {
		pathsA := getJSONPaths(valA)
		pathsB := getJSONPaths(valB)

		var structSim float64
		if len(pathsA) == 0 && len(pathsB) == 0 {
			if fmt.Sprintf("%T", valA) == fmt.Sprintf("%T", valB) {
				structSim = 1.0
			} else {
				structSim = 0.0
			}
		} else {
			structSim = jaccardSimilarity(pathsA, pathsB)
		}

		tokensA := tokenize(bodyA)
		tokensB := tokenize(bodyB)
		textSim := jaccardSimilarity(tokensA, tokensB)

		// 0.8 weight for structure, 0.2 weight for text token similarity.
		combined := 0.8*structSim + 0.2*textSim
		return combined
	}

	// Fallback for non-JSON or mixed
	tokensA := tokenize(bodyA)
	tokensB := tokenize(bodyB)
	textSim := jaccardSimilarity(tokensA, tokensB)

	levSim := normalizedLevenshtein(string(bodyA), string(bodyB))
	if levSim > textSim {
		return levSim
	}
	return textSim
}

func flattenJSON(val any, prefix string, paths map[string]struct{}) {
	switch v := val.(type) {
	case map[string]any:
		for k, child := range v {
			path := k
			if prefix != "" {
				path = prefix + "." + k
			}
			paths[path] = struct{}{}
			flattenJSON(child, path, paths)
		}
	case []any:
		for _, child := range v {
			flattenJSON(child, prefix, paths)
		}
	}
}

func getJSONPaths(v any) map[string]struct{} {
	paths := make(map[string]struct{})
	flattenJSON(v, "", paths)
	return paths
}

func tokenize(b []byte) map[string]struct{} {
	tokens := make(map[string]struct{})
	var current []rune
	for _, r := range string(b) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			current = append(current, unicode.ToLower(r))
		} else {
			if len(current) > 0 {
				tokens[string(current)] = struct{}{}
				current = nil
			}
		}
	}
	if len(current) > 0 {
		tokens[string(current)] = struct{}{}
	}
	return tokens
}

func jaccardSimilarity(setA, setB map[string]struct{}) float64 {
	if len(setA) == 0 && len(setB) == 0 {
		return 1.0
	}
	intersection := 0
	for k := range setA {
		if _, exists := setB[k]; exists {
			intersection++
		}
	}
	union := len(setA) + len(setB) - intersection
	return float64(intersection) / float64(union)
}

func levenshteinDistance(r1, r2 []rune) int {
	len1 := len(r1)
	len2 := len(r2)

	// Hard cap lengths to prevent potential integer overflow / memory exhaustion
	if len1 > 5000 {
		r1 = r1[:5000]
		len1 = 5000
	}
	if len2 > 5000 {
		r2 = r2[:5000]
		len2 = 5000
	}

	if len1 == 0 {
		return len2
	}
	if len2 == 0 {
		return len1
	}

	if len1 > math.MaxInt - 1 {
		return len2
	}
	columnLen := len1 + 1

	column := make([]int, columnLen)
	for y := 1; y <= len1; y++ {
		column[y] = y
	}

	for x := 1; x <= len2; x++ {
		column[0] = x
		lastkey := x - 1
		for y := 1; y <= len1; y++ {
			oldkey := column[y]
			incr := 0
			if r1[y-1] != r2[x-1] {
				incr = 1
			}
			column[y] = min(column[y]+1, min(column[y-1]+1, lastkey+incr))
			lastkey = oldkey
		}
	}
	return column[len1]
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func normalizedLevenshtein(s1, s2 string) float64 {
	r1 := []rune(s1)
	r2 := []rune(s2)
	maxLen := len(r1)
	if len(r2) > maxLen {
		maxLen = len(r2)
	}
	if maxLen == 0 {
		return 1.0
	}
	if maxLen > 2000 {
		if len(r1) > 2000 {
			r1 = r1[:2000]
		}
		if len(r2) > 2000 {
			r2 = r2[:2000]
		}
		maxLen = len(r1)
		if len(r2) > maxLen {
			maxLen = len(r2)
		}
	}
	dist := levenshteinDistance(r1, r2)
	return 1.0 - (float64(dist) / float64(maxLen))
}
