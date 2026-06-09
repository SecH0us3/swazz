package swagger

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsYAML(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected bool
	}{
		{
			name:     "Valid JSON Map",
			input:    `{"openapi": "3.0.0"}`,
			expected: false,
		},
		{
			name:     "Valid JSON Array",
			input:    `[1, 2, 3]`,
			expected: false,
		},
		{
			name:     "Valid YAML Map",
			input:    "openapi: 3.0.0\ninfo:\n  title: Test API",
			expected: true,
		},
		{
			name:     "Valid YAML List",
			input:    "- item1\n- item2",
			expected: true,
		},
		{
			name:     "YAML with leading space/newline",
			input:    "\n\n   openapi: 3.0.0",
			expected: true,
		},
		{
			name:     "YAML Comments Only",
			input:    "# just a comment",
			expected: false,
		},
		{
			name:     "Scalar string",
			input:    `"just a string"`,
			expected: false,
		},
		{
			name:     "Scalar number",
			input:    `12345`,
			expected: false,
		},
		{
			name:     "Empty input",
			input:    `   `,
			expected: false,
		},
		{
			name:     "Invalid YAML syntax",
			input:    `foo: bar: baz`,
			expected: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := IsYAML([]byte(tc.input))
			assert.Equal(t, tc.expected, result)
		})
	}
}

func TestConvertYAMLToJSON(t *testing.T) {
	t.Run("Standard conversion", func(t *testing.T) {
		yamlInput := `
openapi: 3.0.0
info:
  title: Swagger Petstore
  version: 1.0.0
paths:
  /pets:
    get:
      summary: List all pets
`
		res, err := ConvertYAMLToJSON([]byte(yamlInput))
		assert.NoError(t, err)

		var m map[string]any
		err = json.Unmarshal(res, &m)
		assert.NoError(t, err)
		assert.Equal(t, "3.0.0", m["openapi"])

		info, ok := m["info"].(map[string]any)
		assert.True(t, ok)
		assert.Equal(t, "Swagger Petstore", info["title"])
	})

	t.Run("YAML with comments", func(t *testing.T) {
		yamlInput := `
# This is a comment
openapi: 3.0.0 # inline comment
info:
  title: Petstore
`
		res, err := ConvertYAMLToJSON([]byte(yamlInput))
		assert.NoError(t, err)

		var m map[string]any
		err = json.Unmarshal(res, &m)
		assert.NoError(t, err)
		assert.Equal(t, "3.0.0", m["openapi"])
	})

	t.Run("YAML with anchors and aliases", func(t *testing.T) {
		yamlInput := `
default_info: &default_info
  title: Default Petstore
  version: 1.0.0

info:
  <<: *default_info
  title: Custom Petstore
`
		res, err := ConvertYAMLToJSON([]byte(yamlInput))
		assert.NoError(t, err)

		var m map[string]any
		err = json.Unmarshal(res, &m)
		assert.NoError(t, err)

		info, ok := m["info"].(map[string]any)
		assert.True(t, ok)
		assert.Equal(t, "Custom Petstore", info["title"])
		assert.Equal(t, "1.0.0", info["version"])
	})
	t.Run("YAML with non-string keys", func(t *testing.T) {
		yamlInput := `
123: numeric key
true: boolean key
nested:
  456: another numeric key
`
		res, err := ConvertYAMLToJSON([]byte(yamlInput))
		assert.NoError(t, err)

		var m map[string]any
		err = json.Unmarshal(res, &m)
		assert.NoError(t, err)
		assert.Equal(t, "numeric key", m["123"])
		assert.Equal(t, "boolean key", m["true"])

		nested, ok := m["nested"].(map[string]any)
		assert.True(t, ok)
		assert.Equal(t, "another numeric key", nested["456"])
	})

	t.Run("YAML with null values", func(t *testing.T) {
		yamlInput := `
nullable_field: null
another_field: ~
`
		res, err := ConvertYAMLToJSON([]byte(yamlInput))
		assert.NoError(t, err)

		var m map[string]any
		err = json.Unmarshal(res, &m)
		assert.NoError(t, err)
		assert.Nil(t, m["nullable_field"])
		assert.Nil(t, m["another_field"])
	})

	t.Run("YAML with deeply nested lists and maps", func(t *testing.T) {
		yamlInput := `
level1:
  level2:
    - level3_item1: val1
      level3_item2:
        - val2
`
		res, err := ConvertYAMLToJSON([]byte(yamlInput))
		assert.NoError(t, err)

		var m map[string]any
		err = json.Unmarshal(res, &m)
		assert.NoError(t, err)

		l1 := m["level1"].(map[string]any)
		l2 := l1["level2"].([]any)
		l3 := l2[0].(map[string]any)
		assert.Equal(t, "val1", l3["level3_item1"])
		l3_item2 := l3["level3_item2"].([]any)
		assert.Equal(t, "val2", l3_item2[0])
	})

	t.Run("Invalid YAML input", func(t *testing.T) {
		yamlInput := `
foo: bar: baz
`
		_, err := ConvertYAMLToJSON([]byte(yamlInput))
		assert.Error(t, err)
	})

	t.Run("YAML with invalid tab indentation", func(t *testing.T) {
		yamlInput := "openapi: 3.0.0\n\tinfo:\n\t\ttitle: Test"
		_, err := ConvertYAMLToJSON([]byte(yamlInput))
		assert.Error(t, err)
	})
}
