// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package ws

import (
	"os"
	"testing"

	"swazz-engine/internal/wafcheck/wafchecktest"
)

// TestMain keeps the Runners these tests start off the production WAF-checker API.
func TestMain(m *testing.M) {
	os.Exit(wafchecktest.Wrap(m).Run())
}
