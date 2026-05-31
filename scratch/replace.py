import sys

with open("/Users/alex/src/swazz/packages/container/internal/runner/bola.go", "r") as f:
    code = f.read()

start_marker = 'hasPathParams := strings.Contains(ep.Path, "{")'
end_marker = 'var bolaResults []*swagger.FuzzResult'

start_idx = code.find(start_marker)
end_idx = code.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print("Could not find markers")
    sys.exit(1)

prefix = code[:start_idx]
suffix = code[end_idx:]

replacement = """hasPathParams := strings.Contains(ep.Path, "{")

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
		if limit > 5 {
			limit = 5 // try up to 5 harvested IDs
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
						resolParts[idx] = harvested[i]
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
						resolParts[idx] = "1"
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
				successRes = resUserA
				break
			}
		}

		if successRes != nil {
			successRes.Identity = "User A" // explicitly mark as User A
			candidates = append(candidates, successRes)

			// Broadcast event so it shows up in Request Logs under User A
			r.Broadcast(Event{
				Type: EventResult,
				Data: successRes,
			})
		}
	}

	"""

new_code = prefix + replacement + suffix
with open("/Users/alex/src/swazz/packages/container/internal/runner/bola.go", "w") as f:
    f.write(new_code)
print("Replaced perfectly.")
