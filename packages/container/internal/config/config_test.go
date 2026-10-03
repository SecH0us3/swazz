// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/safenet"
	"swazz-engine/internal/swagger"
)

func TestCliConfig_UnmarshalJSON(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		inputJSON   string
		wantErr     bool
		errContains string
		validate    func(t *testing.T, cfg *CliConfig)
	}{
		{
			name: "endpoints as array of definitions",
			inputJSON: `{
				"base_url": "https://api.example.com",
				"endpoints": [
					{"method": "GET", "path": "/api/users"},
					{"method": "POST", "path": "/api/users"}
				]
			}`,
			wantErr: false,
			validate: func(t *testing.T, cfg *CliConfig) {
				assert.Equal(t, "https://api.example.com", cfg.BaseURL)
				assert.Nil(t, cfg.Endpoints)
				require.Len(t, cfg.EndpointDefinitions, 2)
				assert.Equal(t, "GET", cfg.EndpointDefinitions[0].Method)
				assert.Equal(t, "/api/users", cfg.EndpointDefinitions[0].Path)
				assert.Equal(t, "POST", cfg.EndpointDefinitions[1].Method)
				assert.Equal(t, "/api/users", cfg.EndpointDefinitions[1].Path)
			},
		},
		{
			name: "endpoints as filter object",
			inputJSON: `{
				"base_url": "https://api.example.com",
				"endpoints": {
					"include": ["/api/v1/**", "GET /api/v2/items"],
					"exclude": ["/api/v1/internal/**"]
				}
			}`,
			wantErr: false,
			validate: func(t *testing.T, cfg *CliConfig) {
				assert.Equal(t, "https://api.example.com", cfg.BaseURL)
				assert.Empty(t, cfg.EndpointDefinitions)
				require.NotNil(t, cfg.Endpoints)
				assert.Equal(t, []string{"/api/v1/**", "GET /api/v2/items"}, cfg.Endpoints.Include)
				assert.Equal(t, []string{"/api/v1/internal/**"}, cfg.Endpoints.Exclude)
			},
		},
		{
			name: "no endpoints key leaves both nil",
			inputJSON: `{
				"base_url": "https://api.example.com",
				"license_key": "lic-12345"
			}`,
			wantErr: false,
			validate: func(t *testing.T, cfg *CliConfig) {
				assert.Equal(t, "https://api.example.com", cfg.BaseURL)
				assert.Equal(t, "lic-12345", cfg.LicenseKey)
				assert.Nil(t, cfg.Endpoints)
				assert.Empty(t, cfg.EndpointDefinitions)
			},
		},
		{
			name: "malformed endpoints array",
			inputJSON: `{
				"endpoints": ["not", "an", "endpoint", "object"]
			}`,
			wantErr:     true,
			errContains: "failed to parse endpoints array",
		},
		{
			name: "malformed endpoints object",
			inputJSON: `{
				"endpoints": {
					"include": "invalid-not-a-slice"
				}
			}`,
			wantErr:     true,
			errContains: "failed to parse endpoints object",
		},
		{
			name: "endpoints as null string or non-container leaves endpoints nil",
			inputJSON: `{
				"base_url": "https://api.example.com",
				"endpoints": null
			}`,
			wantErr: false,
			validate: func(t *testing.T, cfg *CliConfig) {
				assert.Equal(t, "https://api.example.com", cfg.BaseURL)
				assert.Nil(t, cfg.Endpoints)
				assert.Empty(t, cfg.EndpointDefinitions)
			},
		},
		{
			name: "malformed top-level json",
			inputJSON: `{
				"base_url": invalid-json-here
			}`,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			var cfg CliConfig
			err := json.Unmarshal([]byte(tt.inputJSON), &cfg)
			if tt.wantErr {
				require.Error(t, err)
				if tt.errContains != "" {
					assert.Contains(t, err.Error(), tt.errContains)
				}
			} else {
				require.NoError(t, err)
				if tt.validate != nil {
					tt.validate(t, &cfg)
				}
			}
		})
	}
}

