// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package autochain

import (
	"fmt"
	"net/http"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/swagger"
)

func TestPool_HarvestCoercionEchoAndLocation(t *testing.T) {
	pool := NewPool()
	hdr := http.Header{}
	hdr.Set("Location", "https://api.example.com/api/v1/orders/9812?created=1")

	body := []byte(`{"id": 42, "echo_id": "echoed-val", "data": {"upload_token": "tok_abc"}}`)
	sentBody := map[string]any{"echo_id": "echoed-val"}

	rules := []ProducerRule{
		{PoolKey: "res:orders:id", ResponseExpr: ""},
		{PoolKey: "field:upload_token", ResponseExpr: "data.upload_token"},
	}

	pool.HarvestResponse(rules, hdr, body, sentBody)

	// Integer coercion on 42
	intVal, strVal, ok := pool.GetCoerced("res:orders:id", &swagger.SchemaProperty{Type: "integer"})
	require.True(t, ok)
	assert.Equal(t, int64(42), intVal)
	assert.Equal(t, "42", strVal)

	// Round-robin also surfaces Location header ID 9812
	intVal2, strVal2, ok := pool.GetCoerced("res:orders:id", &swagger.SchemaProperty{Type: "integer"})
	require.True(t, ok)
	assert.Equal(t, int64(9812), intVal2)
	assert.Equal(t, "9812", strVal2)

	// Echoed "echoed-val" must NOT be in res:orders:id
	assert.Equal(t, 2, pool.LiveCount("res:orders:id"))

	// Explicit field rule
	tokVal, _, ok := pool.GetCoerced("field:upload_token", &swagger.SchemaProperty{Type: "string"})
	require.True(t, ok)
	assert.Equal(t, "tok_abc", tokVal)
}

func TestPool_RingCapStrikeEvictionSacrificialAndReseedBudget(t *testing.T) {
	pool := NewPool()
	for i := range 40 {
		pool.Put("res:items:id", fmt.Sprintf("%d", i), int64(i))
	}
	assert.Equal(t, MaxEntriesPerKey, pool.LiveCount("res:items:id"))

	// Strike eviction after 2 misses
	pool.RecordMiss("res:items:id", "8")
	assert.Equal(t, MaxEntriesPerKey, pool.LiveCount("res:items:id"))
	pool.RecordMiss("res:items:id", "8")
	assert.Equal(t, MaxEntriesPerKey-1, pool.LiveCount("res:items:id"))

	// Sacrificial pop removes entry immediately
	before := pool.LiveCount("res:items:id")
	_, popped, ok := pool.TakeSacrificial("res:items:id", nil)
	require.True(t, ok)
	assert.NotEmpty(t, popped)
	assert.Equal(t, before-1, pool.LiveCount("res:items:id"))
	assert.True(t, pool.HadEntries("res:items:id"))

	// Re-seed budget strictly capped at MaxReseedsPerProducer (3)
	for range MaxReseedsPerProducer {
		assert.True(t, pool.TryAcquireReseed(0))
	}
	assert.False(t, pool.TryAcquireReseed(0))
}

func TestPool_ConcurrentRaceSafety(t *testing.T) {
	pool := NewPool()
	var wg sync.WaitGroup
	for g := range 8 {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := range 50 {
				pool.Put("res:users:id", fmt.Sprintf("u-%d-%d", id, i), nil)
				_, _, _ = pool.GetCoerced("res:users:id", &swagger.SchemaProperty{Type: "string"})
				pool.RecordMiss("res:users:id", fmt.Sprintf("u-%d-0", id))
			}
		}(g)
	}
	wg.Wait()
}

