// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package ws

import (
	"testing"
)

func TestSynthesizeWSEndpoint(t *testing.T) {
	urlStr := "ws://localhost:8080/ws"
	res, err := SynthesizeWSEndpoint(urlStr)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if len(res.Endpoints) != 1 {
		t.Fatalf("expected 1 endpoint, got %d", len(res.Endpoints))
	}

	ep := res.Endpoints[0]
	// Only the channel path belongs in Path; the origin goes to BasePath. Putting the
	// whole URL here made the executor append it to base_url and every handshake 404d.
	if ep.Path != "/ws" {
		t.Errorf("expected path %q, got %q", "/ws", ep.Path)
	}
	if res.BasePath != "ws://localhost:8080" {
		t.Errorf("expected base path %q, got %q", "ws://localhost:8080", res.BasePath)
	}
	if ep.Method != "WS" {
		t.Errorf("expected method WS, got %q", ep.Method)
	}
	if ep.ContentType != "application/json" {
		t.Errorf("expected content type application/json, got %q", ep.ContentType)
	}
}

func TestParseAsyncAPISpec(t *testing.T) {
	raw := []byte(`{
		"asyncapi": "2.0.0",
		"channels": {
			"/user/signedup": {
				"subscribe": {
					"message": {
						"payload": {
							"type": "object",
							"properties": {
								"userId": {
									"type": "string"
								}
							}
						}
					}
				}
			}
		}
	}`)

	res, err := ParseAsyncAPISpec(raw, "ws://localhost:8080")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if res.BasePath != "ws://localhost:8080" {
		t.Errorf("expected base path ws://localhost:8080, got %q", res.BasePath)
	}

	if len(res.Endpoints) != 1 {
		t.Fatalf("expected 1 endpoint, got %d", len(res.Endpoints))
	}

	ep := res.Endpoints[0]
	if ep.Path != "/user/signedup" {
		t.Errorf("expected path /user/signedup, got %q", ep.Path)
	}
	if ep.Method != "WS" {
		t.Errorf("expected method WS, got %q", ep.Method)
	}
	if ep.Schema.Type != "object" {
		t.Errorf("expected schema type object, got %q", ep.Schema.Type)
	}
	if _, ok := ep.Schema.Properties["userId"]; !ok {
		t.Errorf("expected userId property in schema")
	}
}