func TestCliConfig_Validate(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		cfg         CliConfig
		wantErr     bool
		errContains string
	}{
		{
			name: "valid base_url and default settings",
			cfg: CliConfig{
				BaseURL:  "https://api.example.com",
				Settings: swagger.DefaultSettings(),
			},
			wantErr: false,
		},
		{
			name: "valid empty base_url",
			cfg: CliConfig{
				BaseURL:  "",
				Settings: swagger.DefaultSettings(),
			},
			wantErr: false,
		},
		{
			name: "valid ws base_url",
			cfg: CliConfig{
				BaseURL:  "ws://api.example.com/ws",
				Settings: swagger.DefaultSettings(),
			},
			wantErr: false,
		},
		{
			name: "valid grpc base_url",
			cfg: CliConfig{
				BaseURL:  "grpc://localhost:50051",
				Settings: swagger.DefaultSettings(),
			},
			wantErr: false,
		},
		{
			name: "invalid base_url scheme",
			cfg: CliConfig{
				BaseURL:  "ftp://api.example.com",
				Settings: swagger.DefaultSettings(),
			},
			wantErr:     true,
			errContains: "base_url must have a valid http, https, ws, wss, grpc, or grpcs scheme",
		},
		{
			name: "invalid base_url control character",
			cfg: CliConfig{
				BaseURL:  "http://example.com/\x7f",
				Settings: swagger.DefaultSettings(),
			},
			wantErr:     true,
			errContains: "invalid base_url",
		},
		{
			name: "invalid settings concurrency",
			cfg: CliConfig{
				BaseURL: "https://api.example.com",
				Settings: swagger.Settings{
					Concurrency: -1,
				},
			},
			wantErr:     true,
			errContains: "concurrency must be greater than or equal to 0",
		},
		{
			name: "invalid settings timeout",
			cfg: CliConfig{
				BaseURL: "https://api.example.com",
				Settings: swagger.Settings{
					TimeoutMs: -1,
				},
			},
			wantErr:     true,
			errContains: "timeout_ms must be greater than or equal to 0",
		},
		{
			name: "invalid settings profile",
			cfg: CliConfig{
				BaseURL: "https://api.example.com",
				Settings: swagger.Settings{
					Profiles: []swagger.FuzzingProfile{"UNSUPPORTED_PROFILE"},
				},
			},
			wantErr:     true,
			errContains: "invalid profile",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := tt.cfg.Validate()
			if tt.wantErr {
				require.Error(t, err)
				if tt.errContains != "" {
					assert.Contains(t, err.Error(), tt.errContains)
				}
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestBuildRunnerConfig(t *testing.T) {
	t.Parallel()

	t.Run("endpoint definitions fast path with field mapping", func(t *testing.T) {
		t.Parallel()
		defs := []swagger.EndpointConfig{
			{Method: "GET", Path: "/api/items"},
			{Method: "POST", Path: "/api/items"},
		}
		rules := &swagger.RulesConfig{
			Ignore: []int{404, 500},
		}
		sec := swagger.SecurityConfig{
			AllowPrivateIPs: true,
		}

		cliCfg := &CliConfig{
			BaseURL:             "https://api.example.com",
			Headers:             map[string]string{"Authorization": "Bearer token"},
			Cookies:             map[string]string{"session_id": "xyz789"},
			EndpointDefinitions: defs,
			Rules:               rules,
			Security:            sec,
			Settings:            swagger.DefaultSettings(),
		}

		runCfg, err := BuildRunnerConfig(cliCfg)
		require.NoError(t, err)
		require.NotNil(t, runCfg)

		assert.Equal(t, "https://api.example.com", runCfg.BaseURL)
		assert.Equal(t, map[string]string{"Authorization": "Bearer token"}, runCfg.GlobalHeaders)
		assert.Equal(t, map[string]string{"session_id": "xyz789"}, runCfg.Cookies)
		assert.Equal(t, defs, runCfg.Endpoints)
		assert.Equal(t, rules, runCfg.Rules)
		assert.True(t, runCfg.Security.AllowPrivateIPs)
	})

	t.Run("local file spec parses endpoints and infers base path", func(t *testing.T) {
		t.Parallel()
		tmpDir := t.TempDir()
		specPath := filepath.Join(tmpDir, "swagger.json")

		specJSON := `{
			"swagger": "2.0",
			"info": {"title": "Local Spec API", "version": "1.0.0"},
			"host": "local.api.swazz",
			"basePath": "/v1",
			"schemes": ["https"],
			"paths": {
				"/users": {
					"get": {
						"responses": {"200": {"description": "OK"}}
					}
				}
			}
		}`
		require.NoError(t, os.WriteFile(specPath, []byte(specJSON), 0600))

		cliCfg := &CliConfig{
			SwaggerURLs: []string{specPath},
			Settings:    swagger.DefaultSettings(),
		}

		runCfg, err := BuildRunnerConfig(cliCfg)
		require.NoError(t, err)
		require.NotNil(t, runCfg)

		assert.Equal(t, "https://local.api.swazz/v1", runCfg.BaseURL)
		require.Len(t, runCfg.Endpoints, 1)
		assert.Equal(t, "GET", runCfg.Endpoints[0].Method)
		assert.Equal(t, "/users", runCfg.Endpoints[0].Path)
	})

	t.Run("MCP server validation errors", func(t *testing.T) {
		t.Parallel()
		tests := []struct {
			name        string
			mcpServer   swagger.MCPServerConfig
			errContains string
		}{
			{
				name: "invalid type",
				mcpServer: swagger.MCPServerConfig{
					Type: "tcp",
				},
				errContains: "invalid mcp_server type: must be 'stdio', 'sse', or 'http'",
			},
			{
				name: "empty stdio command",
				mcpServer: swagger.MCPServerConfig{
					Type:    "stdio",
					Command: "",
				},
				errContains: "mcp_server command cannot be empty for stdio type",
			},
			{
				name: "empty sse url",
				mcpServer: swagger.MCPServerConfig{
					Type: "sse",
					URL:  "",
				},
				errContains: "mcp_server url cannot be empty for sse type",
			},
			{
				name: "empty http url",
				mcpServer: swagger.MCPServerConfig{
					Type: "http",
					URL:  "",
				},
				errContains: "mcp_server url cannot be empty for http type",
			},
			{
				name: "invalid url scheme for sse",
				mcpServer: swagger.MCPServerConfig{
					Type: "sse",
					URL:  "ws://localhost:8080/events",
				},
				errContains: "mcp_server url must start with http:// or https://",
			},
			{
				name: "invalid url scheme for http",
				mcpServer: swagger.MCPServerConfig{
					Type: "http",
					URL:  "ftp://localhost:8080/mcp",
				},
				errContains: "mcp_server url must start with http:// or https://",
			},
		}

		for _, tt := range tests {
			tt := tt
			t.Run(tt.name, func(t *testing.T) {
				t.Parallel()
				cfg := &CliConfig{
					BaseURL:   "https://api.example.com",
					MCPServer: &tt.mcpServer,
					Settings:  swagger.DefaultSettings(),
				}
				_, err := BuildRunnerConfig(cfg)
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errContains)
			})
		}
	})

	t.Run("include and exclude filters applied to endpoints", func(t *testing.T) {
		t.Parallel()
		cliCfg := &CliConfig{
			BaseURL: "https://api.example.com",
			EndpointDefinitions: []swagger.EndpointConfig{
				{Method: "GET", Path: "/api/users"},
				{Method: "POST", Path: "/api/users"},
				{Method: "DELETE", Path: "/api/users/1"},
				{Method: "GET", Path: "/internal/metrics"},
			},
			Endpoints: &struct {
				Include []string `json:"include"`
				Exclude []string `json:"exclude"`
			}{
				Include: []string{"/api/**"},
				Exclude: []string{"DELETE /api/users/*"},
			},
			Settings: swagger.DefaultSettings(),
		}

		runCfg, err := BuildRunnerConfig(cliCfg)
		require.NoError(t, err)
		require.NotNil(t, runCfg)

		require.Len(t, runCfg.Endpoints, 2)
		assert.Equal(t, "GET", runCfg.Endpoints[0].Method)
		assert.Equal(t, "/api/users", runCfg.Endpoints[0].Path)
		assert.Equal(t, "POST", runCfg.Endpoints[1].Method)
		assert.Equal(t, "/api/users", runCfg.Endpoints[1].Path)
	})

	t.Run("compatibility aliases merged correctly", func(t *testing.T) {
		t.Parallel()
		tmpDir := t.TempDir()
		spec1Path := filepath.Join(tmpDir, "spec1.json")
		spec2Path := filepath.Join(tmpDir, "spec2.json")

		spec1JSON := `{
			"swagger": "2.0",
			"info": {"title": "Spec 1", "version": "1.0"},
			"paths": {
				"/api/test": {"get": {"responses": {"200": {"description": "ok"}}}}
			}
		}`
		spec2JSON := `{
			"swagger": "2.0",
			"info": {"title": "Spec 2", "version": "1.0"},
			"paths": {
				"/api/disabled": {"post": {"responses": {"200": {"description": "ok"}}}}
			}
		}`
		require.NoError(t, os.WriteFile(spec1Path, []byte(spec1JSON), 0600))
		require.NoError(t, os.WriteFile(spec2Path, []byte(spec2JSON), 0600))

		cliCfg := &CliConfig{
			BaseURL:          "https://api.example.com",
			Headers:          map[string]string{"Existing-Header": "original", "Shared-Header": "header-val"},
			GlobalHeaders:    map[string]string{"Shared-Header": "alias-val", "New-Global": "global-val"},
			SwaggerURLs:      []string{spec1Path},
			SwaggerURLsAlias: []string{spec1Path, spec2Path},
			DisabledEndpoints: []string{
				"POST /api/disabled",
			},
			Settings: swagger.DefaultSettings(),
		}

		runCfg, err := BuildRunnerConfig(cliCfg)
		require.NoError(t, err)
		require.NotNil(t, runCfg)

		// Headers merged: existing keys preserved, new keys added
		assert.Equal(t, "header-val", runCfg.GlobalHeaders["Shared-Header"])
		assert.Equal(t, "original", runCfg.GlobalHeaders["Existing-Header"])
		assert.Equal(t, "global-val", runCfg.GlobalHeaders["New-Global"])

		// DisabledEndpoints excluded the matching endpoint
		require.Len(t, runCfg.Endpoints, 1)
		assert.Equal(t, "GET", runCfg.Endpoints[0].Method)
		assert.Equal(t, "/api/test", runCfg.Endpoints[0].Path)

		// SwaggerURLs deduplicated
		assert.Equal(t, []string{spec1Path, spec2Path}, cliCfg.SwaggerURLs)
	})

	t.Run("missing sources returns error", func(t *testing.T) {
		t.Parallel()
		cliCfg := &CliConfig{
			BaseURL:  "https://api.example.com",
			Settings: swagger.DefaultSettings(),
		}
		_, err := BuildRunnerConfig(cliCfg)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "config must specify at least one swagger_url, provide endpoint_definitions")
	})

	t.Run("endpoint definitions without base_url returns error", func(t *testing.T) {
		t.Parallel()
		cliCfg := &CliConfig{
			EndpointDefinitions: []swagger.EndpointConfig{
				{Method: "GET", Path: "/ping"},
			},
			Settings: swagger.DefaultSettings(),
		}
		_, err := BuildRunnerConfig(cliCfg)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "no base_url found in config — required when using endpoint_definitions without swagger_url")
	})

	t.Run("local file spec without base_url in spec or config returns error", func(t *testing.T) {
		t.Parallel()
		tmpDir := t.TempDir()
		specPath := filepath.Join(tmpDir, "nobase.json")
		specJSON := `{
			"openapi": "3.0.0",
			"info": {"title": "No Base Spec", "version": "1.0.0"},
			"paths": {
				"/status": {
					"get": {"responses": {"200": {"description": "OK"}}}
				}
			}
		}`
		require.NoError(t, os.WriteFile(specPath, []byte(specJSON), 0600))

		cliCfg := &CliConfig{
			SwaggerURLs: []string{specPath},
			Settings:    swagger.DefaultSettings(),
		}
		_, err := BuildRunnerConfig(cliCfg)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "no base_url found in config or specs")
	})

	t.Run("all endpoints filtered out returns error", func(t *testing.T) {
		t.Parallel()
		cliCfg := &CliConfig{
			BaseURL: "https://api.example.com",
			EndpointDefinitions: []swagger.EndpointConfig{
				{Method: "GET", Path: "/api/test"},
			},
			Endpoints: &struct {
				Include []string `json:"include"`
				Exclude []string `json:"exclude"`
			}{
				Include: []string{"/other/**"},
			},
			Settings: swagger.DefaultSettings(),
		}
		_, err := BuildRunnerConfig(cliCfg)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "no endpoints remaining after filtering")
	})

	t.Run("defaults settings when iterations or profiles missing", func(t *testing.T) {
		t.Parallel()
		cliCfg := &CliConfig{
			BaseURL: "https://api.example.com",
			EndpointDefinitions: []swagger.EndpointConfig{
				{Method: "GET", Path: "/api/test"},
			},
			Settings: swagger.Settings{
				IterationsPerProfile: 0,
				Profiles:             nil,
			},
		}
		runCfg, err := BuildRunnerConfig(cliCfg)
		require.NoError(t, err)
		require.NotNil(t, runCfg)
		assert.Positive(t, runCfg.Settings.IterationsPerProfile)
		assert.NotEmpty(t, runCfg.Settings.Profiles)
	})

	t.Run("valid stdio MCP server without endpoints succeeds", func(t *testing.T) {
		t.Parallel()
		cliCfg := &CliConfig{
			BaseURL: "https://api.example.com",
			MCPServer: &swagger.MCPServerConfig{
				Type:    "stdio",
				Command: "node server.js",
			},
			Settings: swagger.DefaultSettings(),
		}
		runCfg, err := BuildRunnerConfig(cliCfg)
		require.NoError(t, err)
		require.NotNil(t, runCfg)
		require.NotNil(t, runCfg.MCPServer)
		assert.Equal(t, "stdio", runCfg.MCPServer.Type)
		assert.Equal(t, "node server.js", runCfg.MCPServer.Command)
	})

	t.Run("load wordlists error propagates", func(t *testing.T) {
		t.Parallel()
		cliCfg := &CliConfig{
			BaseURL: "https://api.example.com",
			EndpointDefinitions: []swagger.EndpointConfig{
				{Method: "GET", Path: "/api/test"},
			},
			WordlistFiles: map[string]string{
				"custom": filepath.Join(t.TempDir(), "nonexistent_wordlist_file.txt"),
			},
			Settings: swagger.DefaultSettings(),
		}
		_, err := BuildRunnerConfig(cliCfg)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "failed to load custom wordlists")
	})

	t.Run("safenet AllowLocalNetwork sets AllowPrivateIPs", func(t *testing.T) {
		// Avoid t.Parallel() because safenet.AllowLocalNetwork is a package-level global
		orig := safenet.AllowLocalNetwork
		safenet.AllowLocalNetwork = true
		defer func() { safenet.AllowLocalNetwork = orig }()

		cliCfg := &CliConfig{
			BaseURL: "https://api.example.com",
			EndpointDefinitions: []swagger.EndpointConfig{
				{Method: "GET", Path: "/api/test"},
			},
			Settings: swagger.DefaultSettings(),
		}
		runCfg, err := BuildRunnerConfig(cliCfg)
		require.NoError(t, err)
		assert.True(t, runCfg.Security.AllowPrivateIPs)
	})

	t.Run("configuration validation failure propagates", func(t *testing.T) {
		t.Parallel()
		cliCfg := &CliConfig{
			BaseURL:  "ftp://invalid.com",
			Settings: swagger.DefaultSettings(),
		}
		_, err := BuildRunnerConfig(cliCfg)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "configuration validation failed")
	})

	t.Run("GlobalHeaders initialized when Headers is nil", func(t *testing.T) {
		t.Parallel()
		cliCfg := &CliConfig{
			BaseURL: "https://api.example.com",
			GlobalHeaders: map[string]string{
				"X-Global": "true",
			},
			EndpointDefinitions: []swagger.EndpointConfig{
				{Method: "GET", Path: "/ping"},
			},
			Settings: swagger.DefaultSettings(),
		}
		runCfg, err := BuildRunnerConfig(cliCfg)
		require.NoError(t, err)
		assert.Equal(t, "true", runCfg.GlobalHeaders["X-Global"])
	})

	t.Run("DisabledEndpoints with existing duplicates", func(t *testing.T) {
		t.Parallel()
		cliCfg := &CliConfig{
			BaseURL: "https://api.example.com",
			EndpointDefinitions: []swagger.EndpointConfig{
				{Method: "GET", Path: "/api/a"},
				{Method: "GET", Path: "/api/b"},
			},
			Endpoints: &struct {
				Include []string `json:"include"`
				Exclude []string `json:"exclude"`
			}{
				Exclude: []string{"GET /api/b"},
			},
			DisabledEndpoints: []string{"GET /api/b", "GET /api/b"},
			Settings:          swagger.DefaultSettings(),
		}
		runCfg, err := BuildRunnerConfig(cliCfg)
		require.NoError(t, err)
		require.Len(t, runCfg.Endpoints, 1)
		assert.Equal(t, "/api/a", runCfg.Endpoints[0].Path)
	})

	t.Run("empty profiles with positive iterations defaults profiles", func(t *testing.T) {
		t.Parallel()
		cliCfg := &CliConfig{
			BaseURL: "https://api.example.com",
			EndpointDefinitions: []swagger.EndpointConfig{
				{Method: "GET", Path: "/ping"},
			},
			Settings: swagger.Settings{
				IterationsPerProfile: 5,
				Profiles:             nil,
			},
		}
		runCfg, err := BuildRunnerConfig(cliCfg)
		require.NoError(t, err)
		assert.Equal(t, 5, runCfg.Settings.IterationsPerProfile)
		assert.NotEmpty(t, runCfg.Settings.Profiles)
	})

	t.Run("WebSocket URL synthesized without network", func(t *testing.T) {
		t.Parallel()
		cliCfg := &CliConfig{
			SwaggerURLs: []string{"ws://ws.example.com/chat"},
			Settings:    swagger.DefaultSettings(),
		}
		runCfg, err := BuildRunnerConfig(cliCfg)
		require.NoError(t, err)
		require.NotNil(t, runCfg)
		assert.Equal(t, "ws://ws.example.com", runCfg.BaseURL)
		require.Len(t, runCfg.Endpoints, 1)
		assert.Equal(t, "WS", runCfg.Endpoints[0].Method)
		assert.Equal(t, "/chat", runCfg.Endpoints[0].Path)
	})

	t.Run("invalid WebSocket URL returns error", func(t *testing.T) {
		t.Parallel()
		cliCfg := &CliConfig{
			SwaggerURLs: []string{"ws:///"},
			Settings:    swagger.DefaultSettings(),
		}
		_, err := BuildRunnerConfig(cliCfg)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "failed to synthesize ws endpoint")
	})

	t.Run("proto file not found returns error", func(t *testing.T) {
		t.Parallel()
		cliCfg := &CliConfig{
			SwaggerURLs: []string{"/nonexistent/service.proto"},
			Settings:    swagger.DefaultSettings(),
		}
		_, err := BuildRunnerConfig(cliCfg)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "failed to parse proto file")
	})

	t.Run("local file postman collection parsed successfully", func(t *testing.T) {
		t.Parallel()
		tmpDir := t.TempDir()
		postmanPath := filepath.Join(tmpDir, "collection.json")
		postmanJSON := `{
			"info": {
				"_postman_id": "test-id",
				"name": "Local Postman Spec",
				"schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
			},
			"item": [
				{
					"name": "Get Info",
					"request": {
						"method": "GET",
						"url": {
							"raw": "https://api.postman.local/v1/info",
							"protocol": "https",
							"host": ["api", "postman", "local"],
							"path": ["v1", "info"]
						}
					}
				}
			]
		}`
		require.NoError(t, os.WriteFile(postmanPath, []byte(postmanJSON), 0600))

		cliCfg := &CliConfig{
			SwaggerURLs: []string{postmanPath},
			BaseURL:     "https://api.postman.local",
			Settings:    swagger.DefaultSettings(),
		}
		runCfg, err := BuildRunnerConfig(cliCfg)
		require.NoError(t, err)
		require.Len(t, runCfg.Endpoints, 1)
		assert.Equal(t, "GET", runCfg.Endpoints[0].Method)
	})

	t.Run("local file spec with cookies and headers configured", func(t *testing.T) {
		t.Parallel()
		tmpDir := t.TempDir()
		specPath := filepath.Join(tmpDir, "spec.json")
		specJSON := `{
			"swagger": "2.0",
			"info": {"title": "Spec with Headers", "version": "1.0"},
			"paths": {
				"/items": {"get": {"responses": {"200": {"description": "ok"}}}}
			}
		}`
		require.NoError(t, os.WriteFile(specPath, []byte(specJSON), 0600))

		cliCfg := &CliConfig{
			BaseURL:     "https://api.example.com",
			SwaggerURLs: []string{specPath},
			Headers:     map[string]string{"X-Custom": "header"},
			Cookies:     map[string]string{"session": "sess123", "theme": "dark"},
			Settings:    swagger.DefaultSettings(),
		}
		runCfg, err := BuildRunnerConfig(cliCfg)
		require.NoError(t, err)
		assert.Equal(t, "https://api.example.com", runCfg.BaseURL)
		assert.Equal(t, "header", runCfg.GlobalHeaders["X-Custom"])
		assert.Equal(t, "sess123", runCfg.Cookies["session"])
	})
}

