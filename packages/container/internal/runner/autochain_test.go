// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/swagger"
)

func TestRunner_AutoChainingCRUDAndSacrificialDelete(t *testing.T) {
	var (
		mu             sync.Mutex
		nextID         int64 = 100
		orders               = make(map[string]bool)
		pathFuzzedSeen atomic.Bool
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/orders" && r.Method == http.MethodPost {
			id := fmt.Sprintf("%d", atomic.AddInt64(&nextID, 1))
			mu.Lock()
			orders[id] = true
			mu.Unlock()
			w.Header().Set("Location", "/api/orders/"+id)
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
			return
		}

		if strings.HasPrefix(r.URL.Path, "/api/orders/") {
			id := strings.TrimPrefix(r.URL.Path, "/api/orders/")
			mu.Lock()
			exists := orders[id]
			if r.Method == http.MethodDelete && exists {
				delete(orders, id)
			}
			mu.Unlock()

			if !exists {
				// Record when split-budget unpinned iteration fuzzes {orderId} directly
				if len(id) > 0 && (strings.Contains(id, "'") || strings.Contains(id, "..") || len(id) > 8) {
					pathFuzzedSeen.Store(true)
				}
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"error":"order not found"}`))
				return
			}

			if r.Method == http.MethodPatch {
				var body map[string]any
				_ = json.NewDecoder(r.Body).Decode(&body)
				if note, _ := body["note"].(string); strings.Contains(note, "'") {
					w.WriteHeader(http.StatusInternalServerError)
					_, _ = w.Write([]byte(`{"error":"SQL syntax error near MySQL server version"}`))
					return
				}
			}

			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "ok": true})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	// Intentionally pass endpoints in WORST reverse order: DELETE first, PATCH second, POST last!
	cfg := &swagger.Config{
		BaseURL:  srv.URL,
		Security: swagger.SecurityConfig{AllowPrivateIPs: true},
		Settings: swagger.Settings{
			IterationsPerProfile: 10,
			Concurrency:          2,
			TimeoutMs:            5000,
			AnalyzeResponseBody:  true,
			Profiles:             []swagger.FuzzingProfile{swagger.ProfileRandom, swagger.ProfileMalicious, swagger.ProfileBoundary},
		},
		Endpoints: []swagger.EndpointConfig{
			{
				Path:       "/api/orders/{orderId}",
				Method:     "DELETE",
				PathParams: map[string]*swagger.SchemaProperty{"orderId": {Type: "string"}},
			},
			{
				Path:       "/api/orders/{orderId}",
				Method:     "PATCH",
				PathParams: map[string]*swagger.SchemaProperty{"orderId": {Type: "string"}},
				Schema: swagger.SchemaProperty{
					Type:       "object",
					Properties: map[string]*swagger.SchemaProperty{"note": {Type: "string"}},
				},
			},
			{
				Path:   "/api/orders",
				Method: "POST",
				Schema: swagger.SchemaProperty{
					Type:       "object",
					Properties: map[string]*swagger.SchemaProperty{"item": {Type: "string"}},
				},
				ResponseSchema: &swagger.SchemaProperty{
					Type:       "object",
					Properties: map[string]*swagger.SchemaProperty{"id": {Type: "string"}},
				},
			},
		},
	}

	r := New(cfg, nil)
	defer r.Close()
	sub := r.Subscribe()
	var sqliFound atomic.Bool
	var boundaryPatch200 atomic.Bool
	doneCollect := make(chan struct{})
	go func() {
		defer close(doneCollect)
		for evt := range sub {
			if evt.Type != EventResult {
				continue
			}
			res, ok := evt.Data.(*swagger.FuzzResult)
			if !ok || res == nil {
				continue
			}
			for _, f := range res.AnalyzerFindings {
				if f.RuleID == "swazz/sql-error-leak" {
					sqliFound.Store(true)
				}
			}
			if res.Profile == swagger.ProfileBoundary && res.Method == "PATCH" && res.Status == http.StatusOK {
				boundaryPatch200.Store(true)
			}
		}
	}()

	require.NoError(t, r.Start(context.Background()))
	r.Close()
	<-doneCollect

	assert.True(t, sqliFound.Load(), "expected MALICIOUS PATCH /api/orders/{orderId} to pass 404 gate via auto-chaining and trigger SQLi finding")
	assert.True(t, boundaryPatch200.Load(), "expected BOUNDARY PATCH to still have a live orderId despite RANDOM running DELETE earlier")
	assert.True(t, pathFuzzedSeen.Load(), "expected ~20%% unpinned iterations to still fuzz {orderId} directly")
}

func TestRunner_AutoChainingStrikeEvictionAndReseedRecovery(t *testing.T) {
	var (
		mu             sync.Mutex
		nextTicketID   int64
		tickets        = make(map[string]bool)
		t1Misses       int
		reseededHit200 atomic.Bool
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/tickets" && r.Method == http.MethodPost {
			id := fmt.Sprintf("ticket-%d", atomic.AddInt64(&nextTicketID, 1))
			mu.Lock()
			tickets[id] = true
			mu.Unlock()
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
			return
		}

		if strings.HasPrefix(r.URL.Path, "/api/tickets/") && r.Method == http.MethodGet {
			id := strings.TrimPrefix(r.URL.Path, "/api/tickets/")
			mu.Lock()
			exists := tickets[id]
			if id == "ticket-1" && exists {
				// First GET (baseline) succeeds, then ticket-1 expires server-side so subsequent
				// pinned requests hit 404 and trigger strike eviction + producer re-seed.
				delete(tickets, id)
			} else if id == "ticket-1" && !exists {
				t1Misses++
			}
			mu.Unlock()

			if !exists {
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"error":"expired"}`))
				return
			}
			if id != "ticket-1" && strings.HasPrefix(id, "ticket-") {
				reseededHit200.Store(true)
			}
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "status": "open"})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	cfg := &swagger.Config{
		BaseURL:  srv.URL,
		Security: swagger.SecurityConfig{AllowPrivateIPs: true},
		Settings: swagger.Settings{
			IterationsPerProfile: 8,
			Concurrency:          1,
			TimeoutMs:            5000,
			// Only MALICIOUS runs after BASELINE, so MALICIOUS POST responses are NOT harvested;
			// only an explicit BASELINE re-seed after 404 strike eviction can mint a fresh live ID.
			Profiles: []swagger.FuzzingProfile{swagger.ProfileMalicious},
		},
		Endpoints: []swagger.EndpointConfig{
			{
				Path:        "/api/tickets/{ticketId}",
				Method:      "GET",
				PathParams:  map[string]*swagger.SchemaProperty{"ticketId": {Type: "string"}},
				QueryParams: map[string]*swagger.SchemaProperty{"filter": {Type: "string"}},
			},
			{
				Path:   "/api/tickets",
				Method: "POST",
				Schema: swagger.SchemaProperty{
					Type:       "object",
					Properties: map[string]*swagger.SchemaProperty{"subject": {Type: "string"}},
				},
				ResponseSchema: &swagger.SchemaProperty{
					Type:       "object",
					Properties: map[string]*swagger.SchemaProperty{"id": {Type: "string"}},
				},
			},
		},
	}

	r := New(cfg, nil)
	defer r.Close()
	require.NoError(t, r.Start(context.Background()))

	mu.Lock()
	misses := t1Misses
	mu.Unlock()

	assert.GreaterOrEqual(t, misses, 2, "expected ticket-1 to accumulate 2 consecutive 404 misses before eviction")
	assert.True(t, reseededHit200.Load(), "expected evicted pool to re-seed POST /api/tickets and recover 200 OK on GET /api/tickets/{ticketId}")
}

