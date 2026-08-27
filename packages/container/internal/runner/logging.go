// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"fmt"
	"strings"
	"time"

	"swazz-engine/internal/logger"
	"swazz-engine/internal/swagger"
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

// formatBytes formats byte sizes into human-readable strings (e.g. "10.0 MB (10485760 B)").
func formatBytes(b int) string {
	const unit = 1024
	if b <= 0 {
		return "0 B"
	}
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	units := []string{"KB", "MB", "GB", "TB"}
	return fmt.Sprintf("%.1f %s (%d B)", float64(b)/float64(div), units[exp], b)
}

// logStartupSummary outputs the configured scan parameters (target, profiles, counts, concurrency, modules)
// to both the runner logger and the real-time event log stream.
func (r *Runner) logStartupSummary(profiles []swagger.FuzzingProfile) {
	if r.config == nil {
		return
	}

	target := r.config.BaseURL
	if target == "" && r.config.MCPServer != nil {
		if r.config.MCPServer.URL != "" {
			target = fmt.Sprintf("MCP %s (%s)", r.config.MCPServer.Type, r.config.MCPServer.URL)
		} else if r.config.MCPServer.Command != "" {
			args := strings.Join(r.config.MCPServer.Args, " ")
			if args != "" {
				target = fmt.Sprintf("MCP stdio (%s %s)", r.config.MCPServer.Command, args)
			} else {
				target = fmt.Sprintf("MCP stdio (%s)", r.config.MCPServer.Command)
			}
		} else {
			target = "MCP Server"
		}
	} else if target == "" {
		target = "Custom Endpoints (no base URL)"
	}

	var profileNames []string
	for _, p := range profiles {
		profileNames = append(profileNames, string(p))
	}
	if len(profileNames) == 0 {
		profileNames = []string{"NONE"}
	}

	payloadSizeStr := formatBytes(r.config.Settings.MaxPayloadSizeBytes)
	plannedTotal := r.progress.totalPlanned.Load()

	r.logInfo("════════════════════════════════════════════════════════════════")
	r.logInfo("🚀 Swazz Fuzzing Scan Starting")
	r.logInfo("🎯 Target:               %s (%d endpoint(s))", target, len(r.config.Endpoints))
	r.logInfo("🧬 Profiles:             %s", strings.Join(profileNames, ", "))
	r.logInfo("📊 Planned Requests:     ~%d requests (%d iter/profile)", plannedTotal, r.config.Settings.IterationsPerProfile)
	r.logInfo("⚡ Concurrency & Limits:  %d workers | Timeout: %dms | Delay: %dms | Max Payload: %s",
		r.config.Settings.Concurrency, r.config.Settings.TimeoutMs, r.config.Settings.DelayBetweenRequestMs, payloadSizeStr)

	// Security & Advanced Modules summary
	var modules []string
	if r.config.Settings.BOLATesting {
		modules = append(modules, fmt.Sprintf("BOLA (threshold=%.2f, identities=%d)", r.config.Settings.BOLASimilarityThreshold, len(r.config.AuthIdentities)))
	}
	if r.config.Settings.RateLimitCheck {
		modules = append(modules, fmt.Sprintf("RateLimitCheck (burst=%d)", r.config.Settings.RateLimitBurstSize))
	}
	if r.config.Settings.ActiveParameterFuzzing {
		modules = append(modules, "ActiveParamFuzz")
	}
	if r.config.Settings.SemanticMutationEnabled() {
		modules = append(modules, "SemanticMutation")
	}
	if r.config.MCPServer != nil && r.config.Settings.MCPMethodFuzzingEnabled() {
		modules = append(modules, "MCPMethodFuzz")
	}
	if r.config.Settings.OOBServerURL != "" {
		modules = append(modules, fmt.Sprintf("OOB (%s)", r.config.Settings.OOBServerURL))
	}
	if len(r.config.Settings.ProxyList) > 0 {
		modules = append(modules, fmt.Sprintf("Proxies (%d)", len(r.config.Settings.ProxyList)))
	}
	if r.config.Settings.RandomizeUserAgent {
		modules = append(modules, "RandomUA")
	}
	if len(r.config.Settings.ChainingRules) > 0 {
		modules = append(modules, fmt.Sprintf("ChainingRules (%d)", len(r.config.Settings.ChainingRules)))
	}
	if len(r.config.AuthSequence) > 0 {
		modules = append(modules, fmt.Sprintf("AuthSequence (%d steps)", len(r.config.AuthSequence)))
	}

	if len(modules) > 0 {
		r.logInfo("🛡️  Active Modules:       %s", strings.Join(modules, ", "))
	}
	if r.config.Settings.Checkpoint != nil {
		r.logInfo("🔄 Resuming Checkpoint:  Profile=%s | Endpoint=%s | Iteration=%d",
			r.config.Settings.Checkpoint.Profile, r.config.Settings.Checkpoint.Endpoint, r.config.Settings.Checkpoint.Iteration)
	}
	r.logInfo("════════════════════════════════════════════════════════════════")
}

