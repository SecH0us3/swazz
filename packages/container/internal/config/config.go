// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package config

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"swazz-engine/internal/graphql"
	"swazz-engine/internal/grpc"
	"swazz-engine/internal/har"
	"swazz-engine/internal/logger"
	"swazz-engine/internal/mcp"
	"swazz-engine/internal/postman"
	"swazz-engine/internal/proto"
	"swazz-engine/internal/safenet"
	"swazz-engine/internal/swagger"
	"swazz-engine/internal/ws"
)
type CliConfig struct {
	SwaggerURLs         []string                `json:"swagger_urls"`
	SwaggerURLsAlias    []string                `json:"_swagger_urls"`
	BaseURL             string                  `json:"base_url"`
	Headers             map[string]string       `json:"headers"`
	GlobalHeaders       map[string]string       `json:"global_headers"`
	Cookies             map[string]string       `json:"cookies"`
	WordlistFiles       map[string]string       `json:"wordlist_files"`
	Dictionaries        map[string][]any        `json:"dictionaries"`
	Settings            swagger.Settings        `json:"settings"`
	Endpoints           *struct {
		Include []string `json:"include"`
		Exclude []string `json:"exclude"`
	} `json:"endpoints"`
	// EndpointDefinitions holds pre-parsed endpoints (e.g. from browser extension HAR capture).
	// When populated, swagger_url is not required — the runner uses these directly.
	EndpointDefinitions []swagger.EndpointConfig         `json:"endpoint_definitions,omitempty"`
	DisabledEndpoints   []string                         `json:"disabled_endpoints"`
	Rules               *swagger.RulesConfig             `json:"rules"`
	AuthSequence        []swagger.AuthStep               `json:"auth_sequence"`
	AuthIdentities      map[string]swagger.AuthIdentity  `json:"auth_identities,omitempty"`
	Variables           map[string]any                   `json:"variables,omitempty"`
	Security            swagger.SecurityConfig           `json:"security"`
	MCPServer           *swagger.MCPServerConfig         `json:"mcp_server,omitempty"`
	LicenseKey          string                           `json:"license_key,omitempty"`
}

func (c *CliConfig) Validate() error {
	if err := c.Settings.Validate(); err != nil {
		return err
	}
	if err := swagger.ValidateBaseURL(c.BaseURL); err != nil {
		return err
	}
	return nil
}

