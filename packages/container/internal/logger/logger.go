// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package logger

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"sync/atomic"
	"time"
)

type LogLevel int

const (
	LevelDebug LogLevel = iota
	LevelInfo
	LevelWarn
	LevelError
)

type crlfWriter struct {
	out io.Writer
}

var (
	currentLevel   = LevelInfo
	logFilter      = ""
	isJSONFormat   = false
	isRawTerminal  atomic.Bool
	noColorFlag    atomic.Bool
	forceColorFlag atomic.Bool
)

const (
	ansiReset   = "\x1b[0m"
	ansiGray    = "\x1b[90m"
	ansiRed     = "\x1b[31m"
	ansiGreen   = "\x1b[32m"
	ansiYellow  = "\x1b[33m"
	ansiMagenta = "\x1b[35m"
	ansiCyan    = "\x1b[36m"
)

// SetNoColor explicitly enables or disables ANSI color output.
func SetNoColor(disabled bool) {
	noColorFlag.Store(disabled)
}

// IsColorEnabled reports whether ANSI colors should be emitted for text logs.
// Respects NO_COLOR, -no-color, TERM=dumb, JSON mode, CI runners (GitLab CI,
// GitHub Actions), FORCE_COLOR, and TTY detection on stderr.
func IsColorEnabled() bool {
	if isJSONFormat || noColorFlag.Load() || os.Getenv("NO_COLOR") != "" {
		return false
	}
	if forceColorFlag.Load() || os.Getenv("FORCE_COLOR") != "" || os.Getenv("CLICOLOR_FORCE") != "" {
		return true
	}
	if os.Getenv("TERM") == "dumb" {
		return false
	}
	if os.Getenv("GITLAB_CI") == "true" || os.Getenv("GITHUB_ACTIONS") == "true" {
		return true
	}
	fi, err := os.Stderr.Stat()
	return err == nil && (fi.Mode()&os.ModeCharDevice) != 0
}

func formatTextLine(level LogLevel, msg string) string {
	var tag string
	switch level {
	case LevelDebug:
		tag = "DEBUG"
	case LevelInfo:
		tag = "INFO"
	case LevelWarn:
		tag = "WARN"
	case LevelError:
		tag = "ERROR"
	default:
		tag = "INFO"
	}

	if !IsColorEnabled() {
		return fmt.Sprintf("[%s] %s", tag, msg)
	}

	switch level {
	case LevelDebug:
		return ansiGray + "[" + tag + "] " + msg + ansiReset
	case LevelWarn:
		return ansiYellow + "[" + tag + "] " + msg + ansiReset
	case LevelError:
		return ansiRed + "[" + tag + "] " + msg + ansiReset
	case LevelInfo:
		switch {
		case strings.Contains(msg, "[Adaptive]"):
			return ansiYellow + "[" + tag + "] " + msg + ansiReset
		case strings.Contains(msg, "🚨"):
			return ansiRed + "[" + tag + "] " + msg + ansiReset
		case strings.Contains(msg, "🏁") || strings.Contains(msg, "✨"):
			return ansiGreen + "[" + tag + "] " + msg + ansiReset
		case strings.Contains(msg, "[BOLA]") || strings.Contains(msg, "[Auth]") || strings.Contains(msg, "[AutoChain]") || strings.Contains(msg, "[OOB]"):
			return ansiMagenta + "[" + tag + "] " + msg + ansiReset
		default:
			return ansiCyan + "[" + tag + "]" + ansiReset + " " + msg
		}
	default:
		return ansiCyan + "[" + tag + "]" + ansiReset + " " + msg
	}
}

// SetRawTerminal enables or disables CRLF translation for terminal raw mode.
func SetRawTerminal(raw bool) {
	isRawTerminal.Store(raw)
}

func (w *crlfWriter) Write(p []byte) (n int, err error) {
	if !isRawTerminal.Load() {
		return w.out.Write(p)
	}
	str := string(p)
	str = strings.ReplaceAll(str, "\r\n", "\n")
	str = strings.ReplaceAll(str, "\n", "\r\n")
	_, err = w.out.Write([]byte(str))
	if err != nil {
		return 0, err
	}
	return len(p), nil
}

func init() {
	log.SetOutput(&crlfWriter{out: os.Stderr})
	if os.Getenv("SWAZZ_LOG_FORMAT") == "json" {
		SetJSONFormat(true)
	}
}

// SetJSONFormat sets whether the logger uses JSON format or not.
func SetJSONFormat(jsonFormat bool) {
	isJSONFormat = jsonFormat
	if jsonFormat {
		log.SetFlags(0)
	} else {
		log.SetFlags(log.Ldate | log.Ltime)
	}
}

func SetLevel(level LogLevel) {
	currentLevel = level
}

func GetLevel() LogLevel {
	return currentLevel
}

func SetLevelByName(levelName string) {
	switch strings.ToLower(levelName) {
	case "debug":
		currentLevel = LevelDebug
	case "info":
		currentLevel = LevelInfo
	case "warn", "warning":
		currentLevel = LevelWarn
	case "error", "quiet", "q":
		currentLevel = LevelError
	default:
		log.Printf("Unknown log level '%s', defaulting to info", levelName)
		currentLevel = LevelInfo
	}
}

func SetFilter(filter string) {
	logFilter = strings.ToLower(filter)
}

func IsDebugEnabled() bool {
	return currentLevel <= LevelDebug
}

func shouldLog(level LogLevel, msg string) bool {
	if level < currentLevel {
		return false
	}
	if logFilter != "" {
		return strings.Contains(strings.ToLower(msg), logFilter)
	}
	return true
}

type JSONLog struct {
	Timestamp string                 `json:"timestamp"`
	Level     string                 `json:"level"`
	Module    string                 `json:"module"`
	Msg       string                 `json:"msg"`
	Payload   map[string]interface{} `json:"payload,omitempty"`
}

func logJSON(level, msg string) {
	entry := JSONLog{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Level:     level,
		Module:    "container",
		Msg:       msg,
	}
	data, err := json.Marshal(entry)
	if err == nil {
		log.Println(string(data))
	} else {
		log.Printf("[%s] %s", strings.ToUpper(level), msg)
	}
}

func Debug(format string, v ...interface{}) {
	msg := fmt.Sprintf(format, v...)
	if shouldLog(LevelDebug, msg) {
		if isJSONFormat {
			logJSON("debug", msg)
		} else {
			log.Print(formatTextLine(LevelDebug, msg))
		}
	}
}

func Info(format string, v ...interface{}) {
	msg := fmt.Sprintf(format, v...)
	if shouldLog(LevelInfo, msg) {
		if isJSONFormat {
			logJSON("info", msg)
		} else {
			log.Print(formatTextLine(LevelInfo, msg))
		}
	}
}

func Warn(format string, v ...interface{}) {
	msg := fmt.Sprintf(format, v...)
	if shouldLog(LevelWarn, msg) {
		if isJSONFormat {
			logJSON("warn", msg)
		} else {
			log.Print(formatTextLine(LevelWarn, msg))
		}
	}
}

func Error(format string, v ...interface{}) {
	msg := fmt.Sprintf(format, v...)
	if shouldLog(LevelError, msg) {
		if isJSONFormat {
			logJSON("error", msg)
		} else {
			log.Print(formatTextLine(LevelError, msg))
		}
	}
}
