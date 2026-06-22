package classifier

import (
	"testing"

	"swazz-engine/internal/swagger"
)

func TestClassifier_Defaults(t *testing.T) {
	cls := New(nil)

	tests := []struct {
		status   int
		expected Severity
		name     string
	}{
		{404, SeverityIgnore, "404 Not Found"},
		{401, SeverityIgnore, "401 Unauthorized"},
		{200, SeverityIgnore, "200 OK (default ignore)"},
		{500, SeverityError, "500 Internal Server Error"},
		{502, SeverityError, "502 Bad Gateway"},
		{400, SeverityError, "400 Bad Request (non-ignored 4xx)"},
		{302, SeverityIgnore, "302 Found (default ignore)"}, // Added test for a common ignored code
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
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
		})
	}
}

func TestClassifier_Deduplication(t *testing.T) {
	cls := New(nil)

	results := make([]*swagger.FuzzResult, 0, 10)
	for i := 0; i < 10; i++ {
		// Use a unique ID to ensure the finding structure is distinct if needed, though deduplication should handle it by content.
		results = append(results, &swagger.FuzzResult{
			Status:   500,
			Endpoint: "/api/test",
			Method:   "GET",
			ID:       string(rune('A' + i))), // Ensure unique ID for robustness check
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

	// Case 1: Exactly the truncation limit (should pass without notice)
	exactBody := strings.Repeat("A", 50100)
	resExact := &swagger.FuzzResult{Status: 500, ResponseBody: exactBody}
	findingsExact := cls.ClassifyAll([]*swagger.FuzzResult{resExact})

	if len(findingsExact) != 1 {
		t.Fatalf("Expected 1 finding for exact body size")
	}
	bodyStrExact, ok := findingsExact[0].ResponseBody.(string)
	if !ok || len(bodyStrExact) != 50100 {
		t.Errorf("Expected string body of length 50100, got %v", bodyStrExact)
	}

	// Case 2: Over the truncation limit (should trigger notice and truncate)
	hugeBody := strings.Repeat("A", 60000)
	res := &swagger.FuzzResult{Status: 500, ResponseBody: hugeBody}
	findings := cls.ClassifyAll([]*swagger.FuzzResult{res})

	if len(findings) != 1 {
		t.Fatalf("Expected 1 finding")
	}

	bodyStr, ok := findings[0].ResponseBody.(string)
	if !ok {
		t.Fatalf("Expected string body")
	}

	// Check if the length is exactly the maximum allowed size + notice overhead (approx 50100)
	expectedMinLength := 50100 - 10 // Allowing for some buffer/notice text
	if len(bodyStr) < expectedMinLength {
		t.Errorf("Response body was too short after truncation. Length: %d", len(bodyStr))
	}

	if !strings.Contains(bodyStr, "[TRUNCATED") {
		t.Errorf("Expected truncated body to contain truncation notice")
	}
}

func TestClassifier_AnalyzerFindings(t *testing.T) {
	cls := New(nil)

	// Case 1: Standard finding (already tested, kept for structure)
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

	// Case 2: Multiple findings in one request (should result in multiple findings)
	resMulti := &swagger.FuzzResult{
		Status:   500, // Status code finding + Analyzer findings
		Endpoint: "/multi",
		Method:   "POST",
		AnalyzerFindings: []swagger.AnalysisFinding{
			{RuleID: "swazz/sql-error-leak", Level: "warning", Message: "SQL leak"},
			{RuleID: "swazz/crlf-injection", Level: "error", Message: "CRLF leak"},
		},
	}

	findingsMulti := cls.ClassifyAll([]*swagger.FuzzResult{resMulti})
	if len(findingsMulti) != 3 { // Status code finding + 2 analyzer findings
		t.Fatalf("Expected 3 total findings, got %d", len(findingsMulti))
	}

	// Check if both types of findings are present (order might vary)
	foundRuleIDs := make(map[string]bool)
	for _, f := range findingsMulti {
		if f.RuleID != "" {
			foundRuleIDs[f.RuleID] = true
		} else {
			// This is the status code finding, which has no RuleID but should be present
		}
	}

	if !foundRuleIDs["swazz/sql-error-leak"] || !foundRuleIDs["swazz/crlf-injection"] {
		t.Errorf("Did not find all expected rule IDs in findings.")
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

	// Test case 1: Standard status code error finding (kept)
	res := &swagger.FuzzResult{Status: 500}
	finding := cls.Classify(res)
	if finding == nil {
		t.Fatal("Expected finding for status 500")
	}
	expectedOWASP := []string{"A10:2025 Mishandling of Exceptional Conditions"}
	if !reflect.DeepEqual(finding.OWASPCategory, expectedOWASP) {
		t.Errorf("Expected OWASPCategory %v, got %v", expectedOWASP, finding.OWASPCategory)
	}

	// Test case 2: Response body analyzer finding (kept)
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

	// Test case 3: Multiple sources contributing to OWASP category (e.g., status code + analyzer finding)
	resCombined := &swagger.FuzzResult{
		Status:   500, // Status code error
		Endpoint: "/combined",
		Method:   "GET",
		AnalyzerFindings: []swagger.AnalysisFinding{
			{RuleID: "swazz/reflected-xss", Level: "error", Message: "XSS"},
		},
	}

	findingsCombined := cls.ClassifyAll([]*swagger.FuzzResult{resCombined})
	if len(findingsCombined) != 2 { // Status code finding + Analyzer finding
		t.Fatalf("Expected 2 findings, got %d", len(findingsCombined))
	}

	// We expect two distinct OWASP categories: one for status (A10) and one for XSS (A03).
	foundOWASPCategories := make(map[string]bool)
	for _, f := range findingsCombined {
		for _, cat := range f.OWASPCategory {
			foundOWASPCategories[cat] = true
		}
	}

	if !foundOWASPCategories["A10:2025 Mishandling of Exceptional Conditions"] || !foundOWASPCategories["A03:2021 Cross-Site Scripting"] {
		t.Errorf("Expected both A10 and A03 OWASP categories, found: %v", foundOWASPCategories)
	}
}

// TestClassifier_PartialRules_IgnoreOnly verifies that supplying only an Ignore
// list does not destroy the built-in defaultDefaults. (Kept)
func TestClassifier_PartialRules_IgnoreOnly(t *testing.T) {
	rules := &RulesConfig{
		Ignore: []int{400},
	}
	cls := New(rules)

	tests := []struct {
		status   int
		wantNil  bool // true = should be ignored (Classify returns nil)
		wantSev  Severity
		name     string
	}{
		// User-added ignore code
		{400, true, "", "User Ignore 400"},
		// 200 must still be ignored via defaultDefaults 2xx → ignore
		{200, true, "", "Default Ignore 200"},
		// 403/404/429 must still be in ignore set (seeded from defaultIgnore)
		{403, true, "", "Default Ignore 403"},
		{404, true, "", "Default Ignore 404"},
		{429, true, "", "Default Ignore 429"},
		// 500 must still be an error
		{500, false, SeverityError, "Status Error 500"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
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
		})
	}
}

// TestClassifier_NilRules_Regression ensures nil rules still behaves (Kept)
func TestClassifier_NilRules_Regression(t *testing.T) {
	cls := New(nil)

	tests := []struct {
		status  int
		wantNil bool
		wantSev Severity
		name    string
	}{
		{200, true, "", "200 OK"},
		{301, true, "", "301 Moved Permanently"},
		{401, true, "", "401 Unauthorized"},
		{403, true, "", "403 Forbidden"},
		{404, true, "", "404 Not Found"},
		{405, true, "", "405 Method Not Allowed"},
		{422, true, "", "422 Unprocessable Entity"},
		{429, true, "", "429 Too Many Requests"},
		{400, false, SeverityError, "Status Error 400"},
		{500, false, SeverityError, "Status Error 500"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
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
		})
	}
}

// TestClassifier_PartialRules_DefaultsOnly verifies that overriding only (Kept)
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
		name    string
	}{
		// 2xx now yields error
		{200, false, SeverityError, "Overridden 2xx"},
		// 4xx/5xx still error (preserved from defaultDefaults)
		{400, false, SeverityError, "Default 4xx"},
		{500, false, SeverityError, "Default 5xx"},
		// defaultIgnore codes still ignored
		{403, true, "", "Ignored 403"},
		{404, true, "", "Ignored 404"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
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
		})
	}
}

// TestClassifier_EmptyInput ensures that empty or nil inputs do not panic and return no findings.
func TestClassifier_EmptyInput(t *testing.T) {
	cls := New(nil)

	tests := []struct {
		name string
		res  *swagger.FuzzResult
	}{
		{"Nil Result", nil},
		{"Zero Status Code", &swagger.FuzzResult{Status: 0}},
		{"Empty Body", &swagger.FuzzResult{ResponseBody: ""}},
		{"No Endpoint/Method", &swagger.FuzzResult{Status: 200}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			finding := cls.Classify(tt.res)
			if finding != nil {
				t.Errorf("Expected no finding for %s, got level %s", tt.name, finding.Level)
			}
		})
	}
}
