// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"fmt"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"swazz-engine/internal/license"
	"swazz-engine/internal/logger"
	"swazz-engine/internal/swagger"
)

func (r *Runner) logDebug(format string, v ...interface{}) {
	if logger.IsDebugEnabled() || (r.config != nil && r.config.Settings.Debug) {
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

// formatDuration formats millisecond durations into readable strings (e.g. "45s", "1m 23s", "2h 15m").
func formatDuration(ms int64) string {
	if ms <= 0 {
		return "0s"
	}
	sec := ms / 1000
	if sec < 60 {
		return fmt.Sprintf("%ds", sec)
	}
	min := sec / 60
	remSec := sec % 60
	if min < 60 {
		if remSec > 0 {
			return fmt.Sprintf("%dm %ds", min, remSec)
		}
		return fmt.Sprintf("%dm", min)
	}
	hr := min / 60
	remMin := min % 60
	if remMin > 0 {
		return fmt.Sprintf("%dh %dm", hr, remMin)
	}
	return fmt.Sprintf("%dh", hr)
}

// maskSensitiveString masks secret strings (tokens, keys, passwords).
func maskSensitiveString(s string) string {
	if s == "" {
		return ""
	}
	if strings.HasPrefix(strings.ToLower(s), "bearer ") {
		token := s[7:]
		if len(token) <= 6 {
			return "Bearer ****"
		}
		return "Bearer " + token[:3] + "..." + token[len(token)-3:]
	}
	if len(s) <= 6 {
		return "****"
	}
	return s[:2] + "..." + s[len(s)-2:]
}

// isSensitiveHeader checks if a header name indicates sensitive authorization data.
func isSensitiveHeader(name string) bool {
	lower := strings.ToLower(name)
	for _, p := range sensitiveKeyPatterns {
		if strings.Contains(lower, p) {
			return true
		}
	}
	return false
}

// estimateScanDuration estimates overall scan duration taking target latency characteristics into account.
func estimateScanDuration(totalPlanned int64, concurrency int, delayMs int, isMCP bool) string {
	if totalPlanned <= 0 || concurrency <= 0 {
		return "<1s"
	}
	baseLatencyMs := int64(40)
	if isMCP {
		baseLatencyMs = 200
	}
	estimatedPerReqMs := baseLatencyMs + int64(delayMs)
	totalEstMs := (totalPlanned * estimatedPerReqMs) / int64(concurrency)
	if totalEstMs < 1000 {
		return "<1s"
	}
	return "~" + formatDuration(totalEstMs)
}

func (r *Runner) getLicenseSummary() string {
	if r.gate == nil {
		return "Community Edition (Free)"
	}
	ceil := r.gate.ConcurrencyCeiling()
	if ceil > license.FreeConcurrencyCeiling {
		return fmt.Sprintf("Enterprise Edition (Max Concurrency: %d)", ceil)
	}
	return fmt.Sprintf("Community Edition (Max Concurrency: %d)", ceil)
}

func (r *Runner) getSSRFSummary() string {
	if r.config != nil && r.config.Security.AllowPrivateIPs {
		return "Private IPs Allowed (Local/Host mode)"
	}
	return "SafeNet Protected (Private IPs Blocked)"
}

// logStartupSummary outputs the full configured scan parameters (target, engine, profiles, counts, concurrency, modules, auth)
// to both the runner logger and the real-time event log stream.
func (r *Runner) logStartupSummary(profiles []swagger.FuzzingProfile) {
	if r.config == nil {
		return
	}

	target := r.config.BaseURL
	isMCP := r.config.MCPServer != nil
	if target == "" && isMCP {
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
	etaStr := estimateScanDuration(plannedTotal, r.config.Settings.Concurrency, r.config.Settings.DelayBetweenRequestMs, isMCP)
	if r.config.Settings.MaxScanDurationMin > 0 {
		etaStr = fmt.Sprintf("%s (Max Limit: %dm)", etaStr, r.config.Settings.MaxScanDurationMin)
	}

	r.logInfo("════════════════════════════════════════════════════════════════")
	r.logInfo("🚀 Swazz Fuzzing Scan Starting")
	r.logInfo("⚙️  Runtime & Engine:     Go %s (%s/%s) | %s | SSRF: %s",
		runtime.Version(), runtime.GOOS, runtime.GOARCH, r.getLicenseSummary(), r.getSSRFSummary())
	if isMCP {
		var toolCount, resCount, promptCount int
		for _, ep := range r.config.Endpoints {
			switch ep.Method {
			case "CALL":
				toolCount++
			case "READ":
				resCount++
			case "PROMPT":
				promptCount++
			default:
				if strings.HasPrefix(ep.Path, "mcp://tool/") {
					toolCount++
				} else if strings.HasPrefix(ep.Path, "mcp://resource/") {
					resCount++
				} else if strings.HasPrefix(ep.Path, "mcp://prompt/") {
					promptCount++
				}
			}
		}
		var breakdown []string
		if toolCount > 0 {
			breakdown = append(breakdown, fmt.Sprintf("%d tool(s)", toolCount))
		}
		if resCount > 0 {
			breakdown = append(breakdown, fmt.Sprintf("%d resource(s)", resCount))
		}
		if promptCount > 0 {
			breakdown = append(breakdown, fmt.Sprintf("%d prompt(s)", promptCount))
		}
		if len(breakdown) > 0 {
			r.logInfo("🎯 Target:               %s (%s)", target, strings.Join(breakdown, ", "))
		} else {
			r.logInfo("🎯 Target:               %s (%d endpoint(s))", target, len(r.config.Endpoints))
		}
	} else {
		r.logInfo("🎯 Target:               %s (%d endpoint(s))", target, len(r.config.Endpoints))
	}
	r.logInfo("🧬 Profiles:             %s", strings.Join(profileNames, ", "))
	r.logInfo("📊 Planned Requests:     ~%d requests (%d iter/profile) | ⏱️ ETA: %s", plannedTotal, r.config.Settings.IterationsPerProfile, etaStr)
	r.logInfo("⚡ Concurrency & Limits:  %d workers | Timeout: %dms | Delay: %dms | Max Payload: %s",
		r.config.Settings.Concurrency, r.config.Settings.TimeoutMs, r.config.Settings.DelayBetweenRequestMs, payloadSizeStr)

	// Auth & Context summary
	var authDetails []string
	if len(r.config.GlobalHeaders) > 0 {
		var headerKeys []string
		for k := range r.config.GlobalHeaders {
			headerKeys = append(headerKeys, k)
		}
		sort.Strings(headerKeys)
		var headerList []string
		for _, k := range headerKeys {
			v := r.config.GlobalHeaders[k]
			if isSensitiveHeader(k) {
				headerList = append(headerList, fmt.Sprintf("%s: %s", k, maskSensitiveString(v)))
			} else {
				headerList = append(headerList, k)
			}
		}
		authDetails = append(authDetails, fmt.Sprintf("Headers (%d: %s)", len(r.config.GlobalHeaders), strings.Join(headerList, ", ")))
	}
	if len(r.config.Cookies) > 0 {
		var cookieNames []string
		for k := range r.config.Cookies {
			cookieNames = append(cookieNames, k)
		}
		sort.Strings(cookieNames)
		authDetails = append(authDetails, fmt.Sprintf("Cookies (%d: %s)", len(r.config.Cookies), strings.Join(cookieNames, ", ")))
	}
	if len(r.config.AuthIdentities) > 0 {
		var idNames []string
		for k := range r.config.AuthIdentities {
			idNames = append(idNames, k)
		}
		sort.Strings(idNames)
		authDetails = append(authDetails, fmt.Sprintf("Identities (%d: %s)", len(r.config.AuthIdentities), strings.Join(idNames, ", ")))
	}
	if len(r.config.AuthSequence) > 0 {
		authDetails = append(authDetails, fmt.Sprintf("AuthSequence (%d steps)", len(r.config.AuthSequence)))
	}
	if len(authDetails) > 0 {
		r.logInfo("🔑 Auth & Context:       %s", strings.Join(authDetails, " | "))
	}

	// Dictionaries & Custom Wordlists summary
	var dictDetails []string
	if len(r.config.Dictionaries) > 0 {
		var dictKeys []string
		for k := range r.config.Dictionaries {
			dictKeys = append(dictKeys, k)
		}
		sort.Strings(dictKeys)
		var dictNames []string
		for _, k := range dictKeys {
			dictNames = append(dictNames, fmt.Sprintf("%s (%d entries)", k, len(r.config.Dictionaries[k])))
		}
		dictDetails = append(dictDetails, fmt.Sprintf("Dictionaries (%d: %s)", len(r.config.Dictionaries), strings.Join(dictNames, ", ")))
	}
	if len(r.config.WordlistFiles) > 0 {
		var wfKeys []string
		for k := range r.config.WordlistFiles {
			wfKeys = append(wfKeys, k)
		}
		sort.Strings(wfKeys)
		var wfNames []string
		for _, k := range wfKeys {
			wfNames = append(wfNames, fmt.Sprintf("%s=%s", k, filepath.Base(r.config.WordlistFiles[k])))
		}
		dictDetails = append(dictDetails, fmt.Sprintf("Wordlists (%d: %s)", len(r.config.WordlistFiles), strings.Join(wfNames, ", ")))
	}
	if len(dictDetails) > 0 {
		r.logInfo("📚 Payloads & Wordlists: %s", strings.Join(dictDetails, " | "))
	}

	// AI Gateway & Smart Triage
	var aiDetails []string
	if r.config.Settings.UseLLMPrepass {
		gateway := r.config.Settings.AIGatewayURL
		if gateway == "" {
			gateway = "Default AI Gateway"
		}
		aiDetails = append(aiDetails, fmt.Sprintf("LLM Pre-scan (%s)", gateway))
	}
	if r.config.Settings.EnableSmartTriage {
		maxT := r.config.Settings.MaxTriagePerScan
		if maxT <= 0 {
			maxT = 20
		}
		aiDetails = append(aiDetails, fmt.Sprintf("Smart Triage (Max: %d evaluations)", maxT))
	}
	if len(aiDetails) > 0 {
		r.logInfo("🤖 AI Services:         %s", strings.Join(aiDetails, " | "))
	}

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
		modules = append(modules, "SemanticMutation (RFC email, uuid, date-time, phone, url)")
	}
	if r.config.MCPServer != nil {
		if r.config.Settings.MCPMethodFuzzingEnabled() {
			modules = append(modules, "MCPMethodFuzz")
		}
		if r.config.Settings.MCPFuzzResourcesEnabled() {
			modules = append(modules, "MCPResourceFuzz")
		}
		if r.config.Settings.MCPFuzzPromptsEnabled() {
			modules = append(modules, "MCPPromptFuzz")
		}
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
	if r.config.Rules != nil {
		ignoreCount := len(r.config.Rules.Ignore) + len(r.config.Rules.IgnoreRules)
		if ignoreCount > 0 {
			modules = append(modules, fmt.Sprintf("IgnoreRules (%d)", ignoreCount))
		}
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

// logCompletionSummary outputs the final scan execution report (duration, requests, rps, status distribution, findings).
func (r *Runner) logCompletionSummary(stats swagger.RunStats) {
	durationStr := formatDuration(stats.TotalDurationMs)
	if durationStr == "0s" && stats.StartTime > 0 {
		durationStr = formatDuration(time.Now().UnixMilli() - stats.StartTime)
	}

	percent := 0.0
	if stats.TotalPlanned > 0 {
		percent = (float64(stats.TotalRequests) / float64(stats.TotalPlanned)) * 100
		if percent > 100.0 {
			percent = 100.0
		}
	}

	var statusParts []string
	var sortedCodes []int
	for code := range stats.StatusCounts {
		sortedCodes = append(sortedCodes, code)
	}
	sort.Ints(sortedCodes)
	for _, code := range sortedCodes {
		statusParts = append(statusParts, fmt.Sprintf("%d: %d", code, stats.StatusCounts[code]))
	}
	statusSummary := strings.Join(statusParts, " | ")
	if statusSummary == "" {
		statusSummary = "No HTTP responses recorded"
	}

	r.resultsMu.Lock()
	resultsCount := len(r.allResults)
	findingsCount := 0
	for _, res := range r.allResults {
		findingsCount += len(res.AnalyzerFindings)
	}
	r.resultsMu.Unlock()

	transferredStr := formatBytes(int(stats.TotalResponseBytes))

	r.logInfo("════════════════════════════════════════════════════════════════")
	r.logInfo("🏁 Swazz Fuzzing Scan Completed")
	r.logInfo("⏱️  Duration:           %s (Avg RPS: %.1f)", durationStr, stats.RequestsPerSec)
	r.logInfo("📊 Requests Executed:   %d / %d (%.1f%%) | Transferred: %s", stats.TotalRequests, stats.TotalPlanned, percent, transferredStr)
	r.logInfo("🛑 Status Distribution: %s", statusSummary)
	if findingsCount > 0 {
		r.logInfo("🚨 Security Findings:   %d active analyzer finding(s) discovered across %d result(s)", findingsCount, resultsCount)
	} else {
		r.logInfo("✨ Security Findings:   Clean scan (0 analyzer findings)")
	}
	r.logInfo("════════════════════════════════════════════════════════════════")
}