func TestRunner_AutoChainingCheckpointResumeSeedsProducers(t *testing.T) {
	var (
		mu              sync.Mutex
		nextProj        int64
		nextTask        int64
		projects        = make(map[string]bool)
		projectTasks    = make(map[string]string) // taskID -> projID
		resumedPatch200 atomic.Bool
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/projects" && r.Method == http.MethodPost {
			pID := fmt.Sprintf("proj-%d", atomic.AddInt64(&nextProj, 1))
			mu.Lock()
			projects[pID] = true
			mu.Unlock()
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": pID})
			return
		}

		segs := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		// /api/projects/{projectId}/tasks
		if len(segs) == 4 && segs[0] == "api" && segs[1] == "projects" && segs[3] == "tasks" && r.Method == http.MethodPost {
			pID := segs[2]
			mu.Lock()
			okProj := projects[pID]
			mu.Unlock()
			if !okProj {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			tID := fmt.Sprintf("task-%d", atomic.AddInt64(&nextTask, 1))
			mu.Lock()
			projectTasks[tID] = pID
			mu.Unlock()
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": tID})
			return
		}

		// /api/projects/{projectId}/tasks/{taskId}
		if len(segs) == 5 && segs[0] == "api" && segs[1] == "projects" && segs[3] == "tasks" && r.Method == http.MethodPatch {
			pID, tID := segs[2], segs[4]
			mu.Lock()
			ownerProj, exists := projectTasks[tID]
			mu.Unlock()
			if exists && ownerProj == pID {
				resumedPatch200.Store(true)
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(map[string]any{"id": tID, "projectId": pID})
				return
			}
			w.WriteHeader(http.StatusNotFound)
			return
		}

		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	cfg := &swagger.Config{
		BaseURL:  srv.URL,
		Security: swagger.SecurityConfig{AllowPrivateIPs: true},
		Settings: swagger.Settings{
			IterationsPerProfile: 6,
			Concurrency:          1,
			TimeoutMs:            5000,
			Profiles:             []swagger.FuzzingProfile{swagger.ProfileRandom, swagger.ProfileMalicious},
			Checkpoint: &swagger.Checkpoint{
				Profile:   string(swagger.ProfileMalicious),
				Endpoint:  "PATCH /api/projects/{projectId}/tasks/{taskId}",
				Iteration: 2,
			},
		},
		Endpoints: []swagger.EndpointConfig{
			{
				Path:   "/api/projects/{projectId}/tasks/{taskId}",
				Method: "PATCH",
				PathParams: map[string]*swagger.SchemaProperty{
					"projectId": {Type: "string"},
					"taskId":    {Type: "string"},
				},
				Schema: swagger.SchemaProperty{
					Type:       "object",
					Properties: map[string]*swagger.SchemaProperty{"title": {Type: "string"}},
				},
			},
			{
				Path:       "/api/projects/{projectId}/tasks",
				Method:     "POST",
				PathParams: map[string]*swagger.SchemaProperty{"projectId": {Type: "string"}},
				Schema: swagger.SchemaProperty{
					Type:       "object",
					Properties: map[string]*swagger.SchemaProperty{"title": {Type: "string"}},
				},
				ResponseSchema: &swagger.SchemaProperty{
					Type:       "object",
					Properties: map[string]*swagger.SchemaProperty{"id": {Type: "string"}},
				},
			},
			{
				Path:   "/api/projects",
				Method: "POST",
				Schema: swagger.SchemaProperty{
					Type:       "object",
					Properties: map[string]*swagger.SchemaProperty{"name": {Type: "string"}},
				},
				ResponseSchema: &swagger.SchemaProperty{
					Type:       "object",
					Properties: map[string]*swagger.SchemaProperty{"id": {Type: "string"}},
				},
			},
		},
	}

	r := New(cfg, nil)
	defer r.Close()
	require.NoError(t, r.Start(context.Background()))

	assert.True(t, resumedPatch200.Load(), "expected checkpoint resume to warm up ancestor producers in topological order before resuming consumer PATCH")
}

func TestRunner_AutoChainingDisabled(t *testing.T) {
	var (
		mu             sync.Mutex
		methodSeq      []string
		pooledIDUsed   atomic.Bool
		disableChain   = false
		mintedServerID = "minted-item-999"
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		mu.Lock()
		methodSeq = append(methodSeq, r.Method)
		mu.Unlock()

		if r.URL.Path == "/api/items" && r.Method == http.MethodPost {
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": mintedServerID})
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/items/") {
			id := strings.TrimPrefix(r.URL.Path, "/api/items/")
			if id == mintedServerID {
				pooledIDUsed.Store(true)
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	cfg := &swagger.Config{
		BaseURL:  srv.URL,
		Security: swagger.SecurityConfig{AllowPrivateIPs: true},
		Settings: swagger.Settings{
			IterationsPerProfile: 4,
			Concurrency:          1,
			TimeoutMs:            5000,
			Profiles:             []swagger.FuzzingProfile{swagger.ProfileRandom},
			EnableAutoChaining:   &disableChain,
		},
		Endpoints: []swagger.EndpointConfig{
			{
				Path:       "/api/items/{itemId}",
				Method:     "DELETE",
				PathParams: map[string]*swagger.SchemaProperty{"itemId": {Type: "string"}},
			},
			{
				Path:   "/api/items",
				Method: "POST",
				Schema: swagger.SchemaProperty{
					Type:       "object",
					Properties: map[string]*swagger.SchemaProperty{"name": {Type: "string"}},
				},
				ResponseSchema: &swagger.SchemaProperty{
					Type:       "object",
					Properties: map[string]*swagger.SchemaProperty{"id": {Type: "string"}},
				},
			},
			{
				Path:       "/api/items/{itemId}",
				Method:     "GET",
				PathParams: map[string]*swagger.SchemaProperty{"itemId": {Type: "string"}},
			},
		},
	}

	r := New(cfg, nil)
	defer r.Close()
	require.NoError(t, r.Start(context.Background()))

	mu.Lock()
	defer mu.Unlock()
	require.GreaterOrEqual(t, len(methodSeq), 3)
	assert.Equal(t, []string{"DELETE", "POST", "GET"}, methodSeq[:3], "expected original endpoint order (DELETE first) when EnableAutoChaining=false")
	assert.False(t, pooledIDUsed.Load(), "expected no harvested ID injection when EnableAutoChaining=false")
}

func TestRunner_AutoChainingReseedPreservesIterationWatermark(t *testing.T) {
	t.Run("EndToEndStrikeEvictionWatermark", func(t *testing.T) {
		var (
			mu           sync.Mutex
			nextTicketID int64
			tickets      = make(map[string]bool)
		)

		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			if r.URL.Path == "/api/tickets" && r.Method == http.MethodPost {
				id := fmt.Sprintf("ticket-%d", atomic.AddInt64(&nextTicketID, 1))
				mu.Lock()
				tickets[id] = true
				mu.Unlock()
				w.WriteHeader(http.StatusCreated)
				_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
				return
			}
			if strings.HasPrefix(r.URL.Path, "/api/tickets/") && r.Method == http.MethodGet {
				id := strings.TrimPrefix(r.URL.Path, "/api/tickets/")
				mu.Lock()
				exists := tickets[id]
				if id == "ticket-1" && exists {
					delete(tickets, id)
				}
				mu.Unlock()
				if !exists {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
				return
			}
			w.WriteHeader(http.StatusNotFound)
		}))
		defer srv.Close()

		cfg := &swagger.Config{
			BaseURL:  srv.URL,
			Security: swagger.SecurityConfig{AllowPrivateIPs: true},
			Settings: swagger.Settings{
				IterationsPerProfile: 8,
				Concurrency:          1,
				TimeoutMs:            5000,
				Profiles:             []swagger.FuzzingProfile{swagger.ProfileMalicious},
			},
			Endpoints: []swagger.EndpointConfig{
				{
					Path:        "/api/tickets/{ticketId}",
					Method:      "GET",
					PathParams:  map[string]*swagger.SchemaProperty{"ticketId": {Type: "string"}},
					QueryParams: map[string]*swagger.SchemaProperty{"filter": {Type: "string"}},
				},
				{
					Path:   "/api/tickets",
					Method: "POST",
					Schema: swagger.SchemaProperty{
						Type:       "object",
						Properties: map[string]*swagger.SchemaProperty{"subject": {Type: "string"}},
					},
					ResponseSchema: &swagger.SchemaProperty{
						Type:       "object",
						Properties: map[string]*swagger.SchemaProperty{"id": {Type: "string"}},
					},
				},
			},
		}

		r := New(cfg, nil)
		defer r.Close()
		sub := r.Subscribe()
		var maxSeenIter int
		var resetObserved atomic.Bool
		doneCollect := make(chan struct{})
		go func() {
			defer close(doneCollect)
			for evt := range sub {
				if evt.Type != EventProgress {
					continue
				}
				snap, ok := evt.Data.(swagger.RunStats)
				if !ok {
					continue
				}
				if snap.Progress.CurrentProfile == string(swagger.ProfileMalicious) &&
					snap.Progress.CurrentEndpoint == "GET /api/tickets/{ticketId}" {
					if snap.Progress.CurrentIteration > maxSeenIter {
						maxSeenIter = snap.Progress.CurrentIteration
					}
					if maxSeenIter > 0 && snap.Progress.CurrentIteration < maxSeenIter {
						resetObserved.Store(true)
					}
				}
			}
		}()

		require.NoError(t, r.Start(context.Background()))
		stats := r.GetStats()
		r.Close()
		<-doneCollect

		expectedTotal := calcEffectiveIterations(swagger.ProfileMalicious, cfg.Settings, &cfg.Endpoints[0])
		assert.False(t, resetObserved.Load(), "expected mintFromProducer re-seed not to reset Progress.CurrentIteration mid-endpoint")
		assert.Equal(t, expectedTotal, stats.Progress.CurrentIteration, "expected final watermark to reach all iterations after mid-endpoint re-seed")
		assert.Equal(t, expectedTotal, stats.Progress.TotalIterations)
	})

	t.Run("StatsAggregatorCheckpointPreserved", func(t *testing.T) {
		cfg := &swagger.Config{
			BaseURL:  "http://127.0.0.1:1",
			Security: swagger.SecurityConfig{AllowPrivateIPs: true},
		}
		r := New(cfg, nil)
		defer r.Close()

		sub := r.Subscribe()
		checkpointCh := make(chan CheckpointData, 4)
		doneSub := make(chan struct{})
		go func() {
			defer close(doneSub)
			for evt := range sub {
				if evt.Type == EventCheckpoint {
					if cp, ok := evt.Data.(CheckpointData); ok {
						checkpointCh <- cp
					}
				}
			}
		}()

		p := newStatsPipe()
		r.stats.Store(p)
		r.progress.currentProfile.Store(string(swagger.ProfileMalicious))
		r.progress.currentEndpoint.Store("GET /api/tickets/{ticketId}")
		go r.statsAggregator(p)

		for i := 1; i <= 105; i++ {
			if i == 50 || i == 102 {
				// Re-seed producer calls send zero currentIteration/endpoint/profile.
				p.send(statsMsg{
					result: &swagger.FuzzResult{
						Endpoint: "/api/tickets",
						Method:   "POST",
						Profile:  swagger.FuzzingProfile("BASELINE"),
						Status:   http.StatusCreated,
					},
				}, nil)
			}
			p.send(statsMsg{
				result: &swagger.FuzzResult{
					Endpoint: "/api/tickets/{ticketId}",
					Method:   "GET",
					Profile:  swagger.ProfileMalicious,
					Status:   http.StatusOK,
				},
				currentIteration: i,
				totalIterations:  105,
				endpoint:         "GET /api/tickets/{ticketId}",
				profile:          string(swagger.ProfileMalicious),
			}, nil)
		}

		var cp CheckpointData
		select {
		case cp = <-checkpointCh:
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for EventCheckpoint")
		}

		p.close()
		stats := r.GetStats()
		r.Close()
		<-doneSub

		assert.GreaterOrEqual(t, cp.Iteration, 100, "expected CheckpointData.Iteration not to reset to 0 after zero-iteration re-seed statsMsg")
		assert.Equal(t, 105, stats.Progress.CurrentIteration)
	})
}

func TestRunner_AutoChainingActiveFuzzingDeleteAndEvictionRecovery(t *testing.T) {
	t.Run("DeleteDoesNotWasteSacrificialIDs", func(t *testing.T) {
		var (
			mu                sync.Mutex
			nextID            int64 = 100
			orders                  = make(map[string]bool)
			mintCount         atomic.Int64
			fuzzedDeleteSeen  atomic.Bool
			sqliFound         atomic.Bool
			boundaryPatch200  atomic.Bool
			liveOrdersDeleted atomic.Int64
		)

		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			if r.URL.Path == "/api/orders" && r.Method == http.MethodPost {
				mintCount.Add(1)
				id := fmt.Sprintf("ord-%d", atomic.AddInt64(&nextID, 1))
				mu.Lock()
				orders[id] = true
				mu.Unlock()
				w.WriteHeader(http.StatusCreated)
				_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
				return
			}

			if strings.HasPrefix(r.URL.Path, "/api/orders/") {
				id := strings.TrimPrefix(r.URL.Path, "/api/orders/")
				mu.Lock()
				exists := orders[id]
				if r.Method == http.MethodDelete && exists {
					delete(orders, id)
					liveOrdersDeleted.Add(1)
				}
				mu.Unlock()

				if !exists {
					if r.Method == http.MethodDelete && !strings.HasPrefix(id, "ord-") {
						fuzzedDeleteSeen.Store(true)
					}
					w.WriteHeader(http.StatusNotFound)
					_, _ = w.Write([]byte(`{"error":"order not found"}`))
					return
				}

				if r.Method == http.MethodPatch {
					var body map[string]any
					_ = json.NewDecoder(r.Body).Decode(&body)
					if note, _ := body["note"].(string); strings.Contains(note, "'") {
						w.WriteHeader(http.StatusInternalServerError)
						_, _ = w.Write([]byte(`{"error":"SQL syntax error near MySQL server version"}`))
						return
					}
				}

				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "ok": true})
				return
			}
			w.WriteHeader(http.StatusNotFound)
		}))
		defer srv.Close()

		cfg := &swagger.Config{
			BaseURL:  srv.URL,
			Security: swagger.SecurityConfig{AllowPrivateIPs: true},
			Settings: swagger.Settings{
				IterationsPerProfile:   6,
				Concurrency:            1,
				TimeoutMs:              5000,
				AnalyzeResponseBody:    true,
				ActiveParameterFuzzing: true,
				Profiles:               []swagger.FuzzingProfile{swagger.ProfileRandom, swagger.ProfileMalicious, swagger.ProfileBoundary},
			},
			Endpoints: []swagger.EndpointConfig{
				{
					Path:        "/api/orders/{orderId}",
					Method:      "DELETE",
					PathParams:  map[string]*swagger.SchemaProperty{"orderId": {Type: "string"}},
					QueryParams: map[string]*swagger.SchemaProperty{"reason": {Type: "string"}},
				},
				{
					Path:       "/api/orders/{orderId}",
					Method:     "PATCH",
					PathParams: map[string]*swagger.SchemaProperty{"orderId": {Type: "string"}},
					Schema: swagger.SchemaProperty{
						Type:       "object",
						Properties: map[string]*swagger.SchemaProperty{"note": {Type: "string"}},
					},
				},
				{
					Path:   "/api/orders",
					Method: "POST",
					Schema: swagger.SchemaProperty{
						Type:       "object",
						Properties: map[string]*swagger.SchemaProperty{"item": {Type: "string"}},
					},
					ResponseSchema: &swagger.SchemaProperty{
						Type:       "object",
						Properties: map[string]*swagger.SchemaProperty{"id": {Type: "string"}},
					},
				},
			},
		}

		r := New(cfg, nil)
		defer r.Close()
		sub := r.Subscribe()
		doneCollect := make(chan struct{})
		go func() {
			defer close(doneCollect)
			for evt := range sub {
				if evt.Type != EventResult {
					continue
				}
				res, ok := evt.Data.(*swagger.FuzzResult)
				if !ok || res == nil {
					continue
				}
				for _, f := range res.AnalyzerFindings {
					if f.RuleID == "swazz/sql-error-leak" {
						sqliFound.Store(true)
					}
				}
				if res.Profile == swagger.ProfileBoundary && res.Method == "PATCH" && res.Status == http.StatusOK {
					boundaryPatch200.Store(true)
				}
			}
		}()

		require.NoError(t, r.Start(context.Background()))
		r.Close()
		<-doneCollect

		mu.Lock()
		remainingLive := len(orders)
		mu.Unlock()

		assert.True(t, fuzzedDeleteSeen.Load(), "expected DELETE active mutations on {orderId} to send fuzzed orderIds without overwriting with pooled IDs")
		assert.GreaterOrEqual(t, remainingLive, 1, "expected at least one live order to survive active DELETE fuzzing")
		assert.True(t, sqliFound.Load(), "expected MALICIOUS PATCH /api/orders/{orderId} to pass 404 gate and detect SQLi under ActiveParameterFuzzing")
		assert.True(t, boundaryPatch200.Load(), "expected BOUNDARY PATCH to still have a live orderId under ActiveParameterFuzzing")
		_ = liveOrdersDeleted.Load()
		_ = mintCount.Load()
	})

	t.Run("DeleteOrderIdMutationNeverBurnsSacrificialPool", func(t *testing.T) {
		var (
			mu                sync.Mutex
			nextID            int64 = 100
			orders                  = make(map[string]bool)
			fuzzedDeleteSeen  atomic.Bool
			liveOrdersDeleted atomic.Int64
		)

		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			if r.URL.Path == "/api/orders" && r.Method == http.MethodPost {
				id := fmt.Sprintf("ord-%d", atomic.AddInt64(&nextID, 1))
				mu.Lock()
				orders[id] = true
				mu.Unlock()
				w.WriteHeader(http.StatusCreated)
				_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
				return
			}
			if strings.HasPrefix(r.URL.Path, "/api/orders/") && r.Method == http.MethodDelete {
				id := strings.TrimPrefix(r.URL.Path, "/api/orders/")
				mu.Lock()
				exists := orders[id]
				if exists {
					delete(orders, id)
					liveOrdersDeleted.Add(1)
				}
				mu.Unlock()
				if !exists {
					if !strings.HasPrefix(id, "ord-") {
						fuzzedDeleteSeen.Store(true)
					}
					w.WriteHeader(http.StatusNotFound)
					return
				}
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
				return
			}
			w.WriteHeader(http.StatusNotFound)
		}))
		defer srv.Close()

		cfg := &swagger.Config{
			BaseURL:  srv.URL,
			Security: swagger.SecurityConfig{AllowPrivateIPs: true},
			Settings: swagger.Settings{
				IterationsPerProfile:   6,
				Concurrency:            1,
				TimeoutMs:              5000,
				ActiveParameterFuzzing: true,
				Profiles:               []swagger.FuzzingProfile{swagger.ProfileRandom, swagger.ProfileBoundary},
			},
			Endpoints: []swagger.EndpointConfig{
				{
					Path:       "/api/orders/{orderId}",
					Method:     "DELETE",
					PathParams: map[string]*swagger.SchemaProperty{"orderId": {Type: "string"}},
				},
				{
					Path:   "/api/orders",
					Method: "POST",
					Schema: swagger.SchemaProperty{
						Type:       "object",
						Properties: map[string]*swagger.SchemaProperty{"item": {Type: "string"}},
					},
					ResponseSchema: &swagger.SchemaProperty{
						Type:       "object",
						Properties: map[string]*swagger.SchemaProperty{"id": {Type: "string"}},
					},
				},
			},
		}

		r := New(cfg, nil)
		defer r.Close()
		require.NoError(t, r.Start(context.Background()))

		assert.True(t, fuzzedDeleteSeen.Load(), "expected DELETE active mutations on {orderId} to send fuzzed IDs")
		assert.Equal(t, int64(1), liveOrdersDeleted.Load(), "expected only BASELINE sacrificial DELETE to consume a live order; {orderId} mutations must not burn sacrificial IDs")
	})

	t.Run("EvictionRecovery", func(t *testing.T) {
		var (
			mu             sync.Mutex
			nextTicketID   int64
			tickets        = make(map[string]bool)
			t1Misses       int
			reseededHit200 atomic.Bool
		)

		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			if r.URL.Path == "/api/tickets" && r.Method == http.MethodPost {
				id := fmt.Sprintf("ticket-%d", atomic.AddInt64(&nextTicketID, 1))
				mu.Lock()
				tickets[id] = true
				mu.Unlock()
				w.WriteHeader(http.StatusCreated)
				_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
				return
			}
			if strings.HasPrefix(r.URL.Path, "/api/tickets/") && r.Method == http.MethodPatch {
				id := strings.TrimPrefix(r.URL.Path, "/api/tickets/")
				mu.Lock()
				exists := tickets[id]
				if id == "ticket-1" && exists {
					delete(tickets, id)
				} else if id == "ticket-1" && !exists {
					t1Misses++
				}
				mu.Unlock()
				if !exists {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				if id != "ticket-1" && strings.HasPrefix(id, "ticket-") {
					reseededHit200.Store(true)
				}
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
				return
			}
			w.WriteHeader(http.StatusNotFound)
		}))
		defer srv.Close()

		cfg := &swagger.Config{
			BaseURL:  srv.URL,
			Security: swagger.SecurityConfig{AllowPrivateIPs: true},
			Settings: swagger.Settings{
				IterationsPerProfile:   6,
				Concurrency:            1,
				TimeoutMs:              5000,
				ActiveParameterFuzzing: true,
				Profiles:               []swagger.FuzzingProfile{swagger.ProfileMalicious},
			},
			Endpoints: []swagger.EndpointConfig{
				{
					Path:       "/api/tickets/{ticketId}",
					Method:     "PATCH",
					PathParams: map[string]*swagger.SchemaProperty{"ticketId": {Type: "string"}},
					Schema: swagger.SchemaProperty{
						Type:       "object",
						Properties: map[string]*swagger.SchemaProperty{"note": {Type: "string"}},
					},
				},
				{
					Path:   "/api/tickets",
					Method: "POST",
					Schema: swagger.SchemaProperty{
						Type:       "object",
						Properties: map[string]*swagger.SchemaProperty{"subject": {Type: "string"}},
					},
					ResponseSchema: &swagger.SchemaProperty{
						Type:       "object",
						Properties: map[string]*swagger.SchemaProperty{"id": {Type: "string"}},
					},
				},
			},
		}

		r := New(cfg, nil)
		defer r.Close()
		require.NoError(t, r.Start(context.Background()))

		mu.Lock()
		misses := t1Misses
		mu.Unlock()
		assert.GreaterOrEqual(t, misses, 2, "expected ticket-1 to accumulate 2 misses before eviction under ActiveParameterFuzzing")
		assert.True(t, reseededHit200.Load(), "expected evicted pool to re-seed and recover 200 OK on PATCH /api/tickets/{ticketId} under ActiveParameterFuzzing")
	})
}

