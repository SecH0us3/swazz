package logger

import (
	"bytes"
	"encoding/json"
	"log"
	"strings"
	"testing"
)

func TestLoggerTextMode(t *testing.T) {
	origJSON := isJSONFormat
	defer SetJSONFormat(origJSON)
	SetJSONFormat(false)

	// Set log level to debug to ensure all are printed
	SetLevel(LevelDebug)

	var buf bytes.Buffer
	// Remember original flags and output
	origFlags := log.Flags()
	origOutput := log.Writer()
	defer func() {
		log.SetFlags(origFlags)
		log.SetOutput(origOutput)
	}()

	log.SetFlags(0) // disable prefixes to make comparisons easier
	log.SetOutput(&buf)

	Debug("debug msg: %d", 123)
	Info("info msg: %s", "hello")
	Warn("warn msg")
	Error("error msg")

	output := buf.String()

	if !strings.Contains(output, "[DEBUG] debug msg: 123") {
		t.Errorf("expected debug message, got: %s", output)
	}
	if !strings.Contains(output, "[INFO] info msg: hello") {
		t.Errorf("expected info message, got: %s", output)
	}
	if !strings.Contains(output, "[WARN] warn msg") {
		t.Errorf("expected warn message, got: %s", output)
	}
	if !strings.Contains(output, "[ERROR] error msg") {
		t.Errorf("expected error message, got: %s", output)
	}
}

func TestLoggerJSONMode(t *testing.T) {
	origJSON := isJSONFormat
	defer SetJSONFormat(origJSON)
	SetJSONFormat(true)

	// Set log level to debug
	SetLevel(LevelDebug)

	var buf bytes.Buffer
	origOutput := log.Writer()
	defer func() {
		log.SetOutput(origOutput)
	}()

	log.SetOutput(&buf)

	Info("info JSON message: %s", "test")

	output := buf.String()
	idx := strings.Index(output, "{")
	if idx == -1 {
		t.Fatalf("expected JSON object in output, got: %s", output)
	}
	jsonStr := output[idx:]
	var logEntry JSONLog
	if err := json.Unmarshal([]byte(jsonStr), &logEntry); err != nil {
		t.Fatalf("failed to unmarshal JSON log: %v, raw output: %s", err, output)
	}

	if logEntry.Level != "info" {
		t.Errorf("expected level 'info', got '%s'", logEntry.Level)
	}
	if logEntry.Module != "container" {
		t.Errorf("expected module 'container', got '%s'", logEntry.Module)
	}
	if logEntry.Msg != "info JSON message: test" {
		t.Errorf("expected msg 'info JSON message: test', got '%s'", logEntry.Msg)
	}
	if logEntry.Timestamp == "" {
		t.Errorf("expected non-empty timestamp")
	}
}
