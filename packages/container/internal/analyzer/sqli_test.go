package analyzer

import (
	"strings"
	"testing"
)

func TestSQLiAnalyzer(t *testing.T) {
	a := &SQLiAnalyzer{}

	tests := []struct {
		name          string
		response      string
		expectedCount int
		contains      string
	}{
		{
			name:          "MySQL syntax error signature match",
			response:      "Something failed: You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version",
			expectedCount: 1,
			contains:      "You have an error in your SQL syntax",
		},
		{
			name:          "PostgreSQL pg_query signature match",
			response:      "Warning: pg_query(): Query failed: ERROR: syntax error at or near \"UNION\"",
			expectedCount: 1,
			contains:      "pg_query",
		},
		{
			name:          "SQLite SQLITE_ERROR match",
			response:      "Fatal: SQLITE_ERROR near \"users\": syntax error",
			expectedCount: 1,
			contains:      "SQLITE_ERROR",
		},
		{
			name:          "PostgreSQL npgsql syntax error match",
			response:      "Npgsql.PostgresException (0x80004005): 42601: syntax error at or near \"UNION\"",
			expectedCount: 1,
			contains:      "Npgsql.Postgres",
		},
		{
			name:          "PostgreSQL Ruby PG syntax error match",
			response:      "PG::SyntaxError: ERROR: syntax error at or near \"UNION\"",
			expectedCount: 1,
			contains:      "PG::SyntaxError",
		},
		{
			name:          "SQLite operational error match",
			response:      "sqlite3.OperationalError: near \"UNION\": syntax error",
			expectedCount: 1,
			contains:      "sqlite3.OperationalError",
		},
		{
			name:          "No match on regular response",
			response:      `{"status":"ok","users":[{"id":1,"name":"Alice"}]}`,
			expectedCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := &AnalysisInput{
				ResponseBody: []byte(tt.response),
			}
			findings := a.Analyze(input)
			if len(findings) != tt.expectedCount {
				t.Errorf("expected %d findings, got %d", tt.expectedCount, len(findings))
			}
			if len(findings) > 0 {
				if findings[0].RuleID != "swazz/sql-error-leak" {
					t.Errorf("expected ruleID swazz/sql-error-leak, got %s", findings[0].RuleID)
				}
				if !strings.Contains(findings[0].Evidence, tt.contains) {
					t.Errorf("expected evidence to contain '%s', got '%s'", tt.contains, findings[0].Evidence)
				}
			}
		})
	}
}
