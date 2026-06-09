package har

import (
	"testing"
	"github.com/stretchr/testify/assert"
)

func TestInferSchemaFromJSON(t *testing.T) {
	tests := []struct {
		name     string
		rawJSON  string
		expected string // We will check Type
	}{
		{"String", `"hello"`, "string"},
		{"Integer", `123`, "integer"},
		{"Number", `12.3`, "number"},
		{"Boolean", `true`, "boolean"},
		{"Object", `{"name": "test"}`, "object"},
		{"Array", `[1, 2, 3]`, "array"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			prop := InferSchemaFromJSON(tt.rawJSON)
			assert.Equal(t, tt.expected, prop.Type)
		})
	}
}

func TestInferQueryValue(t *testing.T) {
	assert.Equal(t, "boolean", inferQueryValue("true").Type)
	assert.Equal(t, "integer", inferQueryValue("123").Type)
	assert.Equal(t, "integer", inferQueryValue("-123").Type)
	assert.Equal(t, "string", inferQueryValue("test").Type)
	assert.Equal(t, "string", inferQueryValue("123.45").Type)
}
