// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"fmt"
	"swazz-engine/internal/swagger"
)

type SQLiAnalyzer struct{}

type dbSignature struct {
	name     string
	patterns []string
}

var dbSignatures []dbSignature

func init() {
	dbSignatures = []dbSignature{
		{"MySQL", []string{"You have an error in your SQL syntax", "mysql_fetch", "MySQLSyntaxErrorException", "com.mysql.jdbc", "mysql.connector"}},
		{"PostgreSQL", []string{"ERROR:  syntax error at or near", "ERROR: syntax error at or near", "pg_query", "PSQLException", "PG::SyntaxError", "npgsql.postgres"}},
		{"SQLite", []string{"SQLITE_ERROR", "near ", "sqlite3.OperationalError", "syntax error"}},
		{"MSSQL", []string{"Unclosed quotation mark", "Microsoft OLE DB", "ODBC SQL Server Driver", "SQLServerException"}},
		{"Oracle", []string{"ORA-", "quoted string not properly terminated"}},
		{"Generic", []string{"SQLSTATE", "java.sql.SQLException", "System.Data.SqlClient"}},
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

OuterLoop:
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

		for _, pattern := range sig.patterns {
			idx := indexFoldASCII(input.ResponseBody, pattern)
			if idx != -1 {
				matchText := string(input.ResponseBody[idx : idx+len(pattern)])

				// Extract context around the match
				start := idx - 50
				if start < 0 {
					start = 0
				}
				end := idx + len(pattern) + 50
				if end > len(input.ResponseBody) {
					end = len(input.ResponseBody)
				}
				contextSnippet := string(input.ResponseBody[start:end])
				if len(contextSnippet) > 200 {
					contextSnippet = contextSnippet[:200]
				}

				findings = append(findings, swagger.AnalysisFinding{
					RuleID:           "swazz/sql-error-leak",
					Level:            "error",
					Message:          fmt.Sprintf("SQL injection vulnerability: %s database error leaked in the response.", sig.name),
					Evidence:         fmt.Sprintf("Match: %q | Context: ...%s...", matchText, contextSnippet),
					OWASPAPICategory: []string{"API8:2023 Security Misconfiguration"},
					OWASPCategory:    []string{"A03:2025 Injection", "A05:2025 Security Misconfiguration"},
					CWEIDs:           []string{"CWE-89", "CWE-209"},
				})
				break OuterLoop // Report only the first match per response to avoid duplicate noise
			}
		}
	}

	return findings
}
