package analyzer

import (
	"fmt"
	"regexp"
	"swazz-engine/internal/swagger"
)

type SQLiAnalyzer struct{}

type dbSignature struct {
	name    string
	pattern *regexp.Regexp
}

var dbSignatures []dbSignature

func init() {
	signatures := []struct {
		name    string
		pattern string
	}{
		{"MySQL", `(?i)(You have an error in your SQL syntax|mysql_fetch|MySQLSyntaxErrorException)`},
		{"PostgreSQL", `(?i)(ERROR:\s+syntax error at or near|pg_query|PSQLException)`},
		{"SQLite", `(?i)(SQLITE_ERROR|near ".*": syntax error)`},
		{"MSSQL", `(?i)(Unclosed quotation mark|Microsoft OLE DB|ODBC SQL Server Driver)`},
		{"Oracle", `(?i)(ORA-\d{5}|quoted string not properly terminated)`},
		{"Generic", `(?i)(SQLSTATE\[\w+\]|java\.sql\.SQLException|System\.Data\.SqlClient)`},
	}

	for _, sig := range signatures {
		dbSignatures = append(dbSignatures, dbSignature{
			name:    sig.name,
			pattern: regexp.MustCompile(sig.pattern),
		})
	}
}

func (a *SQLiAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	bodyStr := string(input.ResponseBody)
	if bodyStr == "" {
		return nil
	}

	var findings []swagger.AnalysisFinding

	for _, sig := range dbSignatures {
		loc := sig.pattern.FindStringIndex(bodyStr)
		if loc != nil {
			matchText := bodyStr[loc[0]:loc[1]]

			// Extract context around the match
			start := loc[0] - 50
			if start < 0 {
				start = 0
			}
			end := loc[1] + 50
			if end > len(bodyStr) {
				end = len(bodyStr)
			}
			contextSnippet := bodyStr[start:end]
			if len(contextSnippet) > 200 {
				contextSnippet = contextSnippet[:200]
			}

			findings = append(findings, swagger.AnalysisFinding{
				RuleID:   "swazz/sql-error-leak",
				Level:    "error",
				Message:  fmt.Sprintf("Database error signature (%s) leaked in the response body.", sig.name),
				Evidence: fmt.Sprintf("Match: '%s' | Context: ...%s...", matchText, contextSnippet),
			})
			// Limit to one SQL error finding per response to avoid duplicate noise
			break
		}
	}

	return findings
}
