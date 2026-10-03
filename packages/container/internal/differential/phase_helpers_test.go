// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package differential

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestResponseBodyToBytes(t *testing.T) {
	t.Parallel()

	t.Run("nil body returns nil", func(t *testing.T) {
		assert.Nil(t, responseBodyToBytes(nil))
	})

	t.Run("string body returns its bytes", func(t *testing.T) {
		input := `{"message": "hello world"}`
		res := responseBodyToBytes(input)
		assert.Equal(t, []byte(input), res)
	})

	t.Run("byte slice body returns itself", func(t *testing.T) {
		input := []byte{0xDE, 0xAD, 0xBE, 0xEF}
		res := responseBodyToBytes(input)
		assert.Equal(t, input, res)
	})

	t.Run("map or struct body returns nil per implementation default", func(t *testing.T) {
		assert.Nil(t, responseBodyToBytes(map[string]any{"id": "doc_1"}))
		assert.Nil(t, responseBodyToBytes(struct{ Title string }{Title: "test"}))
		assert.Nil(t, responseBodyToBytes(12345))
	})
}

func TestCopyHeaders(t *testing.T) {
	t.Parallel()

	t.Run("nil input returns empty non-nil map", func(t *testing.T) {
		res := copyHeaders(nil)
		assert.NotNil(t, res)
		assert.Empty(t, res)
	})

	t.Run("empty map returns empty independent map", func(t *testing.T) {
		orig := map[string]string{}
		res := copyHeaders(orig)
		assert.NotNil(t, res)
		assert.Empty(t, res)
	})

	t.Run("independent copy preserves entries and isolates mutations", func(t *testing.T) {
		orig := map[string]string{
			"Authorization": "Bearer initial-token",
			"Content-Type":  "application/json",
		}
		cp := copyHeaders(orig)
		assert.Equal(t, orig, cp)

		// Mutate copy
		cp["Authorization"] = "Bearer modified-token"
		cp["X-Custom-Header"] = "added-value"

		// Original must remain unchanged
		assert.Equal(t, "Bearer initial-token", orig["Authorization"])
		_, exists := orig["X-Custom-Header"]
		assert.False(t, exists)
	})
}
