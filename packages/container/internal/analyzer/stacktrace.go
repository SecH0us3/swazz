package analyzer

import (
	"fmt"
	"regexp"
	"swazz-engine/internal/swagger"
)

type StackTraceAnalyzer struct{}

type stackSignature struct {
	language string
	pattern  *regexp.Regexp
}

var stackSignatures []stackSignature

func init() {
	signatures := []struct {
		language string
		pattern  string
	}{
		{"Java", `(?m)(at\s+java\.|at\s+sun\.|at\s+org\.springframework\.|.+\.java:\d+\))`},
		{"Python", `(?m)(Traceback\s+\(most\s+recent\s+call\s+last\)|File\s+".+",\s+line\s+\d+)`},
		{"Go", `(?m)(goroutine\s+\d+\s+\[|panic:|runtime\s+error:)`},
		{"NodeJS", `(?m)(at\s+Object\.<anonymous>|at\s+Module\._compile|node_modules/)`},
		{".NET", `(?m)(at\s+System\.|System\.NullReferenceException|Server\s+Error\s+in\s+)`},
		{"PHP", `(?m)(Fatal\s+error:|Stack\s+trace:|in\s+/var/www/)`},
	}

	for _, sig := range signatures {
		stackSignatures = append(stackSignatures, stackSignature{
			language: sig.language,
			pattern:  regexp.MustCompile(sig.pattern),
		})
	}
}

func (a *StackTraceAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	bodyStr := string(input.ResponseBody)
	if bodyStr == "" {
		return nil
	}

	var findings []swagger.AnalysisFinding

	for _, sig := range stackSignatures {
		loc := sig.pattern.FindStringIndex(bodyStr)
		if loc != nil {
			matchText := bodyStr[loc[0]:loc[1]]

			// Extract snippet of traceback context (up to 150 chars)
			start := loc[0] - 20
			if start < 0 {
				start = 0
			}
			end := loc[1] + 100
			if end > len(bodyStr) {
				end = len(bodyStr)
			}
			contextSnippet := bodyStr[start:end]
			if len(contextSnippet) > 150 {
				contextSnippet = contextSnippet[:150]
			}

			findings = append(findings, swagger.AnalysisFinding{
				RuleID:   "swazz/stack-trace-leak",
				Level:    "warning",
				Message:  fmt.Sprintf("Server stack trace traceback (%s) leaked in the response body.", sig.language),
				Evidence: fmt.Sprintf("Match: '%s' | Traceback snippet: ...%s...", matchText, contextSnippet),
			})
			break
		}
	}

	return findings
}
