// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package differential

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
)

const (
	maxFingerprintDepth = 32
	maxFingerprintNodes = 5000
)

// SchemaFingerprint represents the structural fingerprint of a JSON payload.
type SchemaFingerprint struct {
	RootType         string            `json:"root_type"`   // "object", "array", "primitive", "empty"
	FieldTypes       map[string]string `json:"field_types"` // normalized path -> JSON primitive type ("string", "number", "boolean", "null", "array", "object")
	FieldCount       int               `json:"field_count"`
	IsErrorStructure bool              `json:"is_error_structure"` // true if body matches common error payload patterns
}

// DiffResult captures the structural difference between a baseline schema and a probe schema.
type DiffResult struct {
	Similarity     float64  `json:"similarity"`
	AddedFields    []string `json:"added_fields,omitempty"`
	RemovedFields  []string `json:"removed_fields,omitempty"`
	TypeMismatches []string `json:"type_mismatches,omitempty"`
	IsSchemaLeak   bool     `json:"is_schema_leak"`
	IsProbableBOLA bool     `json:"is_probable_bola"`
	IsFake200Stub  bool     `json:"is_fake_200_stub"`
}

var sensitiveFieldPatterns = []string{
	"role", "roles", "is_admin", "admin", "isadmin", "superuser", "secret", "secret_key",
	"token", "access_token", "refresh_token", "auth_token", "api_key", "apikey",
	"private_key", "password", "password_hash", "hash", "ssn", "credit_card",
	"privilege", "privileges", "permission", "permissions", "internal_id", "internal_uuid",
	"master", "root", "shadow", "jwt",
}

// IsSensitiveField returns true if the given key or JSON path contains a sensitive identifier.
func IsSensitiveField(fieldName string) bool {
	// Extract the leaf field name from path if dot-separated
	parts := strings.Split(fieldName, ".")
	leaf := parts[len(parts)-1]
	leaf = strings.TrimSuffix(leaf, "[]")
	normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(leaf, "-", "_"), " ", ""))

	for _, pattern := range sensitiveFieldPatterns {
		if normalized == pattern || strings.HasPrefix(normalized, pattern+"_") || strings.HasSuffix(normalized, "_"+pattern) {
			return true
		}
	}
	return false
}

// ExtractFingerprint parses a raw JSON payload and produces a canonical SchemaFingerprint.
func ExtractFingerprint(body []byte) (SchemaFingerprint, error) {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return SchemaFingerprint{
			RootType:   "empty",
			FieldTypes: make(map[string]string),
			FieldCount: 0,
		}, nil
	}

	var parsed any
	if err := json.Unmarshal(trimmed, &parsed); err != nil {
		// Non-JSON payload (e.g. plain text, HTML error)
		return SchemaFingerprint{
			RootType:         "primitive",
			FieldTypes:       map[string]string{"$raw": "non-json"},
			FieldCount:       1,
			IsErrorStructure: isCommonErrorText(string(trimmed)),
		}, nil
	}

	fieldTypes := make(map[string]string)
	nodeCount := 0

	rootType := inferType(parsed)
	traverseSchema("", parsed, fieldTypes, 0, &nodeCount)

	isErr := checkErrorStructure(parsed, fieldTypes)

	return SchemaFingerprint{
		RootType:         rootType,
		FieldTypes:       fieldTypes,
		FieldCount:       len(fieldTypes),
		IsErrorStructure: isErr,
	}, nil
}

func traverseSchema(prefix string, val any, out map[string]string, depth int, nodeCount *int) {
	if depth >= maxFingerprintDepth || *nodeCount >= maxFingerprintNodes {
		return
	}
	*nodeCount++

	switch v := val.(type) {
	case map[string]any:
		if prefix != "" {
			out[prefix] = "object"
		}
		for k, child := range v {
			childPath := k
			if prefix != "" {
				childPath = prefix + "." + k
			}
			traverseSchema(childPath, child, out, depth+1, nodeCount)
		}
	case []any:
		if prefix != "" {
			out[prefix] = "array"
		}
		arrayPath := prefix + "[]"
		if prefix == "" {
			arrayPath = "[]"
		}
		if len(v) > 0 {
			// Sample first item for array elements schema
			traverseSchema(arrayPath, v[0], out, depth+1, nodeCount)
		} else {
			out[arrayPath] = "empty_array"
		}
	case string:
		if prefix != "" {
			out[prefix] = "string"
		}
	case json.Number, float64, int, int64:
		if prefix != "" {
			out[prefix] = "number"
		}
	case bool:
		if prefix != "" {
			out[prefix] = "boolean"
		}
	case nil:
		if prefix != "" {
			out[prefix] = "null"
		}
	default:
		if prefix != "" {
			out[prefix] = "unknown"
		}
	}
}

