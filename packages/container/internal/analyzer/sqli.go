// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

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
		{"MySQL", `(?i)(You have an error in your SQL syntax|mysql_fetch|MySQLSyntaxErrorException|com\.mysql\.jdbc|mysql\.connector)`},
		{"PostgreSQL", `(?i)(ERROR:\s+syntax error at or near|pg_query|PSQLException|PG::SyntaxError|npgsql\.postgres)`},
		{"SQLite", `(?i)(SQLITE_ERROR|near ".*": syntax error|sqlite3\.OperationalError)`},
		{"MSSQL", `(?i)(Unclosed quotation mark|Microsoft OLE DB|ODBC SQL Server Driver|SQLServerException)`},
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
	if len(input.ResponseBody) == 0 {
		return nil
	}

	// Fast pre-filter: skip scanning if no SQL error indicators are present in response body
	if !containsAnyFoldASCII(input.ResponseBody, "syntax", "sql", "mysql", "postgres", "psql", "pg_", "pg::", "sqlite", "ora-", "quotation", "quoted string", "driver", "oledb", "sqlstate", "npgsql", "sqlclient", "sqlexception") {
		return nil
	}

	var findings []swagger.AnalysisFinding

	for _, sig := range dbSignatures {
		switch sig.name {
		case "MySQL":
			if !containsAnyFoldASCII(input.ResponseBody, "syntax", "mysql", "jdbc") {
				continue
			}
		case "PostgreSQL":
			if !containsAnyFoldASCII(input.ResponseBody, "syntax", "pg_", "psql", "pg::", "npgsql") {
				continue
			}
		case "SQLite":
			if !containsAnyFoldASCII(input.ResponseBody, "sqlite", "syntax") {
				continue
			}
		case "MSSQL":
			if !containsAnyFoldASCII(input.ResponseBody, "quotation", "oledb", "sql server", "sqlserver") {
				continue
			}
		case "Oracle":
			if !containsAnyFoldASCII(input.ResponseBody, "ora-", "quoted string") {
				continue
			}
		case "Generic":
			if !containsAnyFoldASCII(input.ResponseBody, "sqlstate", "sqlexception", "sqlclient") {
				continue
			}
		}

		loc := sig.pattern.FindIndex(input.ResponseBody)
		if loc != nil {
			matchText := string(input.ResponseBody[loc[0]:loc[1]])

			// Extract context around the match
			start := loc[0] - 50
			if start < 0 {
				start = 0
			}
			end := loc[1] + 50
			if end > len(input.ResponseBody) {
				end = len(input.ResponseBody)
			}
			contextSnippet := string(input.ResponseBody[start:end])
			if len(contextSnippet) > 200 {
				contextSnippet = contextSnippet[:200]
			}

			findings = append(findings, swagger.AnalysisFinding{
				RuleID:   "swazz/sql-error-leak",
				Level:    "error",
				Message:  fmt.Sprintf("Database error signature (%s) leaked in the response body.", sig.name),
				Evidence: fmt.Sprintf("Match: %q | Context: ...%s...", matchText, contextSnippet),
			})
			// Limit to one SQL error finding per response to avoid duplicate noise
			break
		}
	}

	return findings
}
