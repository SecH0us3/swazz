package logger

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"
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
		if os.Getenv("SWAZZ_LOG_FORMAT") == "json" {
			logJSON("debug", msg)
		} else {
			log.Printf("[DEBUG] %s", msg)
		}
	}
}

func Info(format string, v ...interface{}) {
	msg := fmt.Sprintf(format, v...)
	if shouldLog(LevelInfo, msg) {
		if os.Getenv("SWAZZ_LOG_FORMAT") == "json" {
			logJSON("info", msg)
		} else {
			log.Printf("[INFO] %s", msg)
		}
	}
}

func Warn(format string, v ...interface{}) {
	msg := fmt.Sprintf(format, v...)
	if shouldLog(LevelWarn, msg) {
		if os.Getenv("SWAZZ_LOG_FORMAT") == "json" {
			logJSON("warn", msg)
		} else {
			log.Printf("[WARN] %s", msg)
		}
	}
}

func Error(format string, v ...interface{}) {
	msg := fmt.Sprintf(format, v...)
	if shouldLog(LevelError, msg) {
		if os.Getenv("SWAZZ_LOG_FORMAT") == "json" {
			logJSON("error", msg)
		} else {
			log.Printf("[ERROR] %s", msg)
		}
	}
}
