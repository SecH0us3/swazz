// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package swagger

import "testing"

func boolPtr(b bool) *bool { return &b }

func TestSettings_FeatureFlagsDefaultTrue(t *testing.T) {
	t.Parallel()
	// Unset pointer defaults to enabled.
	if !(Settings{}).WAFCheckEnabled() {
		t.Error("WAFCheckEnabled should default to true when unset")
	}
	if !(Settings{}).MCPMethodFuzzingEnabled() {
		t.Error("MCPMethodFuzzingEnabled should default to true when unset")
	}
	// Explicit values are honoured.
	if (Settings{EnableWAFCheck: boolPtr(false)}).WAFCheckEnabled() {
		t.Error("WAFCheckEnabled should be false when explicitly disabled")
	}
	if !(Settings{EnableWAFCheck: boolPtr(true)}).WAFCheckEnabled() {
		t.Error("WAFCheckEnabled should be true when explicitly enabled")
	}
	if (Settings{EnableMCPMethodFuzzing: boolPtr(false)}).MCPMethodFuzzingEnabled() {
		t.Error("MCPMethodFuzzingEnabled should be false when explicitly disabled")
	}
}
