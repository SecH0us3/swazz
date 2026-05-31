import re

with open("/Users/alex/src/swazz/packages/container/internal/runner/bola.go", "r") as f:
    code = f.read()

replacement = """		hasPathParams := strings.Contains(cand.Endpoint, "{")

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
				if limit > 3 {
					limit = 3
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

		for _, resolvedPath := range pathsToTest {
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

				// If success, check for BOLA or Tenant Bypass
				if res.Status >= 200 && res.Status < 300 {
					res.Identity = idName
					
					if targetID != "" {
						finding := swagger.AnalysisFinding{
							RuleID:   "swazz/bola-idor",
							Level:    "error",
							Message:  fmt.Sprintf("BOLA / IDOR vulnerability confirmed. Identity %s succeeded to access resource of Identity A.", idName),
							Evidence: fmt.Sprintf("Identity: %s, Endpoint: %s %s, Status: %d", idName, cand.Method, resolvedPath, res.Status),
						}
						res.AnalyzerFindings = append(res.AnalyzerFindings, finding)
					} else {
						finding := swagger.AnalysisFinding{
							RuleID:   "swazz/tenant-isolation-bypass",
							Level:    "warning",
							Message:  fmt.Sprintf("Tenant Isolation Bypass candidate. Identity %s successfully accessed endpoint without explicit ID substitution. Manual review recommended.", idName),
							Evidence: fmt.Sprintf("Identity: %s, Endpoint: %s %s, Status: %d", idName, cand.Method, resolvedPath, res.Status),
						}
						res.AnalyzerFindings = append(res.AnalyzerFindings, finding)
					}
					bolaResults = append(bolaResults, res)
				}
			}"""

old_chunk = """		hasPathParams := strings.Contains(cand.Endpoint, "{")

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
					}
				}"""

if old_chunk in code:
    new_code = code.replace(old_chunk, replacement)
    with open("/Users/alex/src/swazz/packages/container/internal/runner/bola.go", "w") as f:
        f.write(new_code)
    print("Replaced successfully")
else:
    print("Could not find the chunk to replace")
