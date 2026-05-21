package swagger

import (
	"encoding/json"
)

// IsValidSpec checks if the given raw JSON is a valid OpenAPI/Swagger specification
// or a GraphQL Introspection result.
func IsValidSpec(raw json.RawMessage) bool {
	var check map[string]any
	if err := json.Unmarshal(raw, &check); err != nil {
		return false
	}

	if _, hasOpenAPI := check["openapi"]; hasOpenAPI {
		return true
	}
	if _, hasSwagger := check["swagger"]; hasSwagger {
		return true
	}
	if _, hasData := check["data"]; hasData {
		if dataMap, ok := check["data"].(map[string]any); ok {
			if _, hasSchema := dataMap["__schema"]; hasSchema {
				return true
			}
		}
	}
	if _, hasSchema := check["__schema"]; hasSchema {
		return true
	}

	return false
}
