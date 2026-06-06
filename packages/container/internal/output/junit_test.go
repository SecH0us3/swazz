package output

import (
	"encoding/xml"
	"strings"
	"testing"

	"swazz-engine/internal/classifier"
	"swazz-engine/internal/swagger"
)

// junitRoundTrip is a minimal set of structs for round-trip unmarshaling.
type junitRoundTripSuites struct {
	XMLName  xml.Name               `xml:"testsuites"`
	Name     string                 `xml:"name,attr"`
	Tests    int                    `xml:"tests,attr"`
	Failures int                    `xml:"failures,attr"`
	Errors   int                    `xml:"errors,attr"`
	Time     string                 `xml:"time,attr"`
	Suites   []junitRoundTripSuite  `xml:"testsuite"`
}

type junitRoundTripSuite struct {
	Name     string                `xml:"name,attr"`
	Tests    int                   `xml:"tests,attr"`
	Failures int                   `xml:"failures,attr"`
	Errors   int                   `xml:"errors,attr"`
	Time     string                `xml:"time,attr"`
	Cases    []junitRoundTripCase  `xml:"testcase"`
}

type junitRoundTripCase struct {
	Name      string                  `xml:"name,attr"`
	ClassName string                  `xml:"classname,attr"`
	Time      string                  `xml:"time,attr"`
	Failure   *junitRoundTripFailure  `xml:"failure,omitempty"`
	SystemOut string                  `xml:"system-out,omitempty"`
}

type junitRoundTripFailure struct {
	Message string `xml:"message,attr"`
	Type    string `xml:"type,attr"`
	Body    string `xml:",chardata"`
}

