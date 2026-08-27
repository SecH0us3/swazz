// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package differential

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestExtractFingerprint(t *testing.T) {
	tests := []struct {
		name             string
		input            string
		expectedRoot     string
		expectedPaths    map[string]string
		isErrorStructure bool
	}{
		{
			name:             "empty payload",
			input:            "",
			expectedRoot:     "empty",
			expectedPaths:    map[string]string{},
			isErrorStructure: false,
		},
		{
			name:         "simple object",
			input:        `{"id": 123, "name": "Alice", "active": true}`,
			expectedRoot: "object",
			expectedPaths: map[string]string{
				"id":     "number",
				"name":   "string",
				"active": "boolean",
			},
			isErrorStructure: false,
		},
		{
			name:         "nested object with array",
			input:        `{"user": {"id": 1, "roles": ["admin", "editor"]}, "count": 2}`,
			expectedRoot: "object",
			expectedPaths: map[string]string{
				"user":         "object",
				"user.id":      "number",
				"user.roles":   "array",
				"user.roles[]": "string",
				"count":        "number",
			},
			isErrorStructure: false,
		},
		{
			name:             "fake 200 error structure",
			input:            `{"status": 200, "error": "404 Not Found"}`,
			expectedRoot:     "object",
			isErrorStructure: true,
		},
		{
			name:             "plain text error",
			input:            `404 Not Found - Access Denied`,
			expectedRoot:     "primitive",
			isErrorStructure: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			fp, err := ExtractFingerprint([]byte(tc.input))
			require.NoError(t, err)
			assert.Equal(t, tc.expectedRoot, fp.RootType)
			assert.Equal(t, tc.isErrorStructure, fp.IsErrorStructure)
			for path, expectedType := range tc.expectedPaths {
				assert.Equal(t, expectedType, fp.FieldTypes[path], "mismatch for path %s", path)
			}
		})
	}
}

func TestCompareFingerprints(t *testing.T) {
	t.Run("identical schemas", func(t *testing.T) {
		b1 := []byte(`{"id": 101, "title": "Secret Doc", "author": "Alice"}`)
		b2 := []byte(`{"id": 102, "title": "Another Doc", "author": "Bob"}`)

		fp1, err := ExtractFingerprint(b1)
		require.NoError(t, err)
		fp2, err := ExtractFingerprint(b2)
		require.NoError(t, err)

		diff := CompareFingerprints(fp1, fp2)
		assert.Equal(t, 1.0, diff.Similarity)
		assert.Empty(t, diff.AddedFields)
		assert.Empty(t, diff.RemovedFields)
		assert.Empty(t, diff.TypeMismatches)
		assert.False(t, diff.IsSchemaLeak)
		assert.True(t, diff.IsProbableBOLA)
		assert.False(t, diff.IsFake200Stub)
	})

	t.Run("schema leak with sensitive field addition", func(t *testing.T) {
		baseline := []byte(`{"id": 101, "username": "alice"}`)
		probe := []byte(`{"id": 101, "username": "alice", "is_admin": true, "api_key": "sec_123"}`)

		fpBase, _ := ExtractFingerprint(baseline)
		fpProbe, _ := ExtractFingerprint(probe)

		diff := CompareFingerprints(fpBase, fpProbe)
		assert.True(t, diff.IsSchemaLeak)
		assert.Contains(t, diff.AddedFields, "is_admin")
		assert.Contains(t, diff.AddedFields, "api_key")
	})

	t.Run("type drift detection", func(t *testing.T) {
		baseline := []byte(`{"id": 101, "status": "active"}`)
		probe := []byte(`{"id": 101, "status": 200}`)

		fpBase, _ := ExtractFingerprint(baseline)
		fpProbe, _ := ExtractFingerprint(probe)

		diff := CompareFingerprints(fpBase, fpProbe)
		assert.NotEmpty(t, diff.TypeMismatches)
		assert.False(t, diff.IsProbableBOLA)
	})

	t.Run("fake 200 detection", func(t *testing.T) {
		baseline := []byte(`{"id": 101, "card_number": "4111222233334444", "balance": 500}`)
		probe := []byte(`{"status": 200, "message": "Unauthorized"}`)

		fpBase, _ := ExtractFingerprint(baseline)
		fpProbe, _ := ExtractFingerprint(probe)

		diff := CompareFingerprints(fpBase, fpProbe)
		assert.True(t, diff.IsFake200Stub)
		assert.False(t, diff.IsProbableBOLA)
	})
}

func TestIsSensitiveField(t *testing.T) {
	sensitive := []string{"is_admin", "user.role", "admin", "secret_key", "data.credentials.token", "auth_token", "apiKey", "password_hash"}
	for _, s := range sensitive {
		assert.True(t, IsSensitiveField(s), "expected %s to be sensitive", s)
	}

	nonSensitive := []string{"id", "user.name", "created_at", "title", "description", "count", "page"}
	for _, ns := range nonSensitive {
		assert.False(t, IsSensitiveField(ns), "expected %s to NOT be sensitive", ns)
	}
}
