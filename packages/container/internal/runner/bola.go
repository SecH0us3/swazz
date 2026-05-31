package runner

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"swazz-engine/internal/generator"
	"swazz-engine/internal/swagger"
)

func getPathPrefix(originalPath string) string {
	idx := strings.IndexByte(originalPath, '{')
	if idx != -1 {
		return strings.TrimRight(originalPath[:idx], "/")
	}
	return originalPath
}

func arePrefixesRelated(p1, p2 string) bool {
	p1Parts := strings.Split(strings.Trim(p1, "/"), "/")
	p2Parts := strings.Split(strings.Trim(p2, "/"), "/")
	
	if len(p1Parts) < 2 || len(p2Parts) < 2 {
		return strings.HasPrefix(p1, p2) || strings.HasPrefix(p2, p1)
	}
	
	return p1Parts[0] == p2Parts[0] && p1Parts[1] == p2Parts[1]
}

func harvestIDs(data any, ids map[string]bool) {
	if m, ok := data.(map[string]any); ok {
		for k, v := range m {
			kLower := strings.ToLower(k)
			if kLower == "id" || kLower == "uuid" || strings.HasSuffix(kLower, "_id") || strings.HasSuffix(kLower, "id") {
				if s, ok := v.(string); ok && s != "" {
					ids[s] = true
				} else if f, ok := v.(float64); ok {
					ids[strconv.FormatFloat(f, 'f', -1, 64)] = true
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
		}
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
			hasSuccessCandidate[strings.ToUpper(res.Method) + " " + res.Endpoint] = true
		}
	}

	// For endpoints that don't have a successful candidate, try to construct one
	safeGen := generator.New(r.config.Dictionaries, swagger.ProfileRandom, r.config.Settings)
	for _, ep := range r.config.Endpoints {
		key := strings.ToUpper(ep.Method) + " " + ep.Path
		if hasSuccessCandidate[key] {
			continue
		}

		var resolvedPath string
		var harvested []string
		hasPathParams := strings.Contains(ep.Path, "{")

		if hasPathParams {
			// Check if we have any harvested IDs
			uniqueIDs := make(map[string]bool)
			r.harvestedIDs.Range(func(k, value any) bool {
				vSlice := value.([]string)
				// Bypassed prefix matching: try all harvested IDs across all paths
				for _, id := range vSlice {
					uniqueIDs[id] = true
				}
				return true
			})
			for id := range uniqueIDs {
				harvested = append(harvested, id)
			}

			if len(harvested) == 0 {
				continue
			}

			// Try the first harvested ID to see if we can get a successful 2xx request under User A (Primary)
			origParts := strings.Split(strings.Trim(ep.Path, "/"), "/")
			resolParts := make([]string, len(origParts))
			copy(resolParts, origParts)
			for idx, part := range origParts {
				if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
					paramName := part[1 : len(part)-1]
					kLower := strings.ToLower(paramName)
					if kLower == "id" || kLower == "uuid" || strings.HasSuffix(kLower, "id") {
						resolParts[idx] = harvested[0]
					}
				}
			}
			resolvedPath = "/" + strings.Join(resolParts, "/")
		} else {
			// Static endpoint, but only construct baseline if an example is explicitly provided
			if ep.Example == nil {
				continue
			}
			resolvedPath = ep.Path
		}

		// Generate baseline payload / query params using ep.Example or safeGen
		var payload any
		var queryParams map[string]any

		if ep.Example != nil {
			isBody := !isNoBodyMethod(ep.Method)
			if isBody {
				payload = ep.Example
			} else {
				if m, ok := ep.Example.(map[string]any); ok {
					queryParams = m
				}
			}
		} else {
			var generated map[string]any
			if len(ep.Schema.Properties) > 0 || ep.Schema.Type == "array" || ep.Schema.Type == "object" {
				generated = safeGen.BuildObject(&ep.Schema)
			}
			if len(harvested) > 0 {
				paramName := ""
				origParts := strings.Split(strings.Trim(ep.Path, "/"), "/")
				for _, part := range origParts {
					if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
						paramName = part[1 : len(part)-1]
						break
					}
				}
				if generated != nil {
					substituted := substituteIDsInPayload(generated, paramName, harvested[0])
					if m, ok := substituted.(map[string]any); ok {
						generated = m
					}
				}
			}
			if isNoBodyMethod(ep.Method) {
				queryParams = generated
			} else {
				payload = generated
			}
		}

		// Merge security headers if any
		generatedHeaders := make(map[string]string)
		if secHeaders := safeGen.GenerateSecurityHeaders(); secHeaders != nil {
			for k, v := range secHeaders {
				generatedHeaders[k] = v
			}
		}

		// Build final headers (merging generated headers with config global headers)
		headers := make(map[string]string)
		for k, v := range r.config.GlobalHeaders {
			headers[k] = v
		}
		for k, v := range generatedHeaders {
			headers[k] = v
		}

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

		if resUserA.Status >= 200 && resUserA.Status < 300 {
			resUserA.Identity = "User A" // explicitly mark as User A
			candidates = append(candidates, resUserA)

			// Broadcast event so it shows up in Request Logs under User A
			r.Broadcast(Event{
				Type: EventResult,
				Data: resUserA,
			})
		}
	}

	var bolaResults []*swagger.FuzzResult

	// 3. Replay requests
	for _, cand := range candidates {
		ep, found := r.findEndpointConfig(cand.Endpoint, cand.Method)
		if !found {
			continue
		}

		hasPathParams := strings.Contains(cand.Endpoint, "{")

		// Replay for each harvested ID (or use candidate's resolved path if none harvested or static)
		pathsToTest := []string{cand.ResolvedPath}
		pathToID := make(map[string]string)
		pathToID[cand.ResolvedPath] = ""

		if hasPathParams {
			uniqueIDs := make(map[string]bool)
			r.harvestedIDs.Range(func(key, value any) bool {
				vSlice := value.([]string)
				// Bypassed prefix matching: try all harvested IDs across all paths
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
				if limit > 3 {
					limit = 3
				}
				for i := 0; i < limit; i++ {
					origParts := strings.Split(strings.Trim(cand.Endpoint, "/"), "/")
					resolParts := strings.Split(strings.Trim(cand.ResolvedPath, "/"), "/")
					if len(origParts) == len(resolParts) {
						var paramName string
						for idx, part := range origParts {
							if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
								paramName = part[1 : len(part)-1]
								kLower := strings.ToLower(paramName)
								if kLower == "id" || kLower == "uuid" || strings.HasSuffix(kLower, "id") {
									resolParts[idx] = harvested[i]
								}
							}
						}
						newResolvedPath := "/" + strings.Join(resolParts, "/")
						foundDuplicate := false
						for _, p := range pathsToTest {
							if p == newResolvedPath {
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
		}

		for _, resolvedPath := range pathsToTest {
			// Determine request payload and query params (substituting current path ID if needed)
			var qp map[string]any
			var pl any
			targetID := pathToID[resolvedPath]

			// Get the parameter name to substitute in body
			paramName := ""
			if hasPathParams {
				origParts := strings.Split(strings.Trim(cand.Endpoint, "/"), "/")
				for _, part := range origParts {
					if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
						paramName = part[1 : len(part)-1]
						break
					}
				}
			}

			if isNoBodyMethod(cand.Method) {
				if m, ok := cand.Payload.(map[string]any); ok {
					if targetID != "" {
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
				if targetID != "" && cand.Payload != nil {
					pl = substituteIDsInPayload(cand.Payload, paramName, targetID)
				} else {
					pl = cand.Payload
				}
			}

			// Replay for each identity B (only if it has path params, i.e., BOLA IDOR check)
			if hasPathParams {
				for idName, headers := range identityHeaders {
					cookies := identityCookies[idName]

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

					// If success, we have BOLA!
					if res.Status >= 200 && res.Status < 300 {
						res.Identity = idName
						finding := swagger.AnalysisFinding{
							RuleID:   "swazz/bola-idor",
							Level:    "error",
							Message:  fmt.Sprintf("BOLA / IDOR vulnerability confirmed. Identity %s succeeded to access resource of Identity A.", idName),
							Evidence: fmt.Sprintf("Identity: %s, Endpoint: %s %s, Status: %d", idName, cand.Method, resolvedPath, res.Status),
						}
						res.AnalyzerFindings = append(res.AnalyzerFindings, finding)
						bolaResults = append(bolaResults, res)

						// Broadcast event
						r.Broadcast(Event{
							Type: EventResult,
							Data: res,
						})
					}
				}
			}

			// 4. Anonymous access check
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

			if resAnon.Status >= 200 && resAnon.Status < 300 {
				resAnon.Identity = "Anonymous"
				finding := swagger.AnalysisFinding{
					RuleID:   "swazz/unauthorized-access",
					Level:    "error",
					Message:  "Unauthenticated access bypass vulnerability confirmed. Endpoint accepts requests without authentication credentials.",
					Evidence: fmt.Sprintf("Endpoint: %s %s, Status: %d", cand.Method, resolvedPath, resAnon.Status),
				}
				resAnon.AnalyzerFindings = append(resAnon.AnalyzerFindings, finding)
				bolaResults = append(bolaResults, resAnon)

				// Broadcast event
				r.Broadcast(Event{
					Type: EventResult,
					Data: resAnon,
				})
			}
		}
	}

	fmt.Printf("Access Control phase complete. Found %d findings.\n", len(bolaResults))
	return bolaResults
}
