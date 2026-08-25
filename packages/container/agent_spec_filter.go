// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"strings"
	"swazz-engine/internal/swagger"
)

// filterSensitiveData filters sensitive information and credentials from raw spec contents.
func filterSensitiveData(rawSpec string) string {
	// Filter sensitive data from rawSpec
	// This is a basic example; you may need to extend it based on your requirements
	sensitivePatterns := []string{
		"password",
		"secret",
		"token",
		"api_key",
		"access_key",
		"jwt",
		"bearer",
		"aws",
		"private_key",
	}

	filteredSpec := rawSpec
	for _, pattern := range sensitivePatterns {
		filteredSpec = strings.ReplaceAll(filteredSpec, pattern, "[FILTERED]")
	}

	return filteredSpec
}

// pruneSchema recursively prunes deeply nested schema properties to prevent massive payloads over WebSocket.
func pruneSchema(s *swagger.SchemaProperty, currentDepth, maxDepth int) {
	if s == nil {
		return
	}
	if currentDepth >= maxDepth {
		s.Properties = nil
		s.Items = nil
		return
	}
	for _, prop := range s.Properties {
		pruneSchema(prop, currentDepth+1, maxDepth)
	}
	if s.Items != nil {
		pruneSchema(s.Items, currentDepth+1, maxDepth)
	}
}
