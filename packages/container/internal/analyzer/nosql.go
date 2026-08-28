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

// NoSQLiAnalyzer inspects responses for NoSQL, MongoDB, Mongoose, BSON, CouchDB, and DynamoDB injection error signatures.
type NoSQLiAnalyzer struct{}

type noSQLSignature struct {
	db      string
	pattern *regexp.Regexp
}

var noSQLSignatures = []noSQLSignature{
	{"MongoDB/Mongoose", regexp.MustCompile(`(?i)(MongoServerError|MongoError|MongooseError|CastError:\s+Cast to \w+ failed|BSONTypeError|unknown operator:\s+\$|Cannot use '\$.*' in|\$where execution error|BadValue:\s+unknown operator)`)},
	{"MongoDB Javascript Engine", regexp.MustCompile(`(?i)(ReferenceError:\s+\w+ is not defined\s+at (?:eval|\$where|Function)|SyntaxError:\s+Unexpected token\s+.*at (?:eval|\$where))`)},
	{"CouchDB", regexp.MustCompile(`(?i)(couchdb.*error|no_db_file|database_does_not_exist|illegal_database_name)`)},
	{"DynamoDB", regexp.MustCompile(`(?i)(com\.amazonaws\.services\.dynamodbv2|DynamoDbException|ValidationException:\s+The provided key element does not match)`)},
}

func (a *NoSQLiAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if len(input.ResponseBody) == 0 {
		return nil
	}

	// Fast pre-filter: skip scanning if no NoSQL indicators are present in response body
	if !containsAnyFoldASCII(input.ResponseBody, "mongo", "bson", "cast to", "casterror", "operator", "dynamodb", "couchdb", "badvalue", "referenceerror", "syntaxerror", "$where", "validationexception", "no_db_file", "database_does_not_exist") {
		return nil
	}

	var findings []swagger.AnalysisFinding

	for _, sig := range noSQLSignatures {
		loc := sig.pattern.FindIndex(input.ResponseBody)
		if loc != nil {
			matchText := string(input.ResponseBody[loc[0]:loc[1]])

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
				RuleID:           "swazz/nosql-injection",
				Level:            "error",
				Message:          fmt.Sprintf("NoSQL / %s database error signature leaked in the response body.", sig.db),
				Evidence:         fmt.Sprintf("Match: %q | Context: ...%s...", matchText, contextSnippet),
				OWASPAPICategory: []string{"API3:2023 Broken Object Property Level Authorization"},
				OWASPCategory:    []string{"A03:2025 Injection"},
				CWEIDs:           []string{"CWE-943"},
			})
			break
		}
	}

	return findings
}
