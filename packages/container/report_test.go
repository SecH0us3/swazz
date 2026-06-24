package main

import (
	"bytes"
	"io"
	"os"
	"strings"
	"testing"

	"swazz-engine/internal/logger"
	"swazz-engine/internal/swagger"
)

func TestPrintProgressClean(t *testing.T) {
	// Keep original stderr
	oldStderr := os.Stderr
	r, w, _ := os.Pipe()
	os.Stderr = w

	defer func() {
		os.Stderr = oldStderr
	}()

	// Set logger to info to ensure it prints
	logger.SetLevelByName("info")

	stats := swagger.RunStats{
		TotalRequests: 10,
		TotalPlanned:  100,
		RequestsPerSec: 15.5,
	}
	stats.Progress.CurrentEndpoint = "GET /api/v1/users"
	stats.Progress.CurrentProfile = "BOLA"
	stats.Progress.CurrentIteration = 2
	stats.Progress.TotalIterations = 5

	printProgressClean(stats)

	w.Close()

	var buf bytes.Buffer
	_, _ = io.Copy(&buf, r)
	output := buf.String()

	expected := "🎯 Progress: [10%] 10/100 reqs | 15.5 rps | Active: GET /api/v1/users (BOLA) [test 2/5]"
	if !strings.Contains(output, expected) {
		t.Errorf("Expected output to contain:\n%q\nBut got:\n%q", expected, output)
	}
}
