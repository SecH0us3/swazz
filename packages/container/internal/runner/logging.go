// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"fmt"
	"time"

	"swazz-engine/internal/logger"
)

func (r *Runner) logDebug(format string, v ...interface{}) {
	if logger.IsDebugEnabled() || r.config.Settings.Debug {
		logger.Debug(format, v...)
	}
}

func truncateLog(msg string) string {
	const maxSize = 32768
	if len(msg) > maxSize {
		count := 0
		for i := range msg {
			if count == maxSize {
				return msg[:i] + "... [TRUNCATED]"
			}
			count++
		}
	}
	return msg
}

func (r *Runner) logInfo(format string, v ...interface{}) {
	logger.Info(format, v...)
	r.Broadcast(Event{
		Type: "runner_log",
		Data: map[string]interface{}{
			"level":     "info",
			"message":   truncateLog(fmt.Sprintf(format, v...)),
			"timestamp": time.Now().Format(time.RFC3339),
		},
	})
}

func (r *Runner) logWarn(format string, v ...interface{}) {
	logger.Warn(format, v...)
	r.Broadcast(Event{
		Type: "runner_log",
		Data: map[string]interface{}{
			"level":     "warn",
			"message":   truncateLog(fmt.Sprintf(format, v...)),
			"timestamp": time.Now().Format(time.RFC3339),
		},
	})
}

func (r *Runner) logError(format string, v ...interface{}) {
	logger.Error(format, v...)
	r.Broadcast(Event{
		Type: "runner_log",
		Data: map[string]interface{}{
			"level":     "error",
			"message":   truncateLog(fmt.Sprintf(format, v...)),
			"timestamp": time.Now().Format(time.RFC3339),
		},
	})
}
