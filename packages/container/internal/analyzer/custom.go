package analyzer

import (
	"fmt"
	"regexp"
	"swazz-engine/internal/swagger"
)

type CustomRule struct {
	RuleID  string // e.g. "swazz/custom-auth-leak"
	Level   string // "error", "warning", "note"
	Name    string // e.g. "Auth Token Leak"
	Pattern string // regex string
	Message string // human-readable message
}

// CustomRules is a registry where developers can easily add new custom group detectors.
// Add a new CustomRule struct here to detect specific patterns in HTTP response bodies.
var CustomRules = []CustomRule{
	{
		RuleID:  "swazz/sensitive-data-leak",
		Level:   "warning",
		Name:    "LFI / Path Traversal Leak",
		Pattern: `(?m)(root:x:0:0:|\[boot loader\]\s*timeout=)`,
		Message: "Sensitive file contents (LFI/Path Traversal) detected in response body.",
	},
	{
		RuleID:  "swazz/rce-leak",
		Level:   "error",
		Name:    "Remote Code Execution (RCE) Leak",
		Pattern: `(?m)(uid=\d+\(.*?\)\s+gid=\d+|bash:\s+.*:\s+command not found)`,
		Message: "System command execution output (RCE) detected in response body.",
	},
}

type CustomAnalyzer struct {
	compiled []compiledCustomRule
}

type compiledCustomRule struct {
	rule    CustomRule
	pattern *regexp.Regexp
}

func (a *CustomAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if len(input.ResponseBody) == 0 {
		return nil
	}

	// Compile on demand once
	if len(a.compiled) == 0 && len(CustomRules) > 0 {
		a.compiled = make([]compiledCustomRule, 0, len(CustomRules))
		for _, r := range CustomRules {
			re, err := regexp.Compile(r.Pattern)
			if err == nil {
				a.compiled = append(a.compiled, compiledCustomRule{
					rule:    r,
					pattern: re,
				})
			}
		}
	}

	var findings []swagger.AnalysisFinding
	for _, cr := range a.compiled {
		loc := cr.pattern.FindIndex(input.ResponseBody)
		if loc != nil {
			matchText := string(input.ResponseBody[loc[0]:loc[1]])
			start := loc[0] - 20
			if start < 0 {
				start = 0
			}
			end := loc[1] + 100
			if end > len(input.ResponseBody) {
				end = len(input.ResponseBody)
			}
			contextSnippet := string(input.ResponseBody[start:end])
			if len(contextSnippet) > 150 {
				contextSnippet = contextSnippet[:150]
			}

			findings = append(findings, swagger.AnalysisFinding{
				RuleID:   cr.rule.RuleID,
				Level:    cr.rule.Level,
				Message:  cr.rule.Message,
				Evidence: fmt.Sprintf("Match: '%s' | Snippet: ...%s...", matchText, contextSnippet),
			})
		}
	}

	return findings
}
