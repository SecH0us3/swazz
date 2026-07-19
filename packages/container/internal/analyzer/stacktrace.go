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

type nullPointerSignature struct {
	language string
	pattern  *regexp.Regexp
}

var stackSignatures []stackSignature
var nullPointerSignatures []nullPointerSignature

func init() {
	signatures := []struct {
		language string
		pattern  string
	}{
		{"Java", `(?m)(at\s+java\.|at\s+sun\.|at\s+org\.springframework\.|.+\.java:\d+\)|org\.apache\.catalina|at\s+spring\.)`},
		{"Python", `(?m)(Traceback\s+\(most\s+recent\s+call\s+last\)|File\s+".+",\s+line\s+\d+|django\.core\.|flask/app\.py)`},
		{"Go", `(?m)(goroutine\s+\d+\s+\[|panic:|runtime\s+error:)`},
		{"NodeJS", `(?m)(at\s+Object\.<anonymous>|at\s+Module\._compile|node_modules/|@nestjs/core|express/lib/router)`},
		{".NET", `(?m)(at\s+System\..+\sin\s.+:\w+\s\d+|System\.\w+Exception:|Server\s+Error\s+in\s+)`},
		{"PHP", `(?m)(Fatal\s+error:|Stack\s+trace:|in\s+/var/www/|Laravel\\Framework|Illuminate\\Routing)`},
		{"Ruby", `(?m)(actionpack|active_record|action_controller|bin/rails|/gems/|at\s+.+\.rb:\d+)`},
	}

	for _, sig := range signatures {
		stackSignatures = append(stackSignatures, stackSignature{
			language: sig.language,
			pattern:  regexp.MustCompile(sig.pattern),
		})
	}

	npeSignatures := []struct {
		language string
		pattern  string
	}{
		{".NET", `(?i)System\.NullReferenceException`},
		{"Java", `(?i)java\.lang\.NullPointerException|NullPointerException|Cannot invoke \".+\" because \".+\" is null`},
		{"Go", `(?i)nil pointer dereference`},
		{"Python", `(?i)AttributeError: 'NoneType' object|TypeError: 'NoneType' object`},
		{"NodeJS", `(?i)Cannot read propert(y|ies) of (null|undefined)`},
		{"PHP", `(?i)Call to a member function .+\(\) on null|Attempt to read property .+\s+on null|member function on null`},
		{"Ruby", `(?i)undefined method .* for nil:NilClass`},
	}

	for _, sig := range npeSignatures {
		nullPointerSignatures = append(nullPointerSignatures, nullPointerSignature{
			language: sig.language,
			pattern:  regexp.MustCompile(sig.pattern),
		})
	}
}

func (a *StackTraceAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if len(input.ResponseBody) == 0 {
		return nil
	}

	var findings []swagger.AnalysisFinding

	// 1. Check for Null Reference / Pointer Exceptions first (higher priority/severity)
	for _, sig := range nullPointerSignatures {
		loc := sig.pattern.FindIndex(input.ResponseBody)
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
				RuleID:   "swazz/null-pointer-exception",
				Level:    "error",
				Message:  fmt.Sprintf("Null Reference / Pointer Exception (%s) detected in the response body.", sig.language),
				Evidence: fmt.Sprintf("Match: %q | Snippet: ...%s...", matchText, contextSnippet),
			})
			return findings // Return immediately so it is classified as Null Pointer Exception instead of generic stack trace
		}
	}

	// 2. Generic language stack traces
	for _, sig := range stackSignatures {
		loc := sig.pattern.FindIndex(input.ResponseBody)
		if loc != nil {
			matchText := string(input.ResponseBody[loc[0]:loc[1]])

			// Extract snippet of traceback context (up to 150 chars)
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
				RuleID:   "swazz/stack-trace-leak",
				Level:    "warning",
				Message:  fmt.Sprintf("Server stack trace traceback (%s) leaked in the response body.", sig.language),
				Evidence: fmt.Sprintf("Match: %q | Traceback snippet: ...%s...", matchText, contextSnippet),
			})
			break
		}
	}

	return findings
}
