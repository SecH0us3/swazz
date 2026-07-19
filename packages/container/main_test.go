package main

import (
	"encoding/json"
	"testing"

	"swazz-engine/internal/swagger"
)

func TestCliConfigAliasesAndValidation(t *testing.T) {
	configJSON := `{
		// global headers
		"global_headers": {
			"X-Test-Global": "value1"
		},
		/*
		  local headers override
		*/
		"headers": {
			"X-Test-Local": "value2"
		},
		"_swagger_urls": [
			"http://localhost:8080/swagger.json"
		],
		"swagger_urls": [
			"http://localhost:8080/swagger-v2.json"
		],
		"disabled_endpoints": [
			"GET /debug"
		],
		"endpoints": {
			"exclude": [
				"POST /debug"
			]
		},
		"settings": {
			"concurrency": 10,
			"timeout_ms": 2000,
			"profiles": ["RANDOM"],
			"har_domain_filter": "example\\.com"
		}
	}`

	var cliCfg CliConfig
	stripped := swagger.StripJSONC([]byte(configJSON))
	if err := json.Unmarshal(stripped, &cliCfg); err != nil {
		t.Fatalf("Failed to unmarshal config JSON: %v", err)
	}

	// Run the same merge logic as in runCLI:
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

	// Verify headers merged
	if cliCfg.Headers["X-Test-Global"] != "value1" {
		t.Errorf("Expected X-Test-Global in Headers, got %v", cliCfg.Headers["X-Test-Global"])
	}
	if cliCfg.Headers["X-Test-Local"] != "value2" {
		t.Errorf("Expected X-Test-Local in Headers, got %v", cliCfg.Headers["X-Test-Local"])
	}

	// Verify swagger URLs merged
	if len(cliCfg.SwaggerURLs) != 2 {
		t.Errorf("Expected 2 swagger URLs, got %d", len(cliCfg.SwaggerURLs))
	}

	// Verify excluded endpoints merged
	if len(cliCfg.Endpoints.Exclude) != 2 {
		t.Errorf("Expected 2 excluded endpoints, got %d", len(cliCfg.Endpoints.Exclude))
	}

	// Verify validation
	if err := cliCfg.Validate(); err != nil {
		t.Errorf("Expected valid config, got error: %v", err)
	}

	// Test validation failure
	cliCfg.Settings.Concurrency = -1
	if err := cliCfg.Validate(); err == nil {
		t.Error("Expected validation to fail for negative concurrency, but it succeeded")
	}

	// Verify HAR domain filter parsing
	if cliCfg.Settings.HarDomainFilter != "example\\.com" {
		t.Errorf("Expected HarDomainFilter 'example\\.com', got %v", cliCfg.Settings.HarDomainFilter)
	}
}

func TestValidatePprofAddr(t *testing.T) {
	tests := []struct {
		name    string
		addr    string
		want    string
		wantErr bool
	}{
		{
			name:    "empty address",
			addr:    "",
			want:    "",
			wantErr: false,
		},
		{
			name:    "localhost only",
			addr:    "localhost",
			want:    "localhost:6060",
			wantErr: false,
		},
		{
			name:    "127.0.0.1 only",
			addr:    "127.0.0.1",
			want:    "127.0.0.1:6060",
			wantErr: false,
		},
		{
			name:    "localhost with port",
			addr:    "localhost:8080",
			want:    "localhost:8080",
			wantErr: false,
		},
		{
			name:    "127.0.0.1 with port",
			addr:    "127.0.0.1:8080",
			want:    "127.0.0.1:8080",
			wantErr: false,
		},
		{
			name:    "port only",
			addr:    ":6060",
			want:    "127.0.0.1:6060",
			wantErr: false,
		},
		{
			name:    "ipv6 loopback",
			addr:    "::1",
			want:    "[::1]:6060",
			wantErr: false,
		},
		{
			name:    "ipv6 loopback brackets",
			addr:    "[::1]",
			want:    "[::1]:6060",
			wantErr: false,
		},
		{
			name:    "ipv6 loopback with port",
			addr:    "[::1]:8080",
			want:    "[::1]:8080",
			wantErr: false,
		},
		{
			name:    "unsafe bind 0.0.0.0",
			addr:    "0.0.0.0:6060",
			want:    "",
			wantErr: true,
		},
		{
			name:    "unsafe bind other IP",
			addr:    "192.168.1.100:6060",
			want:    "",
			wantErr: true,
		},
		{
			name:    "unsafe bind external hostname",
			addr:    "example.com:6060",
			want:    "",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := validatePprofAddr(tt.addr)
			if (err != nil) != tt.wantErr {
				t.Errorf("validatePprofAddr() error = %v, wantErr = %v", err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("validatePprofAddr() got = %q, want = %q", got, tt.want)
			}
		})
	}
}

