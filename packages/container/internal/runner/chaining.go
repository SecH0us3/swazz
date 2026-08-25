// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"net/http"
	"regexp"

	tidwallgjson "github.com/tidwall/gjson"
)

func (r *Runner) hasChainingRuleFor(endpoint string) bool {
	r.configMu.RLock()
	defer r.configMu.RUnlock()
	for _, cr := range r.config.Settings.ChainingRules {
		if cr.SourceEndpoint == endpoint {
			return true
		}
	}
	return false
}

func (r *Runner) extractChainingVariables(endpoint string, resp *http.Response, rawBody []byte) {
	r.configMu.RLock()
	rules := r.config.Settings.ChainingRules
	r.configMu.RUnlock()

	for _, cr := range rules {
		if cr.SourceEndpoint != endpoint {
			continue
		}
		var valStr string
		switch cr.ExtractType {
		case "json":
			res := tidwallgjson.GetBytes(rawBody, cr.ExtractPath)
			if res.Exists() {
				valStr = res.String()
			}
		case "header":
			valStr = resp.Header.Get(cr.ExtractPath)
		case "regex":
			r.regexCacheMu.RLock()
			re := r.regexCache[cr.ExtractPath]
			r.regexCacheMu.RUnlock()
			if re == nil {
				compiled, err := regexp.Compile(cr.ExtractPath)
				if err == nil {
					re = compiled
					r.regexCacheMu.Lock()
					r.regexCache[cr.ExtractPath] = re
					r.regexCacheMu.Unlock()
				}
			}
			if re != nil {
				matches := re.FindSubmatch(rawBody)
				if len(matches) > 1 {
					valStr = string(matches[1])
				} else if len(matches) > 0 {
					valStr = string(matches[0])
				}
			}
		}

		if valStr != "" {
			r.stateMu.Lock()
			r.state[cr.VariableName] = valStr
			r.updateStateReplacerLocked()
			r.stateMu.Unlock()
		}
	}
}