func inferType(v any) string {
	switch v.(type) {
	case map[string]any:
		return "object"
	case []any:
		return "array"
	case string, json.Number, float64, int, int64, bool:
		return "primitive"
	case nil:
		return "null"
	default:
		return "unknown"
	}
}

func isCommonErrorText(text string) bool {
	lower := strings.ToLower(text)
	return strings.Contains(lower, "404 not found") ||
		strings.Contains(lower, "unauthorized") ||
		strings.Contains(lower, "access denied") ||
		strings.Contains(lower, "forbidden") ||
		strings.Contains(lower, "internal server error") ||
		strings.Contains(lower, "bad request")
}

func checkErrorStructure(parsed any, fieldTypes map[string]string) bool {
	// If the root object only contains typical error fields
	obj, ok := parsed.(map[string]any)
	if !ok {
		return false
	}

	errorKeys := 0
	for k, v := range obj {
		lk := strings.ToLower(k)
		if lk == "error" || lk == "message" || lk == "msg" || lk == "err" || lk == "detail" || lk == "code" || lk == "status" || lk == "statuscode" {
			errorKeys++
			// Check if message/error contains error-like text
			if strVal, isStr := v.(string); isStr {
				if isCommonErrorText(strVal) {
					return true
				}
			}
		}
	}

	// If almost all fields (or >= 60%) are error indicators in a small object (<= 4 fields)
	if len(obj) > 0 && len(obj) <= 4 && float64(errorKeys)/float64(len(obj)) >= 0.5 {
		return true
	}

	return false
}

// CompareFingerprints calculates the structural drift between a baseline response and a probe response.
func CompareFingerprints(baseline, probe SchemaFingerprint) DiffResult {
	if baseline.FieldCount == 0 && probe.FieldCount == 0 {
		return DiffResult{
			Similarity:     1.0,
			IsProbableBOLA: false,
		}
	}

	var addedFields []string
	var removedFields []string
	var typeMismatches []string

	matchedPaths := 0
	totalUniquePaths := make(map[string]struct{})

	for path, baseType := range baseline.FieldTypes {
		totalUniquePaths[path] = struct{}{}
		if probeType, exists := probe.FieldTypes[path]; exists {
			if baseType == probeType || baseType == "null" || probeType == "null" {
				matchedPaths++
			} else {
				typeMismatches = append(typeMismatches, fmt.Sprintf("%s (expected %s, got %s)", path, baseType, probeType))
			}
		} else {
			removedFields = append(removedFields, path)
		}
	}

	hasSensitiveAddedField := false
	for path := range probe.FieldTypes {
		totalUniquePaths[path] = struct{}{}
		if _, exists := baseline.FieldTypes[path]; !exists {
			addedFields = append(addedFields, path)
			if IsSensitiveField(path) {
				hasSensitiveAddedField = true
			}
		}
	}

	sort.Strings(addedFields)
	sort.Strings(removedFields)
	sort.Strings(typeMismatches)

	similarity := 0.0
	if len(totalUniquePaths) > 0 {
		similarity = float64(matchedPaths) / float64(len(totalUniquePaths))
	}
	similarity = math.Round(similarity*1000) / 1000

	isFake200 := false
	// Probe is a fake 200 if probe is an error structure but baseline was not, or if similarity is 0 and probe has error fields
	if probe.IsErrorStructure && !baseline.IsErrorStructure {
		isFake200 = true
	}

	isBOLA := false
	// Probable BOLA if high similarity (>= 0.80), root types match, and neither is an error structure
	if similarity >= 0.80 && baseline.RootType == probe.RootType && !probe.IsErrorStructure && !baseline.IsErrorStructure {
		isBOLA = true
	}

	return DiffResult{
		Similarity:     similarity,
		AddedFields:    addedFields,
		RemovedFields:  removedFields,
		TypeMismatches: typeMismatches,
		IsSchemaLeak:   hasSensitiveAddedField,
		IsProbableBOLA: isBOLA,
		IsFake200Stub:  isFake200,
	}
}