func TestParsePprofAddr(t *testing.T) {
	tests := []struct {
		name     string
		args     []string
		envVal   string
		wantAddr string
		wantArgs []string
		wantErr  bool
	}{
		{
			name:     "no env, no flag",
			args:     []string{"swazz-engine", "start"},
			envVal:   "",
			wantAddr: "",
			wantArgs: []string{"swazz-engine", "start"},
			wantErr:  false,
		},
		{
			name:     "env set, no flag",
			args:     []string{"swazz-engine", "start"},
			envVal:   "localhost:6060",
			wantAddr: "localhost:6060",
			wantArgs: []string{"swazz-engine", "start"},
			wantErr:  false,
		},
		{
			name:     "flag set space style",
			args:     []string{"swazz-engine", "start", "--pprof-addr", "localhost:7070"},
			envVal:   "",
			wantAddr: "localhost:7070",
			wantArgs: []string{"swazz-engine", "start"},
			wantErr:  false,
		},
		{
			name:     "flag set equal style",
			args:     []string{"swazz-engine", "start", "--pprof-addr=localhost:7070", "--config", "conf.json"},
			envVal:   "",
			wantAddr: "localhost:7070",
			wantArgs: []string{"swazz-engine", "start", "--config", "conf.json"},
			wantErr:  false,
		},
		{
			name:     "flag overrides env",
			args:     []string{"swazz-engine", "start", "--pprof-addr", "localhost:7070"},
			envVal:   "localhost:6060",
			wantAddr: "localhost:7070",
			wantArgs: []string{"swazz-engine", "start"},
			wantErr:  false,
		},
		{
			name:     "flag missing value",
			args:     []string{"swazz-engine", "start", "--pprof-addr"},
			envVal:   "",
			wantAddr: "",
			wantArgs: nil,
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			getenv := func(key string) string {
				if key == "SWAZZ_PPROF_ADDR" {
					return tt.envVal
				}
				return ""
			}
			addr, gotArgs, err := parsePprofAddr(tt.args, getenv)
			if (err != nil) != tt.wantErr {
				t.Errorf("parsePprofAddr() error = %v, wantErr = %v", err, tt.wantErr)
				return
			}
			if tt.wantErr {
				return
			}
			if addr != tt.wantAddr {
				t.Errorf("parsePprofAddr() addr = %q, want = %q", addr, tt.wantAddr)
			}
			if len(gotArgs) != len(tt.wantArgs) {
				t.Errorf("parsePprofAddr() args len = %d, want = %d (got = %v, want = %v)", len(gotArgs), len(tt.wantArgs), gotArgs, tt.wantArgs)
				return
			}
			for i := range gotArgs {
				if gotArgs[i] != tt.wantArgs[i] {
					t.Errorf("parsePprofAddr() args[%d] = %q, want = %q", i, gotArgs[i], tt.wantArgs[i])
				}
			}
		})
	}
}

func TestBuildRunnerConfigMCPServer(t *testing.T) {
	tests := []struct {
		name    string
		config  CliConfig
		wantErr bool
	}{
		{
			name: "valid stdio mcp server",
			config: CliConfig{
				MCPServer: &swagger.MCPServerConfig{
					Type:    "stdio",
					Command: "node",
					Args:    []string{"index.js"},
				},
			},
			wantErr: false,
		},
		{
			name: "valid sse mcp server",
			config: CliConfig{
				MCPServer: &swagger.MCPServerConfig{
					Type: "sse",
					URL:  "https://localhost:8080/sse",
				},
			},
			wantErr: false,
		},
		{
			name: "invalid mcp type",
			config: CliConfig{
				MCPServer: &swagger.MCPServerConfig{
					Type: "invalid",
				},
			},
			wantErr: true,
		},
		{
			name: "missing command for stdio",
			config: CliConfig{
				MCPServer: &swagger.MCPServerConfig{
					Type:    "stdio",
					Command: "",
				},
			},
			wantErr: true,
		},
		{
			name: "missing url for sse",
			config: CliConfig{
				MCPServer: &swagger.MCPServerConfig{
					Type: "sse",
					URL:  "",
				},
			},
			wantErr: true,
		},
		{
			name: "invalid url prefix for sse",
			config: CliConfig{
				MCPServer: &swagger.MCPServerConfig{
					Type: "sse",
					URL:  "ftp://localhost:8080",
				},
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := BuildRunnerConfig(&tt.config)
			if (err != nil) != tt.wantErr {
				t.Errorf("BuildRunnerConfig() error = %v, wantErr = %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && cfg == nil {
				t.Error("BuildRunnerConfig() returned nil config but no error")
				return
			}
			if !tt.wantErr {
				if cfg.MCPServer == nil {
					t.Error("Expected MCPServer in generated run config, got nil")
					return
				}
				if cfg.MCPServer.Type != tt.config.MCPServer.Type {
					t.Errorf("Expected MCPServer.Type %q, got %q", tt.config.MCPServer.Type, cfg.MCPServer.Type)
				}
			}
		})
	}
}

