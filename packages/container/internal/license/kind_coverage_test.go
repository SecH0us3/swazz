// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package license

import "testing"

func TestKindOrDefault(t *testing.T) {
	t.Parallel()
	if got := (*License)(nil).KindOrDefault(); got != KindCommercial {
		t.Errorf("nil license: got %q, want %q", got, KindCommercial)
	}
	if got := (&License{Kind: KindTrial}).KindOrDefault(); got != KindTrial {
		t.Errorf("trial: got %q, want %q", got, KindTrial)
	}
	if got := (&License{Kind: KindCommercial}).KindOrDefault(); got != KindCommercial {
		t.Errorf("commercial: got %q, want %q", got, KindCommercial)
	}
}
