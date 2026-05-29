package generator

import (
	"testing"

	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/swagger"
)

func TestGenerateSecurityHeaders(t *testing.T) {
	// 1. Boundary profile should not produce security headers
	gBoundary := New(nil, swagger.ProfileBoundary, swagger.Settings{})
	if headers := gBoundary.GenerateSecurityHeaders(); headers != nil {
		t.Errorf("Expected nil security headers for BOUNDARY profile, got %v", headers)
	}

	// 2. Random profile should not produce security headers
	gRandom := New(nil, swagger.ProfileRandom, swagger.Settings{})
	if headers := gRandom.GenerateSecurityHeaders(); headers != nil {
		t.Errorf("Expected nil security headers for RANDOM profile, got %v", headers)
	}

	// 3. Malicious profile with all categories enabled should produce security headers
	gMalicious := New(nil, swagger.ProfileMalicious, swagger.Settings{})
	headers := gMalicious.GenerateSecurityHeaders()
	if headers == nil {
		t.Fatal("Expected security headers for MALICIOUS profile, got nil")
	}

	// Ensure key headers are present
	expectedHeaders := []string{"Host", "Origin", "X-Forwarded-For", "X-Real-IP", "X-Original-URL", "Authorization"}
	for _, h := range expectedHeaders {
		if _, ok := headers[h]; !ok {
			t.Errorf("Expected header %q to be generated, but it was missing", h)
		}
	}

	// 4. Test category filtering: enable only Host Injection
	settings := swagger.Settings{
		PayloadCategories: map[swagger.FuzzingProfile][]string{
			swagger.ProfileMalicious: {payloads.CatHostInjection},
		},
	}
	gFiltered := New(nil, swagger.ProfileMalicious, settings)
	filteredHeaders := gFiltered.GenerateSecurityHeaders()
	if filteredHeaders == nil {
		t.Fatal("Expected filtered headers, got nil")
	}

	if _, ok := filteredHeaders["Host"]; !ok {
		t.Error("Expected Host header to be present")
	}
	if len(filteredHeaders) != 1 {
		t.Errorf("Expected exactly 1 header when only CatHostInjection is enabled, got %d: %v", len(filteredHeaders), filteredHeaders)
	}

	// 5. Rotation verification
	var firstHost string
	if val, ok := filteredHeaders["Host"]; ok {
		firstHost = val
	}

	// Next generation should return the next value in the slice
	secondHeaders := gFiltered.GenerateSecurityHeaders()
	if secondHeaders == nil {
		t.Fatal("Expected second headers, got nil")
	}
	secondHost := secondHeaders["Host"]

	if firstHost == secondHost && len(payloads.HostInjection) > 1 {
		t.Errorf("Expected sequential header rotation, but first and second host values are both %q", firstHost)
	}
}

func TestMinIterationsNeeded_SecurityHeaders(t *testing.T) {
	// Test that adding security headers updates MinIterationsNeeded correctly
	settingsAll := swagger.Settings{}
	itersAll := MinIterationsNeeded(swagger.ProfileMalicious, settingsAll)

	// Filter down to only CatHostInjection which has 8 items
	settingsHost := swagger.Settings{
		PayloadCategories: map[swagger.FuzzingProfile][]string{
			swagger.ProfileMalicious: {payloads.CatHostInjection},
		},
	}
	itersHost := MinIterationsNeeded(swagger.ProfileMalicious, settingsHost)

	// CatHostInjection has 8 payloads, so itersHost should be at least 8
	if itersHost < 8 {
		t.Errorf("Expected MinIterationsNeeded to be at least 8 with HostInjection enabled, got %d", itersHost)
	}

	if itersAll <= itersHost {
		t.Errorf("Expected all-enabled iterations (%d) to be larger than only-host iterations (%d)", itersAll, itersHost)
	}
}
