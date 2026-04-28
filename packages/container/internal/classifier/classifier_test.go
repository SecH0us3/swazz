package classifier

import (
	"strings"
	"testing"

	"swazz-engine/internal/swagger"
)

func TestClassifier_Defaults(t *testing.T) {
	cls := New(nil)

	tests := []struct {
		status   int
		expected Severity
	}{
		{404, SeverityIgnore}, // Ignored by default
		{401, SeverityIgnore}, // Ignored by default
		{200, SeverityIgnore}, // 2xx ignored by default
		{500, SeverityError},
		{502, SeverityError},
		{400, SeverityError}, // 4xx (except ignored ones) are errors
	}

	for _, tt := range tests {
		res := &swagger.FuzzResult{Status: tt.status}
		finding := cls.Classify(res)

		if tt.expected == SeverityIgnore {
			if finding != nil {
				t.Errorf("Expected status %d to be ignored, got finding with level %s", tt.status, finding.Level)
			}
		} else {
			if finding == nil {
				t.Errorf("Expected status %d to produce finding, got nil", tt.status)
			} else if finding.Level != tt.expected {
				t.Errorf("Expected status %d to have level %s, got %s", tt.status, tt.expected, finding.Level)
			}
		}
	}
}

func TestClassifier_Deduplication(t *testing.T) {
	cls := New(nil)

	results := make([]*swagger.FuzzResult, 0, 10)
	for i := 0; i < 10; i++ {
		results = append(results, &swagger.FuzzResult{
			Status:   500,
			Endpoint: "/api/test",
			Method:   "GET",
		})
	}

	findings := cls.ClassifyAll(results)

	// maxPerDefect is 5, so we should only get 5 findings
	if len(findings) != 5 {
		t.Errorf("Expected 5 findings due to deduplication, got %d", len(findings))
	}
}

func TestClassifier_Truncation(t *testing.T) {
	cls := New(nil)

	hugeBody := strings.Repeat("A", 60000)
	res := &swagger.FuzzResult{
		Status:       500,
		ResponseBody: hugeBody,
	}

	findings := cls.ClassifyAll([]*swagger.FuzzResult{res})
	
	if len(findings) != 1 {
		t.Fatalf("Expected 1 finding")
	}

	bodyStr, ok := findings[0].ResponseBody.(string)
	if !ok {
		t.Fatalf("Expected string body")
	}

	if len(bodyStr) > 50100 {
		t.Errorf("Response body was not truncated. Length: %d", len(bodyStr))
	}
	
	if !strings.Contains(bodyStr, "[TRUNCATED") {
		t.Errorf("Expected truncated body to contain truncation notice")
	}
}
