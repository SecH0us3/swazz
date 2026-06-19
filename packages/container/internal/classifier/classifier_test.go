package classifier

import (
	"reflect"
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

func TestClassifier_AnalyzerFindings(t *testing.T) {
	cls := New(nil)

	res := &swagger.FuzzResult{
		Status:   200, // Normally ignored by status-code classifier
		Endpoint: "/welcome",
		Method:   "GET",
		AnalyzerFindings: []swagger.AnalysisFinding{
			{
				RuleID:   "swazz/reflected-xss",
				Level:    "error",
				Message:  "Reflected XSS alert",
				Evidence: "Evidence context",
			},
		},
	}

	findings := cls.ClassifyAll([]*swagger.FuzzResult{res})

	if len(findings) != 1 {
		t.Fatalf("Expected 1 finding from analyzer findings, got %d", len(findings))
	}

	finding := findings[0]
	if finding.RuleID != "swazz/reflected-xss" {
		t.Errorf("Expected rule ID 'swazz/reflected-xss', got '%s'", finding.RuleID)
	}
	if finding.Level != SeverityError {
		t.Errorf("Expected level 'error', got '%s'", finding.Level)
	}
	if finding.Source != "response_body" {
		t.Errorf("Expected source 'response_body', got '%s'", finding.Source)
	}
	if finding.Error != "Evidence context" {
		t.Errorf("Expected error field to hold evidence, got '%s'", finding.Error)
	}
}

func TestClassifier_AnalyzerFindings_CRLFSource(t *testing.T) {
	cls := New(nil)

	tests := []struct {
		name           string
		ruleID         string
		expectedSource string
	}{
		{"CRLF injection uses response_headers source", "swazz/crlf-injection", "response_headers"},
		{"Header injection uses response_headers source", "swazz/header-injection", "response_headers"},
		{"XSS uses response_body source", "swazz/reflected-xss", "response_body"},
		{"SQLi uses response_body source", "swazz/sql-error-leak", "response_body"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := &swagger.FuzzResult{
				Status:   200,
				Endpoint: "/api/test",
				Method:   "POST",
				AnalyzerFindings: []swagger.AnalysisFinding{
					{
						RuleID:   tt.ruleID,
						Level:    "error",
						Message:  "Test finding",
						Evidence: "Test evidence",
					},
				},
			}

			findings := cls.ClassifyAll([]*swagger.FuzzResult{res})
			if len(findings) != 1 {
				t.Fatalf("Expected 1 finding, got %d", len(findings))
			}
			if findings[0].Source != tt.expectedSource {
				t.Errorf("Expected source %q for ruleID %q, got %q", tt.expectedSource, tt.ruleID, findings[0].Source)
			}
		})
	}
}

func TestClassifier_OWASPCategory(t *testing.T) {
	cls := New(nil)

	// Test case 1: Standard status code error finding
	res := &swagger.FuzzResult{Status: 500}
	finding := cls.Classify(res)
	if finding == nil {
		t.Fatal("Expected finding for status 500")
	}
	expectedOWASP := []string{"A10:2025 Mishandling of Exceptional Conditions"}
	if !reflect.DeepEqual(finding.OWASPCategory, expectedOWASP) {
		t.Errorf("Expected OWASPCategory %v, got %v", expectedOWASP, finding.OWASPCategory)
	}

	// Test case 2: Response body analyzer finding
	resAnalyzer := &swagger.FuzzResult{
		Status:   200,
		Endpoint: "/welcome",
		Method:   "GET",
		AnalyzerFindings: []swagger.AnalysisFinding{
			{
				RuleID:  "swazz/bola-idor",
				Level:   "error",
				Message: "BOLA detected",
			},
		},
	}
	findings := cls.ClassifyAll([]*swagger.FuzzResult{resAnalyzer})
	if len(findings) != 1 {
		t.Fatalf("Expected 1 finding, got %d", len(findings))
	}
	expectedAnalyzerOWASP := []string{"A01:2025 Broken Access Control"}
	if !reflect.DeepEqual(findings[0].OWASPCategory, expectedAnalyzerOWASP) {
		t.Errorf("Expected OWASPCategory %v, got %v", expectedAnalyzerOWASP, findings[0].OWASPCategory)
	}
}

