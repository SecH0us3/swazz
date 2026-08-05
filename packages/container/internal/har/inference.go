// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package har

import (
	"strings"

	"swazz-engine/internal/swagger"
	"github.com/tidwall/gjson"
)

// InferSchemaFromJSON guesses data types from a raw JSON string
func InferSchemaFromJSON(rawJSON string) swagger.SchemaProperty {
	parsed := gjson.Parse(rawJSON)
	return inferValue(parsed)
}

func inferValue(result gjson.Result) swagger.SchemaProperty {
	switch result.Type {
	case gjson.String:
		return swagger.SchemaProperty{Type: "string"}
	case gjson.Number:
		if strings.Contains(result.Raw, ".") {
			return swagger.SchemaProperty{Type: "number"}
		}
		return swagger.SchemaProperty{Type: "integer"}
	case gjson.True, gjson.False:
		return swagger.SchemaProperty{Type: "boolean"}
	case gjson.JSON:
		if result.IsObject() {
			props := map[string]*swagger.SchemaProperty{}
			result.ForEach(func(key, value gjson.Result) bool {
				prop := inferValue(value)
				props[key.String()] = &prop
				return true
			})
			return swagger.SchemaProperty{Type: "object", Properties: props}
		}
		if result.IsArray() {
			arr := result.Array()
			if len(arr) > 0 {
				itemProp := inferValue(arr[0])
				return swagger.SchemaProperty{Type: "array", Items: &itemProp}
			}
			return swagger.SchemaProperty{Type: "array", Items: &swagger.SchemaProperty{Type: "string"}}
		}
	}
	return swagger.SchemaProperty{Type: "string"}
}
