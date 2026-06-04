package swagger

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"

	"gopkg.in/yaml.v3"
)

// IsYAML heuristic checks if the input is YAML but not JSON.
func IsYAML(data []byte) bool {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return false
	}
	// If it starts like JSON, we prefer JSON parsing directly.
	if trimmed[0] == '{' || trimmed[0] == '[' {
		return false
	}

	var val any
	if err := yaml.Unmarshal(data, &val); err != nil {
		return false
	}

	// Must be a non-nil object or array/slice to be a valid OpenAPI spec structure.
	if val == nil {
		return false
	}

	rv := reflect.ValueOf(val)
	return rv.Kind() == reflect.Map || rv.Kind() == reflect.Slice
}

// ConvertYAMLToJSON converts YAML bytes to JSON RawMessage.
func ConvertYAMLToJSON(data []byte) (json.RawMessage, error) {
	var val any
	if err := yaml.Unmarshal(data, &val); err != nil {
		return nil, fmt.Errorf("failed to unmarshal YAML: %w", err)
	}

	cleaned := cleanYAMLObj(val)
	jsonBytes, err := json.Marshal(cleaned)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal to JSON: %w", err)
	}

	return json.RawMessage(jsonBytes), nil
}

// cleanYAMLObj recursively converts map keys to string.
func cleanYAMLObj(val any) any {
	switch v := val.(type) {
	case map[string]any:
		res := make(map[string]any, len(v))
		for k, val := range v {
			res[k] = cleanYAMLObj(val)
		}
		return res
	case map[any]any:
		res := make(map[string]any, len(v))
		for k, val := range v {
			res[fmt.Sprintf("%v", k)] = cleanYAMLObj(val)
		}
		return res
	case []any:
		res := make([]any, len(v))
		for i, val := range v {
			res[i] = cleanYAMLObj(val)
		}
		return res
	default:
		return v
	}
}
