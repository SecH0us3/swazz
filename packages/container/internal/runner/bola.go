package runner

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"

	"swazz-engine/internal/bola"
	"swazz-engine/internal/generator"
	"swazz-engine/internal/swagger"
)

func formatIdentityName(name string) string {
	if strings.EqualFold(name, "userb") {
		return "User B"
	}
	return name
}

func getPathPrefix(originalPath string) string {
	idx := strings.IndexByte(originalPath, '{')
	if idx != -1 {
		return strings.TrimRight(originalPath[:idx], "/")
	}
	return originalPath
}

func arePrefixesRelated(p1, p2 string) bool {
	p1Trim := strings.Trim(p1, "/")
	p2Trim := strings.Trim(p2, "/")
	if p1Trim == "" || p2Trim == "" {
		return false
	}
	p1Parts := strings.Split(p1Trim, "/")
	p2Parts := strings.Split(p2Trim, "/")

	minLen := min(len(p2Parts), len(p1Parts))
	if minLen == 0 {
		return false
	}
	matchLen := 2
	if minLen < matchLen {
		matchLen = minLen
	}
	for i := 0; i < matchLen; i++ {
		if p1Parts[i] != p2Parts[i] {
			return false
		}
	}
	return true
}

func harvestIDs(data any, ids map[string]bool) {
	if m, ok := data.(map[string]any); ok {
		for k, v := range m {
			kLower := strings.ToLower(k)
			if kLower == "id" || kLower == "uuid" || strings.HasSuffix(kLower, "_id") || strings.HasSuffix(kLower, "id") {
				switch val := v.(type) {
				case string:
					if val != "" {
						ids[val] = true
					}
				case float64:
					ids[strconv.FormatFloat(val, 'f', -1, 64)] = true
				case int:
					ids[strconv.Itoa(val)] = true
				case int64:
					ids[strconv.FormatInt(val, 10)] = true
				}
			}
			harvestIDs(v, ids)
		}
	} else if arr, ok := data.([]any); ok {
		for _, item := range arr {
			harvestIDs(item, ids)
		}
	}
}

func substituteIDsInPayload(data any, paramName string, harvestedID string) any {
	if m, ok := data.(map[string]any); ok {
		newMap := make(map[string]any, len(m))
		for k, v := range m {
			kLower := strings.ToLower(k)
			if kLower == strings.ToLower(paramName) || kLower == "id" || kLower == "uuid" || strings.HasSuffix(kLower, "_id") || strings.HasSuffix(kLower, "id") {
				if _, isStr := v.(string); isStr {
					newMap[k] = harvestedID
				} else if _, isNum := v.(float64); isNum {
					if val, err := strconv.ParseFloat(harvestedID, 64); err == nil {
						newMap[k] = val
					} else {
						newMap[k] = v
					}
				} else if _, isInt := v.(int); isInt {
					if val, err := strconv.Atoi(harvestedID); err == nil {
						newMap[k] = val
					} else {
						newMap[k] = v
					}
				} else if _, isInt64 := v.(int64); isInt64 {
					if val, err := strconv.ParseInt(harvestedID, 10, 64); err == nil {
						newMap[k] = val
					} else {
						newMap[k] = v
					}
				} else {
					newMap[k] = substituteIDsInPayload(v, paramName, harvestedID)
				}
			} else {
				newMap[k] = substituteIDsInPayload(v, paramName, harvestedID)
			}
		}
		return newMap
	} else if arr, ok := data.([]any); ok {
		newArr := make([]any, len(arr))
		for i, v := range arr {
			newArr[i] = substituteIDsInPayload(v, paramName, harvestedID)
		}
		return newArr
	}
	return data
}

func extractJSONPathExtended(data any, path string) any {
	path = strings.TrimPrefix(path, "$")
	path = strings.TrimPrefix(path, ".")
	if path == "" {
		return data
	}

	parts := strings.Split(path, ".")
	var current any = data

	for i, part := range parts {
		if current == nil {
			return nil
		}
		var key = part
		var arrIdx = -1

		if start := strings.IndexByte(part, '['); start >= 0 {
			if end := strings.IndexByte(part, ']'); end > start {
				if idx, err := strconv.Atoi(part[start+1 : end]); err == nil {
					arrIdx = idx
					key = part[:start]
				}
			}
		}

		if key != "" {
			if m, ok := current.(map[string]any); ok {
				current = m[key]
			} else {
				return nil
			}
		}

		if current != nil && arrIdx >= 0 {
			if arr, ok := current.([]any); ok && arrIdx < len(arr) {
				current = arr[arrIdx]
			} else {
				return nil
			}
		}

		if current == nil {
			return nil
		}
		if i == len(parts)-1 {
			return current
		}
	}
	return nil
}

