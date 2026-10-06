// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"strings"
	"testing"
)

func TestEvent_JSON(t *testing.T) {
	t.Parallel()
	e := &Event{Type: EventProgress, Data: map[string]any{"done": 3}}
	out := e.JSON()
	if !strings.Contains(out, `"done":3`) {
		t.Errorf("expected marshalled data, got %q", out)
	}

	// A value json cannot marshal (a channel) falls back to the error payload
	// instead of panicking.
	bad := &Event{Type: EventError, Data: make(chan int)}
	if got := bad.JSON(); !strings.Contains(got, "failed to marshal event data") {
		t.Errorf("expected error fallback, got %q", got)
	}
}
