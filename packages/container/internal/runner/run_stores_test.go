// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/analyzer"
	"swazz-engine/internal/oob"
	"swazz-engine/internal/sstistore"
	"swazz-engine/internal/swagger"
)

// Two scans run at once on one agent: starting and ending one must not wipe, or consume, the OOB
// tokens and SSTI expressions the other is still waiting on.
func TestRunStores_ConcurrentRunsDoNotClearEachOther(t *testing.T) {
	a := New(&swagger.Config{RunID: "run-a"}, nil)
	defer a.Close()
	b := New(&swagger.Config{RunID: "run-b"}, nil)
	defer b.Close()

	a.oobStore.RegisterUUID("token-a", &oob.OOBContext{SessionID: "run-a", Endpoint: "GET /a"})
	a.sstiStore.Register("{{23*37}}", sstistore.SSTIContext{RawExpr: "23*37", Expected: "851"})

	_, err := b.initRun(context.Background())
	require.NoError(t, err)
	b.finaliseRun()

	assert.Equal(t, 1, a.oobStore.Size(), "run b's start or end cleared run a's OOB tokens")
	_, ok := a.sstiStore.Get("{{23*37}}")
	assert.True(t, ok, "run b's start or end cleared run a's SSTI expressions")

	// A callback routed to run b does not consume run a's token.
	b.HandleOOBTrigger("token-a")
	assert.Equal(t, 1, a.oobStore.Size())

	// Run b's analyzer does not match run a's expressions; run a's does.
	input := &analyzer.AnalysisInput{
		SentPayload:  "{{23*37}}",
		ResponseBody: []byte("Hello 851!"),
		Profile:      swagger.ProfileMalicious,
	}
	assert.True(t, hasFinding(a.analyzer.Analyze(input), "swazz/ssti-leak"))
	assert.False(t, hasFinding(b.analyzer.Analyze(input), "swazz/ssti-leak"))
}

func TestRunStores_ClearedWhenTheRunStartsAndEnds(t *testing.T) {
	r := New(&swagger.Config{RunID: "run-c"}, nil)
	defer r.Close()

	r.oobStore.RegisterUUID("stale", &oob.OOBContext{SessionID: "run-c"})
	r.sstiStore.Register("stale", sstistore.SSTIContext{})
	_, err := r.initRun(context.Background())
	require.NoError(t, err)
	assert.Zero(t, r.oobStore.Size(), "a previous run's tokens survived the start")
	_, ok := r.sstiStore.Get("stale")
	assert.False(t, ok)

	r.oobStore.RegisterUUID("pending", &oob.OOBContext{SessionID: "run-c"})
	r.sstiStore.Register("pending", sstistore.SSTIContext{})
	r.finaliseRun()
	assert.Zero(t, r.oobStore.Size(), "the run's tokens outlived it")
	_, ok = r.sstiStore.Get("pending")
	assert.False(t, ok)
}

// The generators a run builds register what they send in that run's stores.
func TestNewGenerator_RegistersInTheRunsStores(t *testing.T) {
	r := New(&swagger.Config{RunID: "run-d"}, nil)
	defer r.Close()

	gen := r.newGenerator(swagger.ProfileMalicious, "GET /d")
	assert.Equal(t, "run-d", gen.RunID)
	assert.Equal(t, "GET /d", gen.Endpoint)
	assert.Same(t, r.oobStore, gen.OOBStore)
	assert.Same(t, r.sstiStore, gen.SSTIStore)
}

func hasFinding(findings []swagger.AnalysisFinding, rule string) bool {
	for _, f := range findings {
		if f.RuleID == rule {
			return true
		}
	}
	return false
}
