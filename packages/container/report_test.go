// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"bytes"
	"io"
	"os"
	"strings"
	"testing"

	"swazz-engine/internal/classifier"
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

func TestPrintProgress_ANSI(t *testing.T) {
	oldStderr := os.Stderr
	r, w, _ := os.Pipe()
	os.Stderr = w

	defer func() {
		os.Stderr = oldStderr
	}()

	logger.SetLevelByName("info")

	stats := swagger.RunStats{
		TotalRequests:  50,
		TotalPlanned:   100,
		RequestsPerSec: 25.0,
		Concurrency:    5,
		StatusByProfile: map[swagger.FuzzingProfile]map[int]int64{
			swagger.ProfileBoundary: {
				200: 10,
				301: 2,
				400: 15,
				500: 3,
			},
		},
	}
	stats.Progress.CurrentEndpoint = "POST /api/v1/cards"
	stats.Progress.CurrentProfile = "BOUNDARY"
	stats.Progress.CurrentIteration = 10
	stats.Progress.TotalIterations = 20

	printProgress(stats)
	w.Close()

	var buf bytes.Buffer
	_, _ = io.Copy(&buf, r)
	output := buf.String()

	if !strings.Contains(output, "SWAZZ ENGINE") {
		t.Errorf("Expected SWAZZ ENGINE in output, got: %s", output)
	}
}

func TestPrintSummary(t *testing.T) {
	oldStderr := os.Stderr
	r, w, _ := os.Pipe()
	os.Stderr = w

	defer func() {
		os.Stderr = oldStderr
	}()

	logger.SetLevelByName("info")

	stats := &swagger.RunStats{
		TotalRequests:  100,
		RequestsPerSec: 50.0,
		StartTime:      1000,
		StatusCounts: map[int]int64{
			200: 80,
			400: 15,
			500: 5,
		},
	}

	findings := []*classifier.Finding{
		{Level: classifier.SeverityError, RuleID: "swazz/sql-injection"},
		{Level: classifier.SeverityWarning, RuleID: "swazz/stacktrace"},
		{Level: classifier.SeverityNote, RuleID: "swazz/info-leak"},
	}

	printSummary(findings, stats)
	w.Close()

	var buf bytes.Buffer
	_, _ = io.Copy(&buf, r)
	output := buf.String()

	if !strings.Contains(output, "swazz scan complete") {
		t.Errorf("Expected 'swazz scan complete' in summary, got: %s", output)
	}
	if !strings.Contains(output, "errors:   1") {
		t.Errorf("Expected 'errors:   1' in summary, got: %s", output)
	}
}

