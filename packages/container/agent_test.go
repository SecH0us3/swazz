package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestInferOOBServerURL(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{
			input:    "wss://swazz.secmy.app/api/runners/connect",
			expected: "https://swazz.secmy.app",
		},
		{
			input:    "ws://localhost:8080/api/runners/connect",
			expected: "http://localhost:8080",
		},
		{
			input:    "wss://swazz.secmy.app/api/scans",
			expected: "https://swazz.secmy.app",
		},
		{
			input:    "https://swazz.secmy.app",
			expected: "https://swazz.secmy.app",
		},
		{
			input:    "",
			expected: "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			actual := inferOOBServerURL(tc.input)
			assert.Equal(t, tc.expected, actual)
		})
	}
}