func TestPool_DeterministicWalkAndHeaderRules(t *testing.T) {
	body := []byte(`{"z_id":"z-1","a_id":"a-1","m_id":"m-1","id":"root-1"}`)
	rules := []ProducerRule{{PoolKey: "res:things:id", ResponseExpr: ""}}

	var firstSeq []string
	for run := range 20 {
		pool := NewPool()
		pool.HarvestResponse(rules, nil, body)
		count := pool.LiveCount("res:things:id")
		require.Equal(t, 4, count)
		seq := make([]string, count)
		for i := range count {
			_, s, ok := pool.GetCoerced("res:things:id", &swagger.SchemaProperty{Type: "string"})
			require.True(t, ok)
			seq[i] = s
		}
		if run == 0 {
			firstSeq = seq
		} else {
			assert.Equal(t, firstSeq, seq, "harvest insertion order must be deterministic")
		}
	}
	assert.Equal(t, []string{"root-1", "a-1", "m-1", "z-1"}, firstSeq)

	// Header rules & number coercion
	pool := NewPool()
	hdr := http.Header{}
	hdr.Set("Location", "/api/v2/invoices/77")
	hdr.Set("X-Session-Token", "sess_xyz")
	pool.HarvestResponse([]ProducerRule{
		{PoolKey: "link:loc", ResponseExpr: "$header.Location"},
		{PoolKey: "link:tok", ResponseExpr: "$header.X-Session-Token"},
	}, hdr, nil)

	numVal, _, ok := pool.GetCoerced("link:loc", &swagger.SchemaProperty{Type: "number"})
	require.True(t, ok)
	assert.Equal(t, float64(77), numVal)

	tokVal, _, ok := pool.GetCoerced("link:tok", &swagger.SchemaProperty{Type: "string"})
	require.True(t, ok)
	assert.Equal(t, "sess_xyz", tokVal)

	// Invalid scalars (empty, control chars) rejected
	pool.Put("bad", "", nil)
	pool.Put("bad", "line\nbreak", nil)
	assert.Equal(t, 0, pool.LiveCount("bad"))
	assert.False(t, pool.HadEntries("bad"))
}

func TestPool_LocationEdgeCasesAndLowercaseHeader(t *testing.T) {
	for _, loc := range []string{
		"/api/orders/..",
		"/api/orders/.",
		"/api/orders/%2e%2e",
		"/api/orders",
	} {
		pool := NewPool()
		hdr := http.Header{}
		hdr.Set("Location", loc)
		pool.HarvestResponse([]ProducerRule{{PoolKey: "res:orders:id", ResponseExpr: ""}}, hdr, nil)
		assert.Equal(t, 0, pool.LiveCount("res:orders:id"), "expected Location %q not to seed res:orders:id", loc)
	}

	poolNested := NewPool()
	hdrNested := http.Header{}
	hdrNested.Set("Location", "/api/orgs/org-1/projects")
	poolNested.HarvestResponse([]ProducerRule{{PoolKey: "res:orgs/projects:id", ResponseExpr: ""}}, hdrNested, nil)
	assert.Equal(t, 0, poolNested.LiveCount("res:orgs/projects:id"))

	poolLower := NewPool()
	hdrLower := http.Header{}
	hdrLower.Set("Location", "/api/v2/invoices/88")
	poolLower.HarvestResponse([]ProducerRule{{PoolKey: "link:loc", ResponseExpr: "$header.location"}}, hdrLower, nil)
	numVal, _, ok := poolLower.GetCoerced("link:loc", &swagger.SchemaProperty{Type: "integer"})
	require.True(t, ok)
	assert.Equal(t, int64(88), numVal)
}

func TestPool_ParentTuplesAndCoerceString(t *testing.T) {
	pool := NewPool()
	pool.Put("res:orgs:id", "org-1", "org-1")
	pool.Put("res:orgs:id", "org-2", "org-2")

	pool.HarvestResponseWithParents(
		[]ProducerRule{{PoolKey: "res:orgs/projects:id", ResponseExpr: ""}},
		nil,
		[]byte(`{"id": "101"}`),
		map[string]string{"res:orgs:id": "org-1"},
	)

	val, str, parents, ok := pool.GetEntryCoerced("res:orgs/projects:id", &swagger.SchemaProperty{Type: "integer"})
	require.True(t, ok)
	assert.Equal(t, int64(101), val)
	assert.Equal(t, "101", str)
	assert.Equal(t, map[string]string{"res:orgs:id": "org-1"}, parents)

	assert.Equal(t, int64(42), CoerceString("42", &swagger.SchemaProperty{Type: "integer"}))
	assert.Equal(t, "42", CoerceString("42", &swagger.SchemaProperty{Type: "string"}))
}
