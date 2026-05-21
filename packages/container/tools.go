//go:build tools

package tools

import (
	// gosec is a Go security checker used in CI via SAST workflow.
	// Pin the version here so `go mod tidy` tracks it.
	// Run: go install github.com/securego/gosec/v2/cmd/gosec@v2.22.1
	_ "github.com/securego/gosec/v2/cmd/gosec"
)