func (r *Runner) findEndpointConfig(path, method string) (swagger.EndpointConfig, bool) {
	r.configMu.RLock()
	defer r.configMu.RUnlock()
	for _, ep := range r.config.Endpoints {
		if ep.Path == path && strings.EqualFold(ep.Method, method) {
			return ep, true
		}
	}
	return swagger.EndpointConfig{}, false
}

func (r *Runner) harvestFromResponse(originalPath, method string, respStatus int, respBody any) {
	if respStatus < 200 || respStatus >= 300 || respBody == nil {
		return
	}

	ep, found := r.findEndpointConfig(originalPath, method)
	if !found {
		return
	}

	// 1. Explicit mapping
	if len(ep.ExtractVariables) > 0 {
		r.configMu.Lock()
		if r.config.Variables == nil {
			r.config.Variables = make(map[string]any)
		}
		varsUpdated := false
		for jsonPath, varName := range ep.ExtractVariables {
			val := extractJSONPathExtended(respBody, jsonPath)
			if val != nil {
				r.config.Variables[varName] = val
				varsUpdated = true
				if r.config.Settings.Debug {
					fmt.Printf("[BOLA] Extracted variable %s = %v from response of %s %s\n", varName, val, method, originalPath)
				}
			}
		}
		r.configMu.Unlock()
		if varsUpdated {
			r.updateReplacer()
		}
	}

	// 2. Heuristic Harvesting
	prefix := getPathPrefix(originalPath)
	harvested := make(map[string]bool)
	harvestIDs(respBody, harvested)
	if len(harvested) > 0 {
		actualSlice := []string{}
		for id := range harvested {
			actualSlice = append(actualSlice, id)
			r.idSources.Store(id, fmt.Sprintf("%s %s", method, originalPath))
		}
		r.resultsMu.Lock()
		if val, ok := r.harvestedIDs.Load(prefix); ok {
			existing := val.([]string)
			uniqueMap := make(map[string]bool)
			for _, id := range existing {
				uniqueMap[id] = true
			}
			for _, id := range actualSlice {
				uniqueMap[id] = true
			}
			merged := []string{}
			for id := range uniqueMap {
				merged = append(merged, id)
			}
			r.harvestedIDs.Store(prefix, merged)
		} else {
			r.harvestedIDs.Store(prefix, actualSlice)
		}
		r.resultsMu.Unlock()
		if r.config.Settings.Debug {
			fmt.Printf("[BOLA] Harvested IDs for prefix %s: %v\n", prefix, actualSlice)
		}
	}
}

func extractParamsFromPath(originalPath, resolvedPath string) map[string]string {
	params := make(map[string]string)
	origParts := strings.Split(strings.Trim(originalPath, "/"), "/")
	resolParts := strings.Split(strings.Trim(resolvedPath, "/"), "/")
	if len(origParts) != len(resolParts) {
		return params
	}
	for i, part := range origParts {
		if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
			paramName := part[1 : len(part)-1]
			params[paramName] = resolParts[i]
		}
	}
	return params
}

