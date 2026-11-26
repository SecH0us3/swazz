// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

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
	origNoColor := noColorFlag.Load()
	defer func() {
		SetJSONFormat(origJSON)
		SetNoColor(origNoColor)
	}()
	SetJSONFormat(false)
	SetNoColor(true)

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

func TestLoggerExtraHelpers(t *testing.T) {
	origLevel := GetLevel()
	defer SetLevel(origLevel)

	SetLevel(LevelWarn)
	if GetLevel() != LevelWarn {
		t.Errorf("expected LevelWarn, got %v", GetLevel())
	}

	SetLevelByName("debug")
	if GetLevel() != LevelDebug {
		t.Errorf("expected LevelDebug, got %v", GetLevel())
	}
	if !IsDebugEnabled() {
		t.Error("expected IsDebugEnabled to be true")
	}

	SetLevelByName("info")
	if GetLevel() != LevelInfo {
		t.Errorf("expected LevelInfo, got %v", GetLevel())
	}

	SetLevelByName("warning")
	if GetLevel() != LevelWarn {
		t.Errorf("expected LevelWarn, got %v", GetLevel())
	}

	SetLevelByName("quiet")
	if GetLevel() != LevelError {
		t.Errorf("expected LevelError, got %v", GetLevel())
	}

	SetLevelByName("unknown-level")
	if GetLevel() != LevelInfo {
		t.Errorf("expected default LevelInfo, got %v", GetLevel())
	}

	origFilter := logFilter
	defer SetFilter(origFilter)
	SetFilter("specific-msg")
	if logFilter != "specific-msg" {
		t.Errorf("expected filter 'specific-msg', got %s", logFilter)
	}

	if shouldLog(LevelInfo, "random message") {
		t.Error("expected shouldLog to be false when message doesn't match filter")
	}
	if !shouldLog(LevelInfo, "contains specific-msg") {
		t.Error("expected shouldLog to be true when message matches filter")
	}

	SetFilter("")
	if !shouldLog(LevelInfo, "random message") {
		t.Error("expected shouldLog to be true when filter is empty")
	}
}

func TestCRLFWriter(t *testing.T) {
	var buf bytes.Buffer
	w := &crlfWriter{out: &buf}

	SetRawTerminal(false)
	_, _ = w.Write([]byte("line 1\nline 2\n"))
	if buf.String() != "line 1\nline 2\n" {
		t.Errorf("expected normal newlines when raw terminal is false, got %q", buf.String())
	}

	buf.Reset()
	SetRawTerminal(true)
	defer SetRawTerminal(false)

	_, _ = w.Write([]byte("line 1\nline 2\r\nline 3\n"))
	if buf.String() != "line 1\r\nline 2\r\nline 3\r\n" {
		t.Errorf("expected CRLF newlines when raw terminal is true, got %q", buf.String())
	}
}

func TestLoggerColorsAndNoColor(t *testing.T) {
	origJSON := isJSONFormat
	origNoColor := noColorFlag.Load()
	origForce := forceColorFlag.Load()
	origLevel := GetLevel()
	origFlags := log.Flags()
	origOutput := log.Writer()
	defer func() {
		SetJSONFormat(origJSON)
		SetNoColor(origNoColor)
		forceColorFlag.Store(origForce)
		SetLevel(origLevel)
		log.SetFlags(origFlags)
		log.SetOutput(origOutput)
	}()

	SetJSONFormat(false)
	SetLevel(LevelDebug)
	log.SetFlags(0)
	t.Setenv("NO_COLOR", "")

	var buf bytes.Buffer
	log.SetOutput(&buf)

	// 1. Force colors enabled: [Adaptive] is yellow, Error is red, Warn is yellow
	SetNoColor(false)
	forceColorFlag.Store(true)

	Info("[Adaptive] Learned required parameter(s) [csrf] on POST /login (HTTP 400)")
	Warn("warn msg")
	Error("error msg")

	colored := buf.String()
	if !strings.Contains(colored, ansiYellow+"[INFO] [Adaptive]") {
		t.Errorf("expected yellow ANSI sequence for [Adaptive], got: %q", colored)
	}
	if !strings.Contains(colored, ansiYellow+"[WARN] warn msg") {
		t.Errorf("expected yellow ANSI sequence for WARN, got: %q", colored)
	}
	if !strings.Contains(colored, ansiRed+"[ERROR] error msg") {
		t.Errorf("expected red ANSI sequence for ERROR, got: %q", colored)
	}

	// 2. NO_COLOR env var disables all ANSI sequences
	buf.Reset()
	t.Setenv("NO_COLOR", "1")
	Info("[Adaptive] Learned required parameter(s) [csrf]")
	Error("plain error")
	if strings.Contains(buf.String(), "\x1b[") {
		t.Errorf("expected no ANSI codes when NO_COLOR is set, got: %q", buf.String())
	}

	// 3. Explicit SetNoColor(true) (-no-color flag) disables all ANSI sequences
	buf.Reset()
	t.Setenv("NO_COLOR", "")
	SetNoColor(true)
	Info("[Adaptive] Learned required parameter(s) [csrf]")
	Error("plain error")
	if strings.Contains(buf.String(), "\x1b[") {
		t.Errorf("expected no ANSI codes when SetNoColor(true), got: %q", buf.String())
	}
}
