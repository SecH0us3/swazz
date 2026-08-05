// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

//go:build tools

package tools

import (
	// gosec is a Go security checker used in CI via SAST workflow.
	// Pin the version here so `go mod tidy` tracks it.
	// Run: go install github.com/securego/gosec/v2/cmd/gosec@v2.22.1
	_ "github.com/securego/gosec/v2/cmd/gosec"
)
