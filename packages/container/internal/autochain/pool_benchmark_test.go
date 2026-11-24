// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package autochain

import (
	"fmt"
	"testing"

	"swazz-engine/internal/swagger"
)

func BenchmarkPool_GetCoerced(b *testing.B) {
	pool := NewPool()
	for i := range 16 {
		pool.Put("res:orders:id", fmt.Sprintf("%d", i+100), int64(i+100))
	}
	schema := &swagger.SchemaProperty{Type: "integer"}
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		_, _, _ = pool.GetCoerced("res:orders:id", schema)
	}
}
