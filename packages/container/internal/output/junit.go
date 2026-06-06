package output

import (
	"encoding/xml"
	"fmt"
	"sort"
	"time"

	"swazz-engine/internal/classifier"
	"swazz-engine/internal/swagger"
)

// junitTestSuites is the root element of a JUnit XML report.
type junitTestSuites struct {
	XMLName  xml.Name         `xml:"testsuites"`
	Name     string           `xml:"name,attr"`
	Tests    int              `xml:"tests,attr"`
	Failures int              `xml:"failures,attr"`
	Errors   int              `xml:"errors,attr"`
	Time     string           `xml:"time,attr"`
	Suites   []junitTestSuite `xml:"testsuite"`
}

// junitTestSuite represents a single <testsuite> element.
type junitTestSuite struct {
	Name     string          `xml:"name,attr"`
	Tests    int             `xml:"tests,attr"`
	Failures int             `xml:"failures,attr"`
	Errors   int             `xml:"errors,attr"`
	Time     string          `xml:"time,attr"`
	Cases    []junitTestCase `xml:"testcase"`
}

// junitTestCase represents a single <testcase> element.
type junitTestCase struct {
	Name      string        `xml:"name,attr"`
	ClassName string        `xml:"classname,attr"`
	Time      string        `xml:"time,attr"`
	Failure   *junitFailure `xml:"failure,omitempty"`
	SystemOut string        `xml:"system-out,omitempty"`
}

// junitFailure represents a <failure> element inside a test case.
type junitFailure struct {
	Message string `xml:"message,attr"`
	Type    string `xml:"type,attr"`
	Body    string `xml:",chardata"`
}

// ToJUnit generates a JUnit XML report from classified findings.
func ToJUnit(findings []*classifier.Finding, stats *swagger.RunStats) []byte {
	// Group findings by endpoint key (Method + " " + Endpoint).
	type endpointGroup struct {
		key      string
		findings []*classifier.Finding
	}

	groupMap := make(map[string]*endpointGroup)
	var groupOrder []string

	for _, f := range findings {
		if f == nil {
			continue
		}
		key := fmt.Sprintf("%s %s", f.Method, f.Endpoint)
		g, exists := groupMap[key]
		if !exists {
			g = &endpointGroup{key: key}
			groupMap[key] = g
			groupOrder = append(groupOrder, key)
		}
		g.findings = append(g.findings, f)
	}

	// Sort keys for deterministic output.
	sort.Strings(groupOrder)

	// Build test suites.
	var totalTests, totalFailures, totalErrors int
	var totalDurationMs int64
	suites := make([]junitTestSuite, 0, len(groupOrder))

	for _, key := range groupOrder {
		g := groupMap[key]
		var suiteFailures, suiteErrors int
		var suiteDurationMs int64
		cases := make([]junitTestCase, 0, len(g.findings))

		for _, f := range g.findings {
			if f == nil {
				continue
			}
			suiteDurationMs += f.Duration
			tc := junitTestCase{
				Name:      f.RuleID,
				ClassName: key,
				Time:      formatDurationSec(f.Duration),
			}

			body := formatFailureBody(f)

			switch f.Level {
			case classifier.SeverityError:
				suiteErrors++
				tc.Failure = &junitFailure{
					Message: descriptionForRule(f.RuleID),
					Type:    "error",
					Body:    body,
				}
			case classifier.SeverityWarning:
				suiteFailures++
				tc.Failure = &junitFailure{
					Message: descriptionForRule(f.RuleID),
					Type:    "warning",
					Body:    body,
				}
			default:
				// note / ignore → system-out
				tc.SystemOut = body
			}

			cases = append(cases, tc)
		}

		suiteTests := len(g.findings)
		totalTests += suiteTests
		totalFailures += suiteFailures
		totalErrors += suiteErrors
		totalDurationMs += suiteDurationMs

		suites = append(suites, junitTestSuite{
			Name:     key,
			Tests:    suiteTests,
			Failures: suiteFailures,
			Errors:   suiteErrors,
			Time:     formatDurationSec(suiteDurationMs),
			Cases:    cases,
		})
	}

	// Compute top-level time.
	topTime := computeTopTime(stats, totalDurationMs)

	root := junitTestSuites{
		Name:     "swazz",
		Tests:    totalTests,
		Failures: totalFailures,
		Errors:   totalErrors,
		Time:     topTime,
		Suites:   suites,
	}

	out, _ := xml.MarshalIndent(root, "", "  ")
	return append([]byte(xml.Header), out...)
}

// formatDurationSec converts milliseconds to a JUnit-style seconds string.
func formatDurationSec(ms int64) string {
	return fmt.Sprintf("%.3f", float64(ms)/1000.0)
}

// computeTopTime returns a formatted duration string for the root element.
func computeTopTime(stats *swagger.RunStats, fallbackMs int64) string {
	if stats != nil && stats.StartTime > 0 {
		elapsed := time.Now().UnixMilli() - stats.StartTime
		return formatDurationSec(elapsed)
	}
	return formatDurationSec(fallbackMs)
}

// formatFailureBody builds the text body for a failure or system-out element.
func formatFailureBody(f *classifier.Finding) string {
	body := fmt.Sprintf("Rule: %s\nSeverity: %s", f.RuleID, f.Level)
	if f.Error != "" {
		body += fmt.Sprintf("\nEvidence: %s", f.Error)
	}
	if f.Payload != nil {
		switch p := f.Payload.(type) {
		case []byte:
			body += fmt.Sprintf("\nPayload: %s", string(p))
		default:
			body += fmt.Sprintf("\nPayload: %v", p)
		}
	}
	return body
}