func TestRunner_AutoChainingCheckpointResumeSeedsOtherEndpointsForSubsequentProfiles(t *testing.T) {
	var (
		mu                 sync.Mutex
		nextUser           int64
		nextOrder          int64
		users              = make(map[string]bool)
		orders             = make(map[string]bool)
		maliciousUser200   atomic.Bool
		maliciousOrder200  atomic.Bool
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/api/users" && r.Method == http.MethodPost:
			id := fmt.Sprintf("user-%d", atomic.AddInt64(&nextUser, 1))
			mu.Lock()
			users[id] = true
			mu.Unlock()
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
			return
		case r.URL.Path == "/api/orders" && r.Method == http.MethodPost:
			id := fmt.Sprintf("order-%d", atomic.AddInt64(&nextOrder, 1))
			mu.Lock()
			orders[id] = true
			mu.Unlock()
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
			return
		case strings.HasPrefix(r.URL.Path, "/api/users/") && r.Method == http.MethodGet:
			id := strings.TrimPrefix(r.URL.Path, "/api/users/")
			mu.Lock()
			ok := users[id]
			mu.Unlock()
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
			return
		case strings.HasPrefix(r.URL.Path, "/api/orders/") && r.Method == http.MethodGet:
			id := strings.TrimPrefix(r.URL.Path, "/api/orders/")
			mu.Lock()
			ok := orders[id]
			mu.Unlock()
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": id})
			return
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	cfg := &swagger.Config{
		BaseURL:  srv.URL,
		Security: swagger.SecurityConfig{AllowPrivateIPs: true},
		Settings: swagger.Settings{
			IterationsPerProfile: 4,
			Concurrency:          1,
			TimeoutMs:            5000,
			Profiles:             []swagger.FuzzingProfile{swagger.ProfileRandom, swagger.ProfileMalicious},
			// Resume at the last endpoint in RANDOM; GET /api/users/{userId} is skipped in RANDOM
			// and will run in MALICIOUS (which does not harvest POST /api/users).
			Checkpoint: &swagger.Checkpoint{
				Profile:   string(swagger.ProfileRandom),
				Endpoint:  "GET /api/orders/{orderId}",
				Iteration: 1,
			},
		},
		Endpoints: []swagger.EndpointConfig{
			{
				Path:        "/api/users/{userId}",
				Method:      "GET",
				PathParams:  map[string]*swagger.SchemaProperty{"userId": {Type: "string"}},
				QueryParams: map[string]*swagger.SchemaProperty{"q": {Type: "string"}},
			},
			{
				Path:        "/api/orders/{orderId}",
				Method:      "GET",
				PathParams:  map[string]*swagger.SchemaProperty{"orderId": {Type: "string"}},
				QueryParams: map[string]*swagger.SchemaProperty{"q": {Type: "string"}},
			},
			{
				Path:   "/api/users",
				Method: "POST",
				Schema: swagger.SchemaProperty{
					Type:       "object",
					Properties: map[string]*swagger.SchemaProperty{"name": {Type: "string"}},
				},
				ResponseSchema: &swagger.SchemaProperty{
					Type:       "object",
					Properties: map[string]*swagger.SchemaProperty{"id": {Type: "string"}},
				},
			},
			{
				Path:   "/api/orders",
				Method: "POST",
				Schema: swagger.SchemaProperty{
					Type:       "object",
					Properties: map[string]*swagger.SchemaProperty{"item": {Type: "string"}},
				},
				ResponseSchema: &swagger.SchemaProperty{
					Type:       "object",
					Properties: map[string]*swagger.SchemaProperty{"id": {Type: "string"}},
				},
			},
		},
	}

	r := New(cfg, nil)
	defer r.Close()
	sub := r.Subscribe()
	doneCollect := make(chan struct{})
	go func() {
		defer close(doneCollect)
		for evt := range sub {
			if evt.Type != EventResult {
				continue
			}
			res, ok := evt.Data.(*swagger.FuzzResult)
			if !ok || res == nil {
				continue
			}
			if res.Profile == swagger.ProfileMalicious && res.Status == http.StatusOK {
				switch res.Endpoint {
				case "/api/users/{userId}":
					maliciousUser200.Store(true)
				case "/api/orders/{orderId}":
					maliciousOrder200.Store(true)
				}
			}
		}
	}()

	require.NoError(t, r.Start(context.Background()))
	r.Close()
	<-doneCollect

	assert.True(t, maliciousUser200.Load(), "expected checkpoint resume in RANDOM to seed POST /api/users needed by GET /api/users/{userId} in subsequent MALICIOUS profile")
	assert.True(t, maliciousOrder200.Load(), "expected checkpoint resume in RANDOM to seed POST /api/orders needed by GET /api/orders/{orderId}")
}
