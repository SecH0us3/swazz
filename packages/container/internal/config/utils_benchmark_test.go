// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package config

import "testing"

func BenchmarkMatchesAny_Exact(b *testing.B) {
	patterns := []string{
		"GET /api/transactionsdashboard/wallets",
		"POST /api/transactionsdashboard/transactions/list",
		"GET /api/transactionsdashboard/tags/all",
	}
	key := "POST /api/transactionsdashboard/transactions/list"
	path := "/api/transactionsdashboard/transactions/list"

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = matchesAny(key, path, patterns)
	}
}

func BenchmarkMatchesAny_Glob(b *testing.B) {
	patterns := []string{
		"/api/transactionsdashboard/**",
		"GET /api/wallets/*",
	}
	key := "POST /api/transactionsdashboard/transactions/list"
	path := "/api/transactionsdashboard/transactions/list"

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = matchesAny(key, path, patterns)
	}
}
