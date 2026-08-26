// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import "testing"

func BenchmarkContainsFoldASCII_Match(b *testing.B) {
	haystack := []byte(`{"status": "error", "message": "Database query syntax error near 'id'"}`)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = containsFoldASCII(haystack, "syntax")
	}
}

func BenchmarkContainsFoldASCII_NoMatch(b *testing.B) {
	haystack := []byte(`{"status": "ok", "items": [{"id": 1, "name": "Item 1"}, {"id": 2, "name": "Item 2"}]}`)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = containsFoldASCII(haystack, "syntax")
	}
}

func BenchmarkSQLiAnalyzer_CleanResponse(b *testing.B) {
	analyzer := &SQLiAnalyzer{}
	input := &AnalysisInput{
		ResponseBody: []byte(`{"status": "ok", "items": [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]}`),
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = analyzer.Analyze(input)
	}
}

func BenchmarkSQLiAnalyzer_ErrorResponse(b *testing.B) {
	analyzer := &SQLiAnalyzer{}
	input := &AnalysisInput{
		ResponseBody: []byte(`{"error": "You have an error in your SQL syntax near 'admin' at line 1"}`),
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = analyzer.Analyze(input)
	}
}

func BenchmarkStackTraceAnalyzer_CleanResponse(b *testing.B) {
	analyzer := &StackTraceAnalyzer{}
	input := &AnalysisInput{
		ResponseBody: []byte(`{"status": "ok", "users": ["user1", "user2", "user3"]}`),
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = analyzer.Analyze(input)
	}
}

func BenchmarkStackTraceAnalyzer_ErrorResponse(b *testing.B) {
	analyzer := &StackTraceAnalyzer{}
	input := &AnalysisInput{
		ResponseBody: []byte(`{"error": "NullPointerException: Cannot invoke \"User.getName()\" because \"user\" is null\n\tat com.app.Controller.getUser(Controller.java:42)"}`),
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = analyzer.Analyze(input)
	}
}

func BenchmarkSensitiveAnalyzer_CleanResponse(b *testing.B) {
	analyzer := &SensitiveAnalyzer{}
	input := &AnalysisInput{
		ResponseBody: []byte(`{"status": "ok", "data": {"count": 42, "enabled": true}}`),
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = analyzer.Analyze(input)
	}
}

func BenchmarkSensitiveAnalyzer_SecretResponse(b *testing.B) {
	analyzer := &SensitiveAnalyzer{}
	input := &AnalysisInput{
		ResponseBody: []byte(`{"credentials": {"aws_key": "AKIAIOSFODNN7EXAMPLE", "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeak"}}`),
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = analyzer.Analyze(input)
	}
}
