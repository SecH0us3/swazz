package classifier

import (
	"fmt"
	"strconv"
	"strings"

	"swazz-engine/internal/swagger"
)

// Severity levels for findings.
type Severity string

const (
	SeverityError   Severity = "error"
	SeverityWarning Severity = "warning"
	SeverityNote    Severity = "note"
	SeverityIgnore  Severity = "ignore"
)

// Finding is a classified fuzz result that is reportable.
type Finding struct {
	ID           string                 `json:"id"`
	RuleID       string                 `json:"ruleId"`
	Level        Severity               `json:"level"`
	Endpoint     string                 `json:"endpoint"`
	ResolvedPath string                 `json:"resolvedPath"`
	Method       string                 `json:"method"`
	Profile      swagger.FuzzingProfile `json:"profile"`
	Status       int                    `json:"status"`
	Duration     int64                  `json:"duration"`
	Payload      any                    `json:"payload"`
	ResponseBody any                    `json:"responseBody,omitempty"`
	Error        string                 `json:"error,omitempty"`
	Timestamp    int64                  `json:"timestamp"`
	Source       string                 `json:"source"`
	OWASPCategory []string               `json:"owaspCategory,omitempty"`
}

// RulesConfig configures how results are classified.
type RulesConfig struct {
	Ignore   []int               `json:"ignore,omitempty"`
	Severity map[string]Severity `json:"severity,omitempty"`
	Defaults map[string]Severity `json:"defaults,omitempty"`
}

var defaultIgnore = map[int]bool{
	401: true, 403: true, 404: true, 405: true, 422: true, 429: true,
}

var defaultDefaults = map[string]Severity{
	"1xx":           SeverityIgnore,
	"2xx":           SeverityIgnore,
	"3xx":           SeverityIgnore,
	"4xx":           SeverityError,
	"5xx":           SeverityError,
	"timeout":       SeverityError,
	"network_error": SeverityError,
}

// Classifier converts raw FuzzResults into Findings based on rules.
type Classifier struct {
	ignoreSet map[int]bool
	severity  map[string]Severity
	defaults  map[string]Severity
}

// New creates a Classifier from optional rules config.
func New(rules *RulesConfig) *Classifier {
	c := &Classifier{
		ignoreSet: make(map[int]bool),
		severity:  make(map[string]Severity),
		defaults:  defaultDefaults,
	}

	if rules == nil {
		for k, v := range defaultIgnore {
			c.ignoreSet[k] = v
		}
		return c
	}

	if len(rules.Ignore) > 0 {
		for _, code := range rules.Ignore {
			c.ignoreSet[code] = true
		}
	} else {
		for k, v := range defaultIgnore {
			c.ignoreSet[k] = v
		}
	}

	if rules.Severity != nil {
		c.severity = rules.Severity
	}
	if rules.Defaults != nil {
		c.defaults = rules.Defaults
	}

	return c
}

// Classify converts a FuzzResult into a Finding, or returns nil if ignored.
func (c *Classifier) Classify(result *swagger.FuzzResult) *Finding {
	level := c.resolveLevel(result)
	if level == SeverityIgnore {
		return nil
	}

	ruleID := RuleIDForResult(result)
	return &Finding{
		ID:            result.ID,
		RuleID:        ruleID,
		Level:         level,
		Endpoint:      result.Endpoint,
		ResolvedPath:  result.ResolvedPath,
		Method:        result.Method,
		Profile:       result.Profile,
		Status:        result.Status,
		Duration:      result.Duration,
		Payload:       result.Payload,
		ResponseBody:  result.ResponseBody,
		Error:         result.Error,
		Timestamp:     result.Timestamp,
		Source:        "status_code",
		OWASPCategory: OWASPCategories(ruleID),
	}
}

// ClassifyAll classifies a slice of results, filtering out ignored ones.
func (c *Classifier) ClassifyAll(results []*swagger.FuzzResult) []*Finding {
	maxPerDefect := 5
	defectCounts := make(map[string]int)
	var findings []*Finding

	for _, r := range results {
		// 1. Standard status-code finding
		sf := c.Classify(r)
		if sf != nil {
			defectKey := fmt.Sprintf("%s::%s %s", sf.RuleID, sf.Method, sf.Endpoint)
			count := defectCounts[defectKey]
			if count < maxPerDefect {
				// Truncate huge response bodies
				if body, ok := sf.ResponseBody.(string); ok && len(body) > 50000 {
					sf.ResponseBody = body[:50000] + "\n... [TRUNCATED BY SWAZZ]"
				}
				findings = append(findings, sf)
				defectCounts[defectKey] = count + 1
			}
		}

		// 2. Response body analyzer findings
		for _, af := range r.AnalyzerFindings {
			source := "response_body"
			if strings.HasPrefix(af.RuleID, "swazz/crlf-") || strings.HasPrefix(af.RuleID, "swazz/header-") || af.RuleID == "swazz/crlf-injection" {
				source = "response_headers"
			} else if af.RuleID == "swazz/no-rate-limit" || af.RuleID == "swazz/rate-limit-active" {
				source = "rate_limiting"
			} else if af.RuleID == "swazz/bola-idor" || af.RuleID == "swazz/unauthorized-access" {
				source = "access_control"
			}
			f := &Finding{
				ID:           r.ID,
				RuleID:       af.RuleID,
				Level:        Severity(af.Level),
				Endpoint:     r.Endpoint,
				ResolvedPath: r.ResolvedPath,
				Method:       r.Method,
				Profile:      r.Profile,
				Status:       r.Status,
				Duration:     r.Duration,
				Payload:      r.Payload,
				ResponseBody: r.ResponseBody,
				Error:        af.Evidence, // Store evidence matched fragment here
				Timestamp:     r.Timestamp,
				Source:        source,
				OWASPCategory: OWASPCategories(af.RuleID),
			}

			defectKey := fmt.Sprintf("%s::%s %s", f.RuleID, f.Method, f.Endpoint)
			count := defectCounts[defectKey]
			if count < maxPerDefect {
				// Truncate huge response bodies
				if body, ok := f.ResponseBody.(string); ok && len(body) > 50000 {
					f.ResponseBody = body[:50000] + "\n... [TRUNCATED BY SWAZZ]"
				}
				findings = append(findings, f)
				defectCounts[defectKey] = count + 1
			}
		}
	}

	return findings
}

func (c *Classifier) resolveLevel(result *swagger.FuzzResult) Severity {
	status := result.Status

	// 1. Explicit ignore list
	if c.ignoreSet[status] {
		return SeverityIgnore
	}

	// 2. Explicit severity for this status code
	statusKey := strconv.Itoa(status)
	if sev, ok := c.severity[statusKey]; ok {
		return sev
	}

	// 3. Defaults by range
	var rangeKey string
	if status == 0 {
		if strings.Contains(result.Error, "timed out") {
			rangeKey = "timeout"
		} else {
			rangeKey = "network_error"
		}
	} else {
		rangeKey = fmt.Sprintf("%dxx", status/100)
	}

	if sev, ok := c.defaults[rangeKey]; ok {
		return sev
	}

	// 4. Fallback
	return SeverityError
}

// RuleIDForResult returns the default rule ID for a fuzz result based on its HTTP status code or error.
func RuleIDForResult(result *swagger.FuzzResult) string {
	if result.Status == 0 {
		if strings.Contains(result.Error, "timed out") {
			return "swazz/timeout"
		}
		return "swazz/network-error"
	}
	return fmt.Sprintf("swazz/status-%d", result.Status)
}
