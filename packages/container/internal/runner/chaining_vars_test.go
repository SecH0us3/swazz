// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"net/http"
	"regexp"
	"testing"

	"swazz-engine/internal/swagger"

	"github.com/stretchr/testify/assert"
)

func TestExtractChainingVariables_AllTypes(t *testing.T) {
	r := &Runner{
		config: &swagger.Config{
			Settings: swagger.Settings{
				ChainingRules: []swagger.ChainingRule{
					{
						SourceEndpoint: "POST /auth/login",
						ExtractType:    "json",
						ExtractPath:    "token",
						VariableName:   "AUTH_TOKEN",
					},
					{
						SourceEndpoint: "POST /auth/login",
						ExtractType:    "json",
						ExtractPath:    "user.profile.id",
						VariableName:   "USER_NESTED_ID",
					},
					{
						SourceEndpoint: "POST /auth/login",
						ExtractType:    "header",
						ExtractPath:    "X-Session-ID",
						VariableName:   "SESSION_ID",
					},
					{
						SourceEndpoint: "POST /auth/login",
						ExtractType:    "regex",
						ExtractPath:    `user_id=(\d+)`,
						VariableName:   "USER_ID",
					},
					{
						SourceEndpoint: "POST /auth/login",
						ExtractType:    "regex",
						ExtractPath:    `code=[a-z]+`,
						VariableName:   "CODE_FULL",
					},
				},
			},
		},
		state:      make(map[string]string),
		regexCache: make(map[string]*regexp.Regexp),
	}

	assert.True(t, r.hasChainingRuleFor("POST /auth/login"))
	assert.False(t, r.hasChainingRuleFor("GET /other"))

	resp := &http.Response{
		Header: http.Header{"X-Session-Id": []string{"sess_12345"}},
	}
	rawBody := []byte(`{"token": "jwt_secret_token", "user": {"profile": {"id": "user_456"}}, "info": "user_id=98765&code=abc"}`)

	r.extractChainingVariables("POST /auth/login", resp, rawBody)

	r.stateMu.RLock()
	defer r.stateMu.RUnlock()
	assert.Equal(t, "jwt_secret_token", r.state["AUTH_TOKEN"])
	assert.Equal(t, "user_456", r.state["USER_NESTED_ID"])
	assert.Equal(t, "sess_12345", r.state["SESSION_ID"])
	assert.Equal(t, "98765", r.state["USER_ID"])
	assert.Equal(t, "code=abc", r.state["CODE_FULL"])
}

func TestExtractChainingVariables_NonMatching(t *testing.T) {
	r := &Runner{
		config: &swagger.Config{
			Settings: swagger.Settings{
				ChainingRules: []swagger.ChainingRule{
					{
						SourceEndpoint: "POST /auth/login",
						ExtractType:    "json",
						ExtractPath:    "missing_key",
						VariableName:   "MISSING",
					},
					{
						SourceEndpoint: "POST /auth/login",
						ExtractType:    "regex",
						ExtractPath:    `([invalid regex`,
						VariableName:   "INVALID_RE",
					},
				},
			},
		},
		state:      make(map[string]string),
		regexCache: make(map[string]*regexp.Regexp),
	}

	resp := &http.Response{Header: http.Header{}}
	rawBody := []byte(`{"key": "value"}`)

	r.extractChainingVariables("POST /auth/login", resp, rawBody)

	r.stateMu.RLock()
	defer r.stateMu.RUnlock()
	assert.Empty(t, r.state["MISSING"])
	assert.Empty(t, r.state["INVALID_RE"])
}
