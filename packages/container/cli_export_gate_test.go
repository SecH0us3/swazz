// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// cliHelperEnv makes the test binary act as `swazz-engine start` so a test can
// observe the real process exit code (runCLI calls os.Exit).
const cliHelperEnv = "SWAZZ_TEST_RUN_CLI_ARGS"

// TestCLIExitCodeHelper is not a test on its own: it only runs runCLI when
// re-executed by runCLIProcess.
func TestCLIExitCodeHelper(t *testing.T) {
	raw := os.Getenv(cliHelperEnv)
	if raw == "" {
		t.Skip("helper process for runCLIProcess")
	}
	runCLI(strings.Split(raw, "\x1f"))
	os.Exit(0)
}

// runCLIProcess runs `start` with args in a child process in community mode
// (no license key) and returns its exit code and combined output.
func runCLIProcess(t *testing.T, args ...string) (int, string) {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestCLIExitCodeHelper$") // #nosec G204,G702 -- re-executes this test binary
	cmd.Env = append(os.Environ(),
		cliHelperEnv+"="+strings.Join(args, "\x1f"),
		"SWAZZ_LICENSE_KEY=",
		"SWAZZ_DISABLE_TELEMETRY=true",
	)
	out, err := cmd.CombinedOutput()
	if err == nil {
		return 0, string(out)
	}
	var exitErr *exec.ExitError
	require.True(t, errors.As(err, &exitErr), "unexpected exec error: %v", err)
	return exitErr.ExitCode(), string(out)
}

// writeCommunityConfig writes a config without license_key for a single
// endpoint served by ts.
func writeCommunityConfig(t *testing.T, dir, baseURL string) string {
	t.Helper()
	cfgPath := filepath.Join(dir, "config.json")
	cfgJSON := fmt.Sprintf(`{
		"base_url": "%s",
		"endpoint_definitions": [
			{"path": "/api/ping", "method": "GET"}
		],
		"settings": {
			"iterations_per_profile": 1,
			"concurrency": 1,
			"timeout_ms": 1000,
			"profiles": ["RANDOM"]
		}
	}`, baseURL)
	require.NoError(t, os.WriteFile(cfgPath, []byte(cfgJSON), 0600))
	return cfgPath
}

// Regression: without a license, a paid export flag (--sarif) listed before
// --json used to return early, so the free JSON report was never written and
// --fail-on-severity was never evaluated (exit 1 instead of 2).
func TestStart_CommunityPaidExportStillWritesJSONAndHonoursFailOnSeverity(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError) // swazz/status-500 → error severity
		_, _ = w.Write([]byte(`{"error":"boom"}`))
	}))
	defer ts.Close()

	tmpDir := t.TempDir()
	cfgPath := writeCommunityConfig(t, tmpDir, ts.URL)
	sarifPath := filepath.Join(tmpDir, "findings.sarif")
	jsonPath := filepath.Join(tmpDir, "findings.json")

	code, out := runCLIProcess(t,
		"-config", cfgPath,
		"-sarif", sarifPath,
		"-json", jsonPath,
		"-fail-on-severity", "error",
		"-quiet",
		"-no-color",
		"-allow-private-ips=true",
		"-disable-telemetry",
	)

	assert.Equal(t, 2, code, "findings at/above the threshold must exit 2 even when a paid export was refused; output:\n%s", out)
	assert.Contains(t, out, "report export 'sarif' requires a paid plan", "the refused export must still be reported")
	assert.FileExists(t, jsonPath, "free --json report must be written without a license")
	assert.NoFileExists(t, sarifPath, "paid --sarif report must not be written without a license")
}

// Without findings over the threshold, a refused paid export still fails the
// run (exit 1) so CI notices the missing file — but only after the free
// reports were written.
func TestStart_CommunityPaidExportWithoutThresholdExitsOneAfterFreeReports(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer ts.Close()

	tmpDir := t.TempDir()
	cfgPath := writeCommunityConfig(t, tmpDir, ts.URL)
	jsonPath := filepath.Join(tmpDir, "report.json")
	htmlPath := filepath.Join(tmpDir, "report.html")
	mdPath := filepath.Join(tmpDir, "report.md")

	code, out := runCLIProcess(t,
		"-config", cfgPath,
		"-html", htmlPath,
		"-markdown", mdPath,
		"-json", jsonPath,
		"-fail-on-severity", "error",
		"-quiet",
		"-no-color",
		"-allow-private-ips=true",
		"-disable-telemetry",
	)

	assert.Equal(t, 1, code, "a refused paid export must fail the run; output:\n%s", out)
	assert.Contains(t, out, "'html'")
	assert.Contains(t, out, "'markdown'")
	assert.Contains(t, out, "require a paid plan")
	assert.FileExists(t, jsonPath)
	assert.NoFileExists(t, htmlPath)
	assert.NoFileExists(t, mdPath)
}

// A free-only run that meets the threshold exits 2 (unchanged behaviour,
// now asserted on the real process exit code).
func TestStart_CommunityJSONOnlyFailOnSeverityExitsTwo(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()

	tmpDir := t.TempDir()
	cfgPath := writeCommunityConfig(t, tmpDir, ts.URL)
	jsonPath := filepath.Join(tmpDir, "report.json")

	code, out := runCLIProcess(t,
		"-config", cfgPath,
		"-json", jsonPath,
		"-fail-on-severity", "error",
		"-quiet",
		"-no-color",
		"-allow-private-ips=true",
		"-disable-telemetry",
	)
	assert.Equal(t, 2, code, "output:\n%s", out)
	assert.FileExists(t, jsonPath)
}
