package main

import (
	"encoding/json"
	"testing"
)

func TestCliConfigAliasesAndValidation(t *testing.T) {
	configJSON := `{
		"global_headers": {
			"X-Test-Global": "value1"
		},
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
			"profiles": ["RANDOM"]
		}
	}`

	var cliCfg CliConfig
	if err := json.Unmarshal([]byte(configJSON), &cliCfg); err != nil {
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
}
