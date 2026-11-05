// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package generator

import (
	"fmt"
	"regexp"
	"sort"
	"testing"

	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/oob"
	"swazz-engine/internal/swagger"
)

var tokenRe = regexp.MustCompile(`[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}`)

func oobOnlyGenerator(store *oob.Store) *Generator {
	g := New(nil, swagger.ProfileMalicious, swagger.Settings{
		PayloadCategories: map[swagger.FuzzingProfile][]string{
			swagger.ProfileMalicious: {payloads.CatOOBInteraction},
		},
	})
	g.RunID = "run-1"
	g.Endpoint = "POST /hook"
	g.OOBStore = store
	return g
}

// tokensIn returns the UUIDs in the text form of v, sorted.
func tokensIn(v any) []string {
	got := tokenRe.FindAllString(fmt.Sprint(v), -1)
	sort.Strings(got)
	return got
}

func sorted(s []string) []string {
	out := append([]string(nil), s...)
	sort.Strings(out)
	return out
}

// TakeOOBTokens reports exactly the tokens in the values generated since the last take, each one
// registered in the run's store, and forgets them.
func TestTakeOOBTokens_Body(t *testing.T) {
	store := oob.NewStore()
	g := oobOnlyGenerator(store)
	schema := &swagger.SchemaProperty{Type: "object", Properties: map[string]*swagger.SchemaProperty{
		"url":    {Type: "string"},
		"nested": {Type: "object", Properties: map[string]*swagger.SchemaProperty{"cb": {Type: "string"}}},
		"list":   {Type: "array", Items: &swagger.SchemaProperty{Type: "string"}},
	}}

	seen := 0
	for i := range 32 {
		// BuildObject can leave fields out, so a request may carry no token: then none is taken.
		obj := g.BuildObject(schema)
		want := tokensIn(obj)
		seen += len(want)
		got := g.TakeOOBTokens()
		if fmt.Sprint(sorted(got)) != fmt.Sprint(want) {
			t.Fatalf("request %d: took %v, values carry %v", i, sorted(got), want)
		}
		for _, tok := range got {
			if _, ok := store.GetAndRemoveUUID(tok); !ok {
				t.Fatalf("token %s not registered", tok)
			}
		}
		if again := g.TakeOOBTokens(); len(again) != 0 {
			t.Fatalf("tokens not forgotten after a take: %v", again)
		}
	}
	if seen == 0 {
		t.Fatal("no request carried an OOB token")
	}
}

// Security header values carry their tokens the same way.
func TestTakeOOBTokens_SecurityHeaders(t *testing.T) {
	store := oob.NewStore()
	g := oobOnlyGenerator(store)

	headers := g.GenerateSecurityHeaders()
	want := tokensIn(headers)
	if len(want) == 0 {
		t.Fatalf("no OOB token in the security headers: %v", headers)
	}
	got := g.TakeOOBTokens()
	if fmt.Sprint(sorted(got)) != fmt.Sprint(want) {
		t.Fatalf("took %v, headers carry %v", sorted(got), want)
	}
	if store.Size() != len(want) {
		t.Fatalf("store holds %d tokens, want %d", store.Size(), len(want))
	}
}

// Without a store nothing is registered, so nothing is recorded for a take either.
func TestTakeOOBTokens_NoStore(t *testing.T) {
	g := oobOnlyGenerator(nil)
	v := g.Generate("url", &swagger.SchemaProperty{Type: "string"})
	if len(tokensIn(v)) == 0 {
		t.Fatalf("expected an OOB payload, got %v", v)
	}
	g.GenerateSecurityHeaders()
	if got := g.TakeOOBTokens(); len(got) != 0 {
		t.Fatalf("took %v from a generator without a store", got)
	}
}
