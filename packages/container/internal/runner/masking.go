// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"math/rand"
	"strings"
	"sync/atomic"
)

// sensitiveKeyPatterns contains patterns for keys that may contain sensitive data
var sensitiveKeyPatterns = []string{
	"password", "passwd", "pwd", "secret", "token", "api_key", "apikey",
	"api-key", "auth", "authorization", "bearer", "credential", "private",
	"access", "key", "session", "cookie", "csrf", "xsrf",
}

// maskSensitiveArgs masks potentially sensitive values in arguments map
func maskSensitiveArgs(args map[string]any) map[string]any {
	if args == nil {
		return nil
	}
	masked := make(map[string]any, len(args))
	for k, v := range args {
		keyLower := strings.ToLower(k)
		isSensitive := false
		for _, pattern := range sensitiveKeyPatterns {
			if strings.Contains(keyLower, pattern) {
				isSensitive = true
				break
			}
		}
		if isSensitive {
			masked[k] = "[REDACTED]"
		} else if m, ok := v.(map[string]any); ok {
			masked[k] = maskSensitiveArgs(m)
		} else {
			masked[k] = v
		}
	}
	return masked
}

var (
	proxyCounter uint32
	userAgents   = []string{
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5.2 Safari/605.1.15",
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
	}
)

func getRandomUserAgent() string {
	// #nosec G404 -- Randomness here is just for user agent rotation, not security
	return userAgents[rand.Intn(len(userAgents))]
}

func getNextProxy(proxies []string) string {
	if len(proxies) == 0 {
		return ""
	}
	idx := atomic.AddUint32(&proxyCounter, 1)
	// #nosec G115 -- Length of proxies list will never exceed max uint32
	return proxies[idx%uint32(len(proxies))]
}