func TestJUnit(t *testing.T) {
	tests := []struct {
		name     string
		findings []*classifier.Finding
		stats    *swagger.RunStats
		verify   func(t *testing.T, data []byte)
	}{
		{
			name:     "empty findings produces valid XML with zero counts",
			findings: []*classifier.Finding{},
			stats:    nil,
			verify: func(t *testing.T, data []byte) {
				var root junitRoundTripSuites
				if err := xml.Unmarshal(data, &root); err != nil {
					t.Fatalf("Failed to unmarshal: %v", err)
				}
				if root.Name != "swazz" {
					t.Errorf("expected name 'swazz', got %q", root.Name)
				}
				if root.Tests != 0 {
					t.Errorf("expected 0 tests, got %d", root.Tests)
				}
				if root.Failures != 0 {
					t.Errorf("expected 0 failures, got %d", root.Failures)
				}
				if root.Errors != 0 {
					t.Errorf("expected 0 errors, got %d", root.Errors)
				}
				if len(root.Suites) != 0 {
					t.Errorf("expected 0 suites, got %d", len(root.Suites))
				}
			},
		},
		{
			name: "single error finding produces failure with type error",
			findings: []*classifier.Finding{
				{
					RuleID:   "swazz/reflected-xss",
					Level:    classifier.SeverityError,
					Method:   "POST",
					Endpoint: "/api/users",
					Duration: 123,
					Error:    "<script>alert(1)</script>",
					Payload:  "test-payload",
				},
			},
			stats: nil,
			verify: func(t *testing.T, data []byte) {
				var root junitRoundTripSuites
				if err := xml.Unmarshal(data, &root); err != nil {
					t.Fatalf("Failed to unmarshal: %v", err)
				}
				if root.Tests != 1 {
					t.Errorf("expected 1 test, got %d", root.Tests)
				}
				if root.Errors != 1 {
					t.Errorf("expected 1 error, got %d", root.Errors)
				}
				if len(root.Suites) != 1 {
					t.Fatalf("expected 1 suite, got %d", len(root.Suites))
				}
				suite := root.Suites[0]
				if suite.Name != "POST /api/users" {
					t.Errorf("expected suite name 'POST /api/users', got %q", suite.Name)
				}
				if len(suite.Cases) != 1 {
					t.Fatalf("expected 1 case, got %d", len(suite.Cases))
				}
				tc := suite.Cases[0]
				if tc.Name != "swazz/reflected-xss" {
					t.Errorf("expected testcase name 'swazz/reflected-xss', got %q", tc.Name)
				}
				if tc.ClassName != "POST /api/users" {
					t.Errorf("expected classname 'POST /api/users', got %q", tc.ClassName)
				}
				if tc.Time != "0.123" {
					t.Errorf("expected time '0.123', got %q", tc.Time)
				}
				if tc.Failure == nil {
					t.Fatal("expected failure element, got nil")
				}
				if tc.Failure.Type != "error" {
					t.Errorf("expected failure type 'error', got %q", tc.Failure.Type)
				}
				if !strings.Contains(tc.Failure.Body, "swazz/reflected-xss") {
					t.Errorf("failure body should contain rule ID")
				}
				if !strings.Contains(tc.Failure.Body, "<script>alert(1)</script>") {
					t.Errorf("failure body should contain evidence (unescaped after unmarshal)")
				}
			},
		},
		{
			name: "single warning finding produces failure with type warning",
			findings: []*classifier.Finding{
				{
					RuleID:   "swazz/cors-misconfig",
					Level:    classifier.SeverityWarning,
					Method:   "GET",
					Endpoint: "/api/config",
					Duration: 50,
				},
			},
			stats: nil,
			verify: func(t *testing.T, data []byte) {
				var root junitRoundTripSuites
				if err := xml.Unmarshal(data, &root); err != nil {
					t.Fatalf("Failed to unmarshal: %v", err)
				}
				if root.Failures != 1 {
					t.Errorf("expected 1 failure, got %d", root.Failures)
				}
				if root.Errors != 0 {
					t.Errorf("expected 0 errors, got %d", root.Errors)
				}
				tc := root.Suites[0].Cases[0]
				if tc.Failure == nil {
					t.Fatal("expected failure element")
				}
				if tc.Failure.Type != "warning" {
					t.Errorf("expected failure type 'warning', got %q", tc.Failure.Type)
				}
			},
		},
		{
			name: "single note finding uses system-out instead of failure",
			findings: []*classifier.Finding{
				{
					RuleID:   "swazz/status-200",
					Level:    classifier.SeverityNote,
					Method:   "GET",
					Endpoint: "/health",
					Duration: 10,
				},
			},
			stats: nil,
			verify: func(t *testing.T, data []byte) {
				var root junitRoundTripSuites
				if err := xml.Unmarshal(data, &root); err != nil {
					t.Fatalf("Failed to unmarshal: %v", err)
				}
				if root.Failures != 0 {
					t.Errorf("expected 0 failures, got %d", root.Failures)
				}
				if root.Errors != 0 {
					t.Errorf("expected 0 errors, got %d", root.Errors)
				}
				tc := root.Suites[0].Cases[0]
				if tc.Failure != nil {
					t.Error("expected no failure element for note")
				}
				if tc.SystemOut == "" {
					t.Error("expected system-out content for note")
				}
				if !strings.Contains(tc.SystemOut, "swazz/status-200") {
					t.Error("system-out should contain rule ID")
				}
			},
		},
		{
			name: "multiple findings across 2 endpoints produces 2 testsuites",
			findings: []*classifier.Finding{
				{
					RuleID:   "swazz/status-500",
					Level:    classifier.SeverityError,
					Method:   "POST",
					Endpoint: "/api/users",
					Duration: 100,
				},
				{
					RuleID:   "swazz/reflected-xss",
					Level:    classifier.SeverityError,
					Method:   "POST",
					Endpoint: "/api/users",
					Duration: 200,
				},
				{
					RuleID:   "swazz/cors-misconfig",
					Level:    classifier.SeverityWarning,
					Method:   "GET",
					Endpoint: "/api/config",
					Duration: 50,
				},
			},
			stats: nil,
			verify: func(t *testing.T, data []byte) {
				var root junitRoundTripSuites
				if err := xml.Unmarshal(data, &root); err != nil {
					t.Fatalf("Failed to unmarshal: %v", err)
				}
				if root.Tests != 3 {
					t.Errorf("expected 3 tests, got %d", root.Tests)
				}
				if len(root.Suites) != 2 {
					t.Fatalf("expected 2 suites, got %d", len(root.Suites))
				}

				// Suites are sorted by key, so "GET /api/config" < "POST /api/users".
				configSuite := root.Suites[0]
				usersSuite := root.Suites[1]

				if configSuite.Name != "GET /api/config" {
					t.Errorf("expected first suite 'GET /api/config', got %q", configSuite.Name)
				}
				if configSuite.Tests != 1 {
					t.Errorf("expected 1 test in config suite, got %d", configSuite.Tests)
				}

				if usersSuite.Name != "POST /api/users" {
					t.Errorf("expected second suite 'POST /api/users', got %q", usersSuite.Name)
				}
				if usersSuite.Tests != 2 {
					t.Errorf("expected 2 tests in users suite, got %d", usersSuite.Tests)
				}
			},
		},
		{
			name: "special XML characters in payload are properly escaped",
			findings: []*classifier.Finding{
				{
					RuleID:   "swazz/reflected-xss",
					Level:    classifier.SeverityError,
					Method:   "POST",
					Endpoint: "/api/search",
					Duration: 42,
					Payload:  `<script>alert("x&y")</script>`,
					Error:    `<b>found & "quoted"</b>`,
				},
			},
			stats: nil,
			verify: func(t *testing.T, data []byte) {
				raw := string(data)

				// The raw XML should contain escaped versions of special chars.
				if strings.Contains(raw, `<script>`) {
					t.Error("raw XML should not contain unescaped <script> tag")
				}
				if !strings.Contains(raw, "&lt;script&gt;") && !strings.Contains(raw, "&#x") {
					t.Error("raw XML should contain escaped angle brackets")
				}

				// Round-trip should recover original content.
				var root junitRoundTripSuites
				if err := xml.Unmarshal(data, &root); err != nil {
					t.Fatalf("Failed to unmarshal: %v", err)
				}
				body := root.Suites[0].Cases[0].Failure.Body
				if !strings.Contains(body, `<script>alert("x&y")</script>`) {
					t.Errorf("after unmarshal, body should contain unescaped payload, got: %s", body)
				}
			},
		},
		{
			name: "byte slice payload formats as string",
			findings: []*classifier.Finding{
				{
					RuleID:   "swazz/reflected-xss",
					Level:    classifier.SeverityError,
					Method:   "POST",
					Endpoint: "/api/search",
					Duration: 42,
					Payload:  []byte("fuzz-bytes-payload"),
				},
			},
			stats: nil,
			verify: func(t *testing.T, data []byte) {
				var root junitRoundTripSuites
				if err := xml.Unmarshal(data, &root); err != nil {
					t.Fatalf("Failed to unmarshal: %v", err)
				}
				body := root.Suites[0].Cases[0].Failure.Body
				if !strings.Contains(body, "fuzz-bytes-payload") {
					t.Errorf("expected body to contain payload string, got: %s", body)
				}
			},
		},
		{
			name: "nil findings elements are safely ignored",
			findings: []*classifier.Finding{
				nil,
				{
					RuleID:   "swazz/status-500",
					Level:    classifier.SeverityError,
					Method:   "POST",
					Endpoint: "/api/users",
					Duration: 100,
				},
				nil,
			},
			stats: nil,
			verify: func(t *testing.T, data []byte) {
				var root junitRoundTripSuites
				if err := xml.Unmarshal(data, &root); err != nil {
					t.Fatalf("Failed to unmarshal: %v", err)
				}
				if root.Tests != 1 {
					t.Errorf("expected 1 test, got %d", root.Tests)
				}
			},
		},
		{
			name: "round-trip unmarshal produces correct structure",
			findings: []*classifier.Finding{
				{
					RuleID:   "swazz/status-500",
					Level:    classifier.SeverityError,
					Method:   "DELETE",
					Endpoint: "/api/items/{id}",
					Duration: 350,
					Payload:  "fuzz-value",
				},
			},
			stats: &swagger.RunStats{StartTime: 0},
			verify: func(t *testing.T, data []byte) {
				var root junitRoundTripSuites
				if err := xml.Unmarshal(data, &root); err != nil {
					t.Fatalf("Failed to unmarshal: %v", err)
				}
				if root.Name != "swazz" {
					t.Errorf("expected root name 'swazz', got %q", root.Name)
				}
				if root.Tests != 1 {
					t.Errorf("expected 1 test, got %d", root.Tests)
				}
				if root.Errors != 1 {
					t.Errorf("expected 1 error, got %d", root.Errors)
				}

				suite := root.Suites[0]
				if suite.Name != "DELETE /api/items/{id}" {
					t.Errorf("expected suite name 'DELETE /api/items/{id}', got %q", suite.Name)
				}

				tc := suite.Cases[0]
				if tc.Time != "0.350" {
					t.Errorf("expected time '0.350', got %q", tc.Time)
				}
				if tc.Failure == nil {
					t.Fatal("expected failure element")
				}
				if !strings.Contains(tc.Failure.Body, "fuzz-value") {
					t.Error("failure body should contain payload")
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data := ToJUnit(tt.findings, tt.stats)

			// All outputs must be valid XML.
			if !strings.HasPrefix(string(data), "<?xml") {
				t.Error("output should start with XML declaration")
			}

			tt.verify(t, data)
		})
	}
}