// TestClassifier_PartialRules_IgnoreOnly verifies that supplying only an Ignore
// list does not destroy the built-in defaultDefaults.
// Real-world symptom: "rules": {"ignore": [400,415]} → mass false-positive
// status-200 and status-3xx findings.
func TestClassifier_PartialRules_IgnoreOnly(t *testing.T) {
	rules := &RulesConfig{
		Ignore: []int{400},
	}
	cls := New(rules)

	tests := []struct {
		status   int
		wantNil  bool // true = should be ignored (Classify returns nil)
		wantSev  Severity
	}{
		// User-added ignore code
		{400, true, ""},
		// 200 must still be ignored via defaultDefaults 2xx → ignore
		{200, true, ""},
		// 403/404/429 must still be in ignore set (seeded from defaultIgnore)
		{403, true, ""},
		{404, true, ""},
		{429, true, ""},
		// 500 must still be an error
		{500, false, SeverityError},
	}

	for _, tt := range tests {
		res := &swagger.FuzzResult{Status: tt.status}
		finding := cls.Classify(res)
		if tt.wantNil {
			if finding != nil {
				t.Errorf("status %d: expected ignore (nil finding), got level %s", tt.status, finding.Level)
			}
		} else {
			if finding == nil {
				t.Errorf("status %d: expected finding with level %s, got nil", tt.status, tt.wantSev)
			} else if finding.Level != tt.wantSev {
				t.Errorf("status %d: expected level %s, got %s", tt.status, tt.wantSev, finding.Level)
			}
		}
	}
}

// TestClassifier_NilRules_Regression ensures nil rules still behaves
// identically to the pre-fix baseline (no regression).
func TestClassifier_NilRules_Regression(t *testing.T) {
	cls := New(nil)

	tests := []struct {
		status  int
		wantNil bool
		wantSev Severity
	}{
		{200, true, ""},
		{301, true, ""},
		{401, true, ""},
		{403, true, ""},
		{404, true, ""},
		{405, true, ""},
		{422, true, ""},
		{429, true, ""},
		{400, false, SeverityError},
		{500, false, SeverityError},
	}

	for _, tt := range tests {
		res := &swagger.FuzzResult{Status: tt.status}
		finding := cls.Classify(res)
		if tt.wantNil {
			if finding != nil {
				t.Errorf("nil rules, status %d: expected ignore, got level %s", tt.status, finding.Level)
			}
		} else {
			if finding == nil {
				t.Errorf("nil rules, status %d: expected level %s, got nil", tt.status, tt.wantSev)
			} else if finding.Level != tt.wantSev {
				t.Errorf("nil rules, status %d: expected level %s, got %s", tt.status, tt.wantSev, finding.Level)
			}
		}
	}
}

// TestClassifier_PartialRules_DefaultsOnly verifies that overriding only
// "defaults" preserves the rest of defaultDefaults.
func TestClassifier_PartialRules_DefaultsOnly(t *testing.T) {
	rules := &RulesConfig{
		// Override 2xx to error; everything else should stay at built-in defaults.
		Defaults: map[string]Severity{"2xx": SeverityError},
	}
	cls := New(rules)

	tests := []struct {
		status  int
		wantNil bool
		wantSev Severity
	}{
		// 2xx now yields error
		{200, false, SeverityError},
		// 4xx/5xx still error (preserved from defaultDefaults)
		{400, false, SeverityError},
		{500, false, SeverityError},
		// defaultIgnore codes still ignored
		{403, true, ""},
		{404, true, ""},
	}

	for _, tt := range tests {
		res := &swagger.FuzzResult{Status: tt.status}
		finding := cls.Classify(res)
		if tt.wantNil {
			if finding != nil {
				t.Errorf("defaults-only rules, status %d: expected ignore, got level %s", tt.status, finding.Level)
			}
		} else {
			if finding == nil {
				t.Errorf("defaults-only rules, status %d: expected level %s, got nil", tt.status, tt.wantSev)
			} else if finding.Level != tt.wantSev {
				t.Errorf("defaults-only rules, status %d: expected level %s, got %s", tt.status, tt.wantSev, finding.Level)
			}
		}
	}
}