func TestWriteJSON(t *testing.T) {
	t.Parallel()

	t.Run("successful write and read back", func(t *testing.T) {
		t.Parallel()
		tmpDir := t.TempDir()
		outPath := filepath.Join(tmpDir, "test.json")

		type sampleData struct {
			Name  string   `json:"name"`
			Count int      `json:"count"`
			Tags  []string `json:"tags"`
		}
		input := sampleData{
			Name:  "swazz-test",
			Count: 42,
			Tags:  []string{"alpha", "beta"},
		}

		err := WriteJSON(outPath, input)
		require.NoError(t, err)

		raw, err := os.ReadFile(outPath)
		require.NoError(t, err)

		var output sampleData
		err = json.Unmarshal(raw, &output)
		require.NoError(t, err)
		assert.Equal(t, input, output)

		// Assert pretty formatting (indentation)
		assert.Contains(t, string(raw), "  \"name\": \"swazz-test\"")
	})

	t.Run("unwritable path returns error", func(t *testing.T) {
		t.Parallel()
		unwritablePath := filepath.Join(t.TempDir(), "nonexistent_directory", "file.json")
		err := WriteJSON(unwritablePath, map[string]string{"foo": "bar"})
		require.Error(t, err)
	})

	t.Run("unencodable data returns error", func(t *testing.T) {
		t.Parallel()
		outPath := filepath.Join(t.TempDir(), "unencodable.json")
		unencodable := map[string]any{
			"channel": make(chan int),
		}
		err := WriteJSON(outPath, unencodable)
		require.Error(t, err)
	})
}
