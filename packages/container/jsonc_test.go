package main

import (
	"encoding/json"
	"testing"

	"swazz-engine/internal/swagger"

	"github.com/stretchr/testify/assert"
)

func TestStripJSONC(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		expectedVal map[string]any
		isValid     bool
	}{
		{
			name:  "plain json unchanged",
			input: `{"a": 1, "b": "hello"}`,
			expectedVal: map[string]any{
				"a": float64(1),
				"b": "hello",
			},
			isValid: true,
		},
		{
			name: "single line comment on its own line",
			input: `{
				// this is a comment
				"a": 1
			}`,
			expectedVal: map[string]any{
				"a": float64(1),
			},
			isValid: true,
		},
		{
			name: "inline line comment after value",
			input: `{
				"a": 1, // comment here
				"b": 2
			}`,
			expectedVal: map[string]any{
				"a": float64(1),
				"b": float64(2),
			},
			isValid: true,
		},
		{
			name: "multi-line block comment",
			input: `{
				/* 
				comment block
				spanning lines
				*/
				"a": 1
			}`,
			expectedVal: map[string]any{
				"a": float64(1),
			},
			isValid: true,
		},
		{
			name:  "comment inside a string must not be stripped",
			input: `{"url": "http://example.com/path", "text": "/* not a comment */", "slash": "// not comment"}`,
			expectedVal: map[string]any{
				"url":   "http://example.com/path",
				"text":  "/* not a comment */",
				"slash": "// not comment",
			},
			isValid: true,
		},
		{
			name:  "nested escaped quotes",
			input: `{"text": "hello \"world // comment? no\"!"}`,
			expectedVal: map[string]any{
				"text": `hello "world // comment? no"!`,
			},
			isValid: true,
		},
		{
			name:    "empty input",
			input:   ``,
			isValid: false,
		},
		{
			name:    "trailing single slash",
			input:   `{"a": 1}/`,
			isValid: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			stripped := swagger.StripJSONC([]byte(tt.input))

			// Verify that line numbers/byte offsets remain identical
			assert.Equal(t, len(tt.input), len(stripped), "Length of stripped content must match input to preserve byte offsets")

			if tt.isValid {
				var v map[string]any
				err := json.Unmarshal(stripped, &v)
				assert.NoError(t, err, "Stripped JSON must be valid parsing result")
				assert.Equal(t, tt.expectedVal, v)
			} else if tt.input != "" {
				// For invalid JSON but not empty, parsing should fail after stripping
				var v map[string]any
				err := json.Unmarshal(stripped, &v)
				assert.Error(t, err)
			}
		})
	}
}
