// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"math"
	"time"

	"swazz-engine/internal/wafcheck"
)

func (r *Runner) runPreScanWAFCheck(ctx context.Context) {
	if !r.config.Settings.WAFCheckEnabled() || r.config.BaseURL == "" {
		return
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	client := wafcheck.NewClient(r.config.Settings.WAFCheckEndpoint)
	result, err := client.Detect(timeoutCtx, r.config.BaseURL)
	if err != nil {
		r.logWarn("[WAF] ⚠️ WAF check failed: %v", err)
		return
	}
	r.wafCheckResult.Store(result)
	if result.Detection.Detected {
		r.logInfo("[WAF] 🛡️ Detected %s ahead of scan (confidence %.0f%%)", result.Detection.WAFType, math.Min(100, result.Detection.Confidence))
	} else {
		r.logInfo("[WAF] No WAF detected ahead of scan")
	}
}