func (r *Runner) bolaPhase(ctx context.Context, results []*swagger.FuzzResult) []*swagger.FuzzResult {
	if !r.config.Settings.BOLATesting {
		return nil
	}

	concurrency := r.config.Settings.Concurrency
	if concurrency <= 0 {
		concurrency = 5
	}
	if concurrency > 1000 {
		fmt.Printf("BOLA: Concurrency limit exceeded (max 1000)\n")
		return nil
	}
	r.limiter.SetTarget(concurrency)

	r.currentProfile.Store("BOLA")
	r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})

	fmt.Println("Running Access Control & BOLA/IDOR testing phase...")

	// 1. Authenticate user identities (Identity B)
	identityHeaders := make(map[string]map[string]string)
	identityCookies := make(map[string]map[string]string)
	for idName, identity := range r.config.AuthIdentities {
		h, c, err := r.ExecuteAuthSequence(ctx, identity.AuthSequence, identity.Headers, identity.Cookies)
		if err != nil {
			fmt.Printf("BOLA: Failed to authenticate identity %s: %v\n", idName, err)
			continue
		}
		identityHeaders[idName] = h
		identityCookies[idName] = c
	}

	// 2. Identify candidates (successful 2xx requests)
	var candidates []*swagger.FuzzResult
	hasSuccessCandidate := make(map[string]bool)
	for _, res := range results {
		if res.Status >= 200 && res.Status < 300 {
			candidates = append(candidates, res)
			hasSuccessCandidate[strings.ToUpper(res.Method)+" "+res.Endpoint] = true
		}
	}

	// For endpoints that don't have a successful candidate, try to construct one
	safeGen := generator.New(r.config.Dictionaries, swagger.ProfileRandom, r.config.Settings)

	// Calculate and add numCandidatesToSearch to totalEndpoints
	var numCandidatesToSearch int
	for _, ep := range r.config.Endpoints {
		key := strings.ToUpper(ep.Method) + " " + ep.Path
		if !hasSuccessCandidate[key] {
			numCandidatesToSearch++
		}
	}
	r.totalEndpoints.Add(int32(numCandidatesToSearch))
	r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})

	var candMu sync.Mutex
	var candWg sync.WaitGroup

	for _, ep := range r.config.Endpoints {
		key := strings.ToUpper(ep.Method) + " " + ep.Path
		if hasSuccessCandidate[key] {
			continue
		}

		candWg.Add(1)
		r.limiter.Acquire()

		go func(ep swagger.EndpointConfig) {
			defer r.limiter.Release()
			defer candWg.Done()

			epKey := ep.Method + " " + ep.Path
			r.currentEndpoint.Store(epKey)
			r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})

			key := strings.ToUpper(ep.Method) + " " + ep.Path
			if hasSuccessCandidate[key] {
				r.completedEndpoints.Add(1)
				r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})
				return
			}

			var harvested []string
			hasPathParams := strings.Contains(ep.Path, "{")

			// We want to try finding a valid candidate by trying harvested IDs
			uniqueIDs := make(map[string]bool)
			r.harvestedIDs.Range(func(k, value any) bool {
				vSlice := value.([]string)
				for _, id := range vSlice {
					uniqueIDs[id] = true
				}
				return true
			})
			for id := range uniqueIDs {
				harvested = append(harvested, id)
			}

			// First, generate baseline payload
			var generated map[string]any
			if len(ep.Schema.Properties) > 0 || ep.Schema.Type == "array" || ep.Schema.Type == "object" {
				generated = safeGen.BuildObject(&ep.Schema)
			}

			var paramName string
			if hasPathParams {
				origParts := strings.Split(strings.Trim(ep.Path, "/"), "/")
				for _, part := range origParts {
					if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
						paramName = part[1 : len(part)-1]
						break
					}
				}
			} else if generated != nil {
				for k := range generated {
					kLower := strings.ToLower(k)
					if kLower == "id" || kLower == "uuid" || strings.HasSuffix(kLower, "id") {
						paramName = k
						break
					}
				}
			}

			limit := len(harvested)
			if limit > 25 {
				limit = 25 // brute force up to 25 harvested IDs
			}
			if limit == 0 {
				limit = 1 // try at least once (with random/empty ID)
			}

			var successRes *swagger.FuzzResult

			for i := 0; i < limit; i++ {
				resolvedPath := ep.Path
				if hasPathParams && len(harvested) > 0 {
					origParts := strings.Split(strings.Trim(ep.Path, "/"), "/")
					resolParts := make([]string, len(origParts))
					copy(resolParts, origParts)
					for idx, part := range origParts {
						if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
							kLower := strings.ToLower(part[1 : len(part)-1])
							if kLower == "id" || kLower == "uuid" || strings.HasSuffix(kLower, "id") {
								resolParts[idx] = harvested[i]
							}
						}
					}
					resolvedPath = "/" + strings.Join(resolParts, "/")
				} else if hasPathParams {
					// No harvested IDs available, try with a safe generated value
					origParts := strings.Split(strings.Trim(ep.Path, "/"), "/")
					resolParts := make([]string, len(origParts))
					copy(resolParts, origParts)
					for idx, part := range origParts {
						if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
							kLower := strings.ToLower(part[1 : len(part)-1])
							if kLower == "id" || kLower == "uuid" || strings.HasSuffix(kLower, "id") {
								resolParts[idx] = "1"
							}
						}
					}
					resolvedPath = "/" + strings.Join(resolParts, "/")
				} else if ep.Example != nil {
					resolvedPath = ep.Path
				}

				var payload any
				var queryParams map[string]any

				if generated != nil {
					genCopy := make(map[string]any)
					for k, v := range generated {
						genCopy[k] = v
					}
					if paramName != "" && len(harvested) > 0 && i < len(harvested) {
						substituted := substituteIDsInPayload(genCopy, paramName, harvested[i])
						if m, ok := substituted.(map[string]any); ok {
							genCopy = m
						}
					}
					if isNoBodyMethod(ep.Method) {
						queryParams = genCopy
					} else {
						payload = genCopy
					}
				} else if ep.Example != nil {
					if isNoBodyMethod(ep.Method) {
						if m, ok := ep.Example.(map[string]any); ok {
							queryParams = m
						}
					} else {
						payload = ep.Example
					}
				}

				// Generate security headers if any
				generatedHeaders := make(map[string]string)
				if secHeaders := safeGen.GenerateSecurityHeaders(); secHeaders != nil {
					for k, v := range secHeaders {
						generatedHeaders[k] = v
					}
				}

				// Build final headers
				headers := make(map[string]string)
				r.configMu.RLock()
				for k, v := range r.config.GlobalHeaders {
					headers[k] = v
				}
				r.configMu.RUnlock()
				for k, v := range generatedHeaders {
					headers[k] = v
				}

				// Increment totalPlanned dynamically before executing
				r.totalPlanned.Add(1)

				// Execute request under User A (Primary)
				resUserA := r.executeRequest(
					ctx,
					r.config.BaseURL,
					resolvedPath,
					ep.Path,
					ep.Method,
					headers,
					r.config.Cookies,
					payload,
					swagger.FuzzingProfile("BOLA"),
					queryParams,
					nil,
					ep.ContentType,
				)
				resUserA.Identity = "User A"

				r.statsChan <- statsMsg{
					result:           resUserA,
					currentIteration: i + 1,
					totalIterations:  limit,
				}
				r.Broadcast(Event{Type: EventResult, Data: resUserA})

				if resUserA.Status >= 200 && resUserA.Status < 300 {
					successRes = resUserA
					break
				}
				if successRes == nil {
					successRes = resUserA
				}
			}

			if successRes != nil {
				candMu.Lock()
				candidates = append(candidates, successRes)
				candMu.Unlock()
			}

			r.completedEndpoints.Add(1)
			r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})
		}(ep)
	}
	candWg.Wait()

	var bolaResults []*swagger.FuzzResult
	var bolaMu sync.Mutex
	var bolaWg sync.WaitGroup

	// Calculate and add len(candidates) to totalEndpoints
	r.totalEndpoints.Add(int32(len(candidates)))
	r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})

	// 3. Replay requests
	for _, cand := range candidates {
		bolaWg.Add(1)
		r.limiter.Acquire()

		go func(cand *swagger.FuzzResult) {
			defer r.limiter.Release()
			defer bolaWg.Done()

			epKey := cand.Method + " " + cand.Endpoint
			r.currentEndpoint.Store(epKey)
			r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})

			ep, found := r.findEndpointConfig(cand.Endpoint, cand.Method)
			if !found {
				r.completedEndpoints.Add(1)
				r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})
				return
			}

			hasPathParams := strings.Contains(cand.Endpoint, "{")

			// Replay for each harvested ID (or use candidate's resolved path if none harvested or static)
			pathsToTest := []string{cand.ResolvedPath}
			pathToID := make(map[string]string)
			pathToID[cand.ResolvedPath] = ""

			var paramName string
			if hasPathParams {
				origParts := strings.Split(strings.Trim(cand.Endpoint, "/"), "/")
				for _, part := range origParts {
					if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
						paramName = part[1 : len(part)-1]
						break
					}
				}
			} else {
				if m, ok := cand.Payload.(map[string]any); ok {
					for k := range m {
						kLower := strings.ToLower(k)
						if kLower == "id" || kLower == "uuid" || strings.HasSuffix(kLower, "id") {
							paramName = k
							break
						}
					}
				}
			}

			if paramName != "" {
				uniqueIDs := make(map[string]bool)
				r.harvestedIDs.Range(func(key, value any) bool {
					vSlice := value.([]string)
					for _, id := range vSlice {
						uniqueIDs[id] = true
					}
					return true
				})

				var harvested []string
				for id := range uniqueIDs {
					harvested = append(harvested, id)
				}

				if len(harvested) > 0 {
					limit := len(harvested)
					if limit > 25 {
						limit = 25
					}
					for i := 0; i < limit; i++ {
						newResolvedPath := cand.ResolvedPath
						if hasPathParams {
							origParts := strings.Split(strings.Trim(cand.Endpoint, "/"), "/")
							resolParts := strings.Split(strings.Trim(cand.ResolvedPath, "/"), "/")
							if len(origParts) == len(resolParts) {
								for idx, part := range origParts {
									if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
										kLower := strings.ToLower(part[1 : len(part)-1])
										if kLower == "id" || kLower == "uuid" || strings.HasSuffix(kLower, "id") {
											resolParts[idx] = harvested[i]
										}
									}
								}
								newResolvedPath = "/" + strings.Join(resolParts, "/")
							}
						}

						foundDuplicate := false
						for _, p := range pathsToTest {
							if p == newResolvedPath && pathToID[p] == harvested[i] {
								foundDuplicate = true
								break
							}
						}
						if !foundDuplicate {
							pathsToTest = append(pathsToTest, newResolvedPath)
							pathToID[newResolvedPath] = harvested[i]
						}
					}
				}
			}

			confirmedIdentities := make(map[string]bool)

			for _, resolvedPath := range pathsToTest {
				// Check if we have already confirmed bypass for all identities and anonymous
				allDone := true
				for idName := range identityHeaders {
					if !confirmedIdentities[idName] {
						allDone = false
						break
					}
				}
				if !confirmedIdentities["Anonymous"] {
					allDone = false
				}
				if allDone {
					break
				}

				// Determine request payload and query params (substituting current path ID if needed)
				var qp map[string]any
				var pl any
				targetID := pathToID[resolvedPath]

				if isNoBodyMethod(cand.Method) {
					if m, ok := cand.Payload.(map[string]any); ok {
						if targetID != "" && paramName != "" {
							substituted := substituteIDsInPayload(m, paramName, targetID)
							if subMap, ok := substituted.(map[string]any); ok {
								qp = subMap
							} else {
								qp = m
							}
						} else {
							qp = m
						}
					}
				} else {
					if targetID != "" && paramName != "" && cand.Payload != nil {
						pl = substituteIDsInPayload(cand.Payload, paramName, targetID)
					} else {
						pl = cand.Payload
					}
				}

				// Replay for each identity B (Always run to check for Tenant Bypass)
				for idName, headers := range identityHeaders {
					if confirmedIdentities[idName] {
						continue
					}
					cookies := identityCookies[idName]

					// Increment totalPlanned dynamically before executing
					r.totalPlanned.Add(1)

					// Execute request
					res := r.executeRequest(
						ctx,
						r.config.BaseURL,
						resolvedPath,
						cand.Endpoint,
						cand.Method,
						headers,
						cookies,
						pl,
						swagger.FuzzingProfile("BOLA"),
						qp,
						nil,
						ep.ContentType,
					)

					r.statsChan <- statsMsg{
						result:           res,
						currentIteration: 1,
						totalIterations:  1,
					}

					// If success, check for BOLA or Tenant Bypass
					if res.Status >= 200 && res.Status < 300 {
						bodyCand := responseBodyToBytes(cand.ResponseBody)
						bodyRes := responseBodyToBytes(res.ResponseBody)
						sim := bola.CheckSimilarity(bodyCand, bodyRes)

						threshold := r.config.Settings.BOLASimilarityThreshold
						if threshold <= 0 {
							threshold = 0.85
						}

						if sim >= threshold {
							formattedName := formatIdentityName(idName)
							res.Identity = formattedName
							confirmedIdentities[idName] = true

							if targetID != "" || paramName != "" {
								minedFrom := "Unknown"
								if targetID != "" {
									if src, ok := r.idSources.Load(targetID); ok {
										minedFrom = src.(string)
									}
								}
								finding := swagger.AnalysisFinding{
									RuleID:   "swazz/bola-idor",
									Level:    "error",
									Message:  fmt.Sprintf("BOLA / IDOR vulnerability confirmed. Identity %s succeeded to access resource of Identity A.", formattedName),
									Evidence: fmt.Sprintf("Identity: %s, Endpoint: %s %s, Status: %d, ID %s mined from: %s (Similarity: %.2f)", formattedName, cand.Method, resolvedPath, res.Status, targetID, minedFrom, sim),
								}
								res.AnalyzerFindings = append(res.AnalyzerFindings, finding)
							} else {
								finding := swagger.AnalysisFinding{
									RuleID:   "swazz/tenant-isolation-bypass",
									Level:    "warning",
									Message:  fmt.Sprintf("Tenant Isolation Bypass candidate. Identity %s successfully accessed endpoint normally used by Identity A.", formattedName),
									Evidence: fmt.Sprintf("Identity: %s, Endpoint: %s %s, Status: %d (Similarity: %.2f)", formattedName, cand.Method, resolvedPath, res.Status, sim),
								}
								res.AnalyzerFindings = append(res.AnalyzerFindings, finding)
							}
							bolaMu.Lock()
							bolaResults = append(bolaResults, res)
							bolaMu.Unlock()
						}
					}

					r.Broadcast(Event{
						Type: EventResult,
						Data: res,
					})
				}

				// 4. Anonymous access check
				if !confirmedIdentities["Anonymous"] {
					anonHeaders := make(map[string]string)
					anonCookies := make(map[string]string)

					// Determine auth keys to drop
					dropHeaders := r.config.Settings.AuthHeaders
					if len(dropHeaders) == 0 {
						dropHeaders = []string{"Authorization", "X-API-Key"}
					}
					dropCookies := r.config.Settings.AuthCookies
					if len(dropCookies) == 0 {
						dropCookies = []string{"session", "token", "jwt", "sid", "JSESSIONID", "PHPSESSID"}
					}

					r.configMu.RLock()
					// Copy global headers except those to drop
					for k, v := range r.config.GlobalHeaders {
						shouldDrop := false
						for _, drop := range dropHeaders {
							if strings.EqualFold(k, drop) {
								shouldDrop = true
								break
							}
						}
						if !shouldDrop {
							anonHeaders[k] = v
						}
					}

					// Copy cookies except those to drop
					for k, v := range r.config.Cookies {
						shouldDrop := false
						for _, drop := range dropCookies {
							if strings.EqualFold(k, drop) {
								shouldDrop = true
								break
							}
						}
						if !shouldDrop {
							anonCookies[k] = v
						}
					}
					r.configMu.RUnlock()

					// Increment totalPlanned dynamically before executing
					r.totalPlanned.Add(1)

					resAnon := r.executeRequest(
						ctx,
						r.config.BaseURL,
						resolvedPath,
						cand.Endpoint,
						cand.Method,
						anonHeaders,
						anonCookies,
						pl,
						swagger.FuzzingProfile("BOLA"),
						qp,
						nil,
						ep.ContentType,
					)

					r.statsChan <- statsMsg{
						result:           resAnon,
						currentIteration: 1,
						totalIterations:  1,
					}

					if resAnon.Status >= 200 && resAnon.Status < 300 {
						bodyCand := responseBodyToBytes(cand.ResponseBody)
						bodyAnon := responseBodyToBytes(resAnon.ResponseBody)
						sim := bola.CheckSimilarity(bodyCand, bodyAnon)

						threshold := r.config.Settings.BOLASimilarityThreshold
						if threshold <= 0 {
							threshold = 0.85
						}

						if sim >= threshold {
							resAnon.Identity = "Anonymous"
							confirmedIdentities["Anonymous"] = true

							minedFrom := "Unknown"
							if targetID != "" {
								if src, ok := r.idSources.Load(targetID); ok {
									minedFrom = src.(string)
								}
							}

							evidenceStr := fmt.Sprintf("Endpoint: %s %s, Status: %d (Similarity: %.2f)", cand.Method, resolvedPath, resAnon.Status, sim)
							if targetID != "" {
								evidenceStr = fmt.Sprintf("Endpoint: %s %s, Status: %d, ID %s mined from: %s (Similarity: %.2f)", cand.Method, resolvedPath, resAnon.Status, targetID, minedFrom, sim)
							}

							finding := swagger.AnalysisFinding{
								RuleID:   "swazz/unauthorized-access",
								Level:    "error",
								Message:  "Unauthenticated access bypass vulnerability confirmed. Endpoint accepts requests without authentication credentials.",
								Evidence: evidenceStr,
							}
							bolaMu.Lock()
							resAnon.AnalyzerFindings = append(resAnon.AnalyzerFindings, finding)
							bolaResults = append(bolaResults, resAnon)
							bolaMu.Unlock()
						}
					}

					r.Broadcast(Event{
						Type: EventResult,
						Data: resAnon,
					})
				}
			}

			r.completedEndpoints.Add(1)
			r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})
		}(cand)
	}
	bolaWg.Wait()

	fmt.Printf("Access Control phase complete. Found %d findings.\n", len(bolaResults))
	return bolaResults
}

func responseBodyToBytes(body any) []byte {
	if body == nil {
		return nil
	}
	switch v := body.(type) {
	case []byte:
		return v
	case string:
		return []byte(v)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return nil
		}
		return b
	}
}
