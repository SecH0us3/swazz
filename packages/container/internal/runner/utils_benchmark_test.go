// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"fmt"
	"testing"
)

func BenchmarkToString_String(b *testing.B) {
	val := "api/v1/users"
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = toString(val)
	}
}

func BenchmarkFmtSprintf_String(b *testing.B) {
	val := "api/v1/users"
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = fmt.Sprintf("%v", val)
	}
}

func BenchmarkToString_Int(b *testing.B) {
	val := 12345
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = toString(val)
	}
}

func BenchmarkFmtSprintf_Int(b *testing.B) {
	val := 12345
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = fmt.Sprintf("%v", val)
	}
}

func BenchmarkToString_Bool(b *testing.B) {
	val := true
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = toString(val)
	}
}

func BenchmarkFmtSprintf_Bool(b *testing.B) {
	val := true
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = fmt.Sprintf("%v", val)
	}
}
