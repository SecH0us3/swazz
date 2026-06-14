package logger

import (
	"fmt"
	"log"
	"strings"
)

type LogLevel int

const (
	LevelDebug LogLevel = iota
	LevelInfo
	LevelWarn
	LevelError
)

var (
	currentLevel = LevelInfo
	logFilter    = ""
)

func SetLevel(level LogLevel) {
	currentLevel = level
}

func SetLevelByName(levelName string) {
	switch strings.ToLower(levelName) {
	case "debug":
		currentLevel = LevelDebug
	case "info":
		currentLevel = LevelInfo
	case "warn", "warning":
		currentLevel = LevelWarn
	case "error":
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

func Debug(format string, v ...interface{}) {
	msg := fmt.Sprintf(format, v...)
	if shouldLog(LevelDebug, msg) {
		log.Printf("[DEBUG] %s", msg)
	}
}

func Info(format string, v ...interface{}) {
	msg := fmt.Sprintf(format, v...)
	if shouldLog(LevelInfo, msg) {
		log.Printf("[INFO] %s", msg)
	}
}

func Warn(format string, v ...interface{}) {
	msg := fmt.Sprintf(format, v...)
	if shouldLog(LevelWarn, msg) {
		log.Printf("[WARN] %s", msg)
	}
}

func Error(format string, v ...interface{}) {
	msg := fmt.Sprintf(format, v...)
	if shouldLog(LevelError, msg) {
		log.Printf("[ERROR] %s", msg)
	}
}