func (c *CliConfig) UnmarshalJSON(data []byte) error {
	type alias CliConfig
	var aux struct {
		*alias
		Endpoints json.RawMessage `json:"endpoints"`
	}
	aux.alias = (*alias)(c)
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}

	if len(aux.Endpoints) > 0 {
		trimmed := strings.TrimSpace(string(aux.Endpoints))
		if strings.HasPrefix(trimmed, "[") {
			// It's an array of endpoint definitions (e.g. browser extension HAR sync or imported config)
			var defs []swagger.EndpointConfig
			if err := json.Unmarshal(aux.Endpoints, &defs); err != nil {
				return fmt.Errorf("failed to parse endpoints array: %w", err)
			}
			c.EndpointDefinitions = append(c.EndpointDefinitions, defs...)
			c.Endpoints = nil
		} else if strings.HasPrefix(trimmed, "{") {
			// It's a standard include/exclude filter object
			var filter struct {
				Include []string `json:"include"`
				Exclude []string `json:"exclude"`
			}
			if err := json.Unmarshal(aux.Endpoints, &filter); err != nil {
				return fmt.Errorf("failed to parse endpoints object: %w", err)
			}
			c.Endpoints = &struct {
				Include []string `json:"include"`
				Exclude []string `json:"exclude"`
			}{
				Include: filter.Include,
				Exclude: filter.Exclude,
			}
		}
	}
	return nil
}
func BuildRunnerConfig(cliCfg *CliConfig) (*swagger.Config, error) {
	if safenet.AllowLocalNetwork {
		cliCfg.Security.AllowPrivateIPs = true
	}
	// Standardize compatibility aliases and merge them:
	if len(cliCfg.GlobalHeaders) > 0 {
		if cliCfg.Headers == nil {
			cliCfg.Headers = make(map[string]string)
		}
		for k, v := range cliCfg.GlobalHeaders {
			if _, exists := cliCfg.Headers[k]; !exists {
				cliCfg.Headers[k] = v
			}
		}
	}

	if len(cliCfg.SwaggerURLsAlias) > 0 {
		for _, urlStr := range cliCfg.SwaggerURLsAlias {
			found := false
			for _, existing := range cliCfg.SwaggerURLs {
				if existing == urlStr {
					found = true
					break
				}
			}
			if !found {
				cliCfg.SwaggerURLs = append(cliCfg.SwaggerURLs, urlStr)
			}
		}
	}

	if len(cliCfg.DisabledEndpoints) > 0 {
		if cliCfg.Endpoints == nil {
			cliCfg.Endpoints = &struct {
				Include []string `json:"include"`
				Exclude []string `json:"exclude"`
			}{}
		}
		for _, ep := range cliCfg.DisabledEndpoints {
			found := false
			for _, existing := range cliCfg.Endpoints.Exclude {
				if existing == ep {
					found = true
					break
				}
			}
			if !found {
				cliCfg.Endpoints.Exclude = append(cliCfg.Endpoints.Exclude, ep)
			}
		}
	}

	// Validate the configuration schema
	if err := cliCfg.Validate(); err != nil {
		return nil, fmt.Errorf("configuration validation failed: %v", err)
	}

	if cliCfg.MCPServer != nil {
		if cliCfg.MCPServer.Type != "stdio" && cliCfg.MCPServer.Type != "sse" && cliCfg.MCPServer.Type != "http" {
			return nil, fmt.Errorf("invalid mcp_server type: must be 'stdio', 'sse', or 'http'")
		}
		if cliCfg.MCPServer.Type == "stdio" {
			if cliCfg.MCPServer.Command == "" {
				return nil, fmt.Errorf("mcp_server command cannot be empty for stdio type")
			}
		}
		if cliCfg.MCPServer.Type == "sse" || cliCfg.MCPServer.Type == "http" {
			if cliCfg.MCPServer.URL == "" {
				return nil, fmt.Errorf("mcp_server url cannot be empty for %s type", cliCfg.MCPServer.Type)
			}
			if !strings.HasPrefix(cliCfg.MCPServer.URL, "http://") && !strings.HasPrefix(cliCfg.MCPServer.URL, "https://") {
				return nil, fmt.Errorf("mcp_server url must start with http:// or https://")
			}
		}
	}

	if len(cliCfg.SwaggerURLs) == 0 && len(cliCfg.EndpointDefinitions) == 0 && cliCfg.MCPServer == nil {
		return nil, fmt.Errorf("config must specify at least one swagger_url, provide endpoint_definitions (e.g. via browser extension sync), or configure mcp_server")
	}

	if cliCfg.Settings.IterationsPerProfile <= 0 {
		cliCfg.Settings = swagger.DefaultSettings()
	}
	if len(cliCfg.Settings.Profiles) == 0 {
		cliCfg.Settings.Profiles = swagger.DefaultSettings().Profiles
	}



	var allEndpoints []swagger.EndpointConfig
	basePath := cliCfg.BaseURL

	// Fast path: if endpoint_definitions are already provided (e.g. from browser extension
	// HAR capture synced via /api/parse), skip fetching/parsing swagger URLs entirely.
	if len(cliCfg.EndpointDefinitions) > 0 && len(cliCfg.SwaggerURLs) == 0 {
		logger.Debug("[Config] Using %d pre-parsed endpoint_definitions (browser extension mode)", len(cliCfg.EndpointDefinitions))
		allEndpoints = cliCfg.EndpointDefinitions
		if basePath == "" && cliCfg.MCPServer == nil {
			return nil, fmt.Errorf("no base_url found in config — required when using endpoint_definitions without swagger_url")
		}
	} else {
		// 2. Fetch and parse specs concurrently
		type specResult struct {
			urlStr    string
			endpoints []swagger.EndpointConfig
			basePath  string
			err       error
		}

		resChan := make(chan specResult, len(cliCfg.SwaggerURLs))
		var wg sync.WaitGroup

		for _, urlStr := range cliCfg.SwaggerURLs {
			wg.Add(1)
			go func(urlStr string) {
				defer wg.Done()
				logger.Debug("[Config] Fetching spec: %s", urlStr)
				startFetch := time.Now()

				headersCopy := make(map[string]string)
				for k, v := range cliCfg.Headers {
					headersCopy[k] = v
				}
				if len(cliCfg.Cookies) > 0 {
					var cookieParts []string
					for k, v := range cliCfg.Cookies {
						cookieParts = append(cookieParts, fmt.Sprintf("%s=%s", k, v))
					}
					headersCopy["Cookie"] = strings.Join(cookieParts, "; ")
				}

				if swagger.IsWSURL(urlStr) {
					parsedWS, errWS := ws.SynthesizeWSEndpoint(urlStr)
					if errWS == nil {
						resChan <- specResult{
							urlStr:    urlStr,
							endpoints: parsedWS.Endpoints,
							basePath:  parsedWS.BasePath,
						}
						return
					}
				}

				if swagger.IsGRPCURL(urlStr) {
					isTLS := strings.HasPrefix(strings.ToLower(urlStr), "grpcs://")
					grpcCtx, grpcCancel := context.WithTimeout(context.Background(), 10*time.Second)
					defer grpcCancel()
					parsedGRPC, errGRPC := grpc.DiscoverViaReflection(grpcCtx, urlStr, isTLS, headersCopy)
					if errGRPC == nil {
						resChan <- specResult{
							urlStr:    urlStr,
							endpoints: parsedGRPC.Endpoints,
							basePath:  parsedGRPC.BasePath,
						}
						return
					}
					resChan <- specResult{err: fmt.Errorf("failed to discover gRPC service via reflection (%s): %w", urlStr, errGRPC)}
					return
				}

				if strings.HasSuffix(strings.ToLower(urlStr), ".proto") {
					parsedProto, errProto := proto.ParseProtoFile(urlStr, cliCfg.BaseURL)
					if errProto == nil {
						resChan <- specResult{
							urlStr:    urlStr,
							endpoints: parsedProto.Endpoints,
							basePath:  parsedProto.BasePath,
						}
						return
					}
					if strings.HasPrefix(urlStr, "http://") || strings.HasPrefix(urlStr, "https://") {
						specRaw, fetchErr := fetchSpec(urlStr, headersCopy, cliCfg.Security.AllowPrivateIPs)
						if fetchErr == nil {
							if parsedProtoBytes, errBytes := proto.ParseProtoBytes(urlStr, specRaw, cliCfg.BaseURL); errBytes == nil {
								resChan <- specResult{
									urlStr:    urlStr,
									endpoints: parsedProtoBytes.Endpoints,
									basePath:  parsedProtoBytes.BasePath,
								}
								return
							}
						}
					}
					resChan <- specResult{err: fmt.Errorf("failed to parse proto file (%s): %w", urlStr, errProto)}
					return
				}

				specRaw, fetchErr := fetchSpec(urlStr, headersCopy, cliCfg.Security.AllowPrivateIPs)
				
				var parsed *swagger.ParseResult
				var parseErr error

				if fetchErr == nil {
					fetchDur := time.Since(startFetch)
					logger.Debug("[Config] Fetched spec %s (size: %d bytes, took: %v)", urlStr, len(specRaw), fetchDur)

					var parseOpts []swagger.ParserOption
					if cliCfg.Settings.MaxNodesBudget > 0 {
						parseOpts = append(parseOpts, swagger.WithMaxNodes(cliCfg.Settings.MaxNodesBudget))
					}
					if cliCfg.Settings.MaxDepthLimit > 0 {
						parseOpts = append(parseOpts, swagger.WithMaxDepth(cliCfg.Settings.MaxDepthLimit))
					}

					parsed, parseErr = swagger.ParseRawSpec(specRaw, parseOpts...)
					if parseErr != nil {
						originalErr := parseErr
						if swagger.IsHAR(specRaw) {
							parsedHAR, errHAR := har.ParseHAR(specRaw, cliCfg.Settings.HarDomainFilter)
							if errHAR != nil {
								parseErr = fmt.Errorf("failed to parse as HAR: %w", errHAR)
							} else {
								parsed = parsedHAR
								parseErr = nil
							}
						} else if swagger.IsProtoFile(specRaw) {
							parsedProto, errProto := proto.ParseProtoBytes(urlStr, specRaw, cliCfg.BaseURL)
							if errProto != nil {
								parseErr = fmt.Errorf("failed to parse as Proto file: %w", errProto)
							} else {
								parsed = parsedProto
								parseErr = nil
							}
						} else if swagger.IsPostman(specRaw) {
							parsedPostman, errPostman := postman.ParsePostman(specRaw)
							if errPostman != nil {
								parseErr = fmt.Errorf("failed to parse as Postman Collection: %w", errPostman)
							} else {
								parsed = parsedPostman
								parseErr = nil
							}
						} else {
							// Try GraphQL parser fallback
							defaultPath := "/graphql"
							if parsedURL, errURL := url.Parse(urlStr); errURL == nil {
								if parsedURL.Path != "" && parsedURL.Path != "/" {
									defaultPath = parsedURL.Path
								}
							}
							parsedGQL, errGQL := graphql.ParseGraphQLIntrospection(specRaw, defaultPath)
							if errGQL != nil {
								parseErr = fmt.Errorf("failed to parse spec as OpenAPI (%w) or GraphQL (%w)", originalErr, errGQL)
							} else {
								parsed = parsedGQL
								parseErr = nil
							}
						}
					}
				}

				// Trigger MCP probe if fetching failed OR parsing failed
				if fetchErr != nil || parseErr != nil {
					mcpClient := mcp.NewHTTPClient(urlStr, cliCfg.Security.AllowPrivateIPs, headersCopy)
					mcpCtx, mcpCancel := context.WithTimeout(context.Background(), 5*time.Second)
					if mcpErr := mcpClient.Connect(mcpCtx); mcpErr == nil {
						// It is an MCP HTTP server!
						tools, _ := mcpClient.ListTools(mcpCtx)
						mcpCancel()
						var eps []swagger.EndpointConfig
						for _, t := range tools {
							eps = append(eps, swagger.EndpointConfig{
								Method: "MCP",
								Path:   t.Name,
								Schema: t.InputSchema,
							})
						}
						logger.Debug("[Config] Parsed MCP server %s: %d tools found", urlStr, len(eps))
						resChan <- specResult{
							urlStr:    urlStr,
							endpoints: eps,
							basePath:  urlStr,
						}
						return
					} else {
						mcpCancel()
						logger.Debug("[Config] MCP fallback failed for %s: %v", urlStr, mcpErr)
					}

					// Return original fetch or parse error
					if fetchErr != nil {
						resChan <- specResult{err: fmt.Errorf("failed to fetch spec %s: %w", urlStr, fetchErr)}
					} else {
						resChan <- specResult{err: fmt.Errorf("failed to parse spec %s: %w", urlStr, parseErr)}
					}
					return
				}

				bp := ""
				if parsedURL, errURL := url.Parse(urlStr); errURL == nil && parsedURL.Host != "" {
					bp = parsedURL.Scheme + "://" + parsedURL.Host
				} else {
					bp = parsed.BasePath
				}

				logger.Debug("[Config] Parsed spec %s: %d endpoints found", urlStr, len(parsed.Endpoints))

				resChan <- specResult{
					urlStr:    urlStr,
					endpoints: parsed.Endpoints,
					basePath:  bp,
				}
			}(urlStr)
		}

		wg.Wait()
		close(resChan)

		// Collect results in the order of SwaggerURLs to keep order deterministic
		resultsMap := make(map[string]specResult)
		for res := range resChan {
			if res.err != nil {
				return nil, res.err
			}
			resultsMap[res.urlStr] = res
		}

		for _, urlStr := range cliCfg.SwaggerURLs {
			res := resultsMap[urlStr]
			if basePath == "" && res.basePath != "" {
				basePath = res.basePath
			}
			allEndpoints = append(allEndpoints, res.endpoints...)
		}

		// Also merge any pre-parsed endpoint_definitions on top of spec endpoints
		allEndpoints = append(allEndpoints, cliCfg.EndpointDefinitions...)

		if basePath == "" && cliCfg.MCPServer == nil {
			return nil, fmt.Errorf("no base_url found in config or specs")
		}
	}

	logger.Debug("[Config] Aggregated total endpoints: %d", len(allEndpoints))

	// 3. Filter endpoints
	if cliCfg.Endpoints != nil {
		logger.Debug("[Config] Filtering endpoints (Include: %d patterns, Exclude: %d patterns)",
			len(cliCfg.Endpoints.Include), len(cliCfg.Endpoints.Exclude))
		var filtered []swagger.EndpointConfig
		for _, ep := range allEndpoints {
			key := fmt.Sprintf("%s %s", ep.Method, ep.Path)
			included := true
			if len(cliCfg.Endpoints.Include) > 0 {
				included = matchesAny(key, ep.Path, cliCfg.Endpoints.Include)
			}
			if len(cliCfg.Endpoints.Exclude) > 0 {
				if matchesAny(key, ep.Path, cliCfg.Endpoints.Exclude) {
					included = false
				}
			}
			if included {
				filtered = append(filtered, ep)
			}
		}
		allEndpoints = filtered
		logger.Debug("[Config] Endpoints after filtering: %d", len(allEndpoints))
	}

	if len(allEndpoints) == 0 && cliCfg.MCPServer == nil {
		return nil, fmt.Errorf("no endpoints remaining after filtering")
	}

	runCfg := &swagger.Config{
		BaseURL:        basePath,
		GlobalHeaders:  cliCfg.Headers,
		Cookies:        cliCfg.Cookies,
		WordlistFiles:  cliCfg.WordlistFiles,
		Dictionaries:   cliCfg.Dictionaries,
		Settings:       cliCfg.Settings,
		Endpoints:      allEndpoints,
		Rules:          cliCfg.Rules,
		AuthSequence:   cliCfg.AuthSequence,
		AuthIdentities: cliCfg.AuthIdentities,
		Variables:      cliCfg.Variables,
		Security:       cliCfg.Security,
		MCPServer:      cliCfg.MCPServer,
	}

	if err := swagger.LoadWordlists(runCfg); err != nil {
		return nil, fmt.Errorf("failed to load custom wordlists: %v", err)
	}

	return runCfg, nil
}
