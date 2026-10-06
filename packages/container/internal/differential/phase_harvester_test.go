// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package differential

import "testing"

func TestPhase_Harvester(t *testing.T) {
	t.Parallel()
	p := NewPhase(nil)
	if p.Harvester() == nil {
		t.Fatal("Harvester() should return the phase's chain harvester")
	}
}
