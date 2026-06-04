package swagger

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"

	"gopkg.in/yaml.v3"
)

// IsYAML heuristic checks if the input is YAML but not JSON.
// It delegates to ConvertYAMLToJSON to prevent double parsing overhead.
func IsYAML(data []byte) bool {
	_, err := ConvertYAMLToJSON(data)
	return err == nil
}

// ConvertYAMLToJSON converts YAML bytes to JSON RawMessage.
// It includes a fast-path check for JSON and verifies that unmarshaled content is a map or slice.
func ConvertYAMLToJSON(data []byte) (json.RawMessage, error) {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return nil, fmt.Errorf("empty data")
	}
	// Fast-path: if it starts with '{' or '[', it is already JSON.
	if trimmed[0] == '{' || trimmed[0] == '[' {
		return nil, fmt.Errorf("already JSON")
	}

	var val any
	if err := yaml.Unmarshal(data, &val); err != nil {
		return nil, fmt.Errorf("failed to unmarshal YAML: %w", err)
	}

	if val == nil {
		return nil, fmt.Errorf("nil YAML content")
	}

	rv := reflect.ValueOf(val)
	if rv.Kind() != reflect.Map && rv.Kind() != reflect.Slice {
		return nil, fmt.Errorf("invalid YAML: content is not a map or slice")
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
	return cleanYAMLObjWithDepth(val, 0)
}

const maxDepth = 200

// cleanYAMLObjWithDepth recursively converts map keys with a maximum recursion depth check.
func cleanYAMLObjWithDepth(val any, depth int) any {
	if depth > maxDepth {
		return nil
	}
	switch v := val.(type) {
	case map[string]any:
		res := make(map[string]any, len(v))
		for k, val := range v {
			res[k] = cleanYAMLObjWithDepth(val, depth+1)
		}
		return res
	case map[any]any:
		res := make(map[string]any, len(v))
		for k, val := range v {
			res[fmt.Sprintf("%v", k)] = cleanYAMLObjWithDepth(val, depth+1)
		}
		return res
	case []any:
		res := make([]any, len(v))
		for i, val := range v {
			res[i] = cleanYAMLObjWithDepth(val, depth+1)
		}
		return res
	default:
		return v
	}
}
