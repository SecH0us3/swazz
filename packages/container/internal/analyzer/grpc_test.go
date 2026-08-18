// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGRPCStatusAnalyzer(t *testing.T) {
	analyzer := &GRPCStatusAnalyzer{}

	// Test Internal error
	inputInternal := &AnalysisInput{
		Method:       "GRPC",
		Endpoint:     "/demo.UserService/UpdateUser",
		ResponseBody: []byte("rpc error: code = Internal desc = panic: runtime error: invalid memory address or nil pointer dereference"),
	}
	findings := analyzer.Analyze(inputInternal)
	assert.NotEmpty(t, findings)
	assert.Equal(t, "swazz/grpc-internal-error", findings[0].RuleID)
	assert.Equal(t, "error", findings[0].Level)

	// Test Server crash / broken pipe
	inputCrash := &AnalysisInput{
		Method:       "GRPC",
		Endpoint:     "/demo.UserService/UpdateUser",
		ResponseBody: []byte("rpc error: code = Unavailable desc = transport: error while reading from server: EOF"),
	}
	findingsCrash := analyzer.Analyze(inputCrash)
	assert.NotEmpty(t, findingsCrash)
	assert.Equal(t, "swazz/grpc-server-crash", findingsCrash[0].RuleID)

	// Test DataLoss error
	inputDataLoss := &AnalysisInput{
		Method:       "GRPC",
		Endpoint:     "/demo.UserService/UpdateUser",
		ResponseBody: []byte("rpc error: code = DataLoss desc = unrecoverable data loss"),
	}
	findingsDataLoss := analyzer.Analyze(inputDataLoss)
	assert.NotEmpty(t, findingsDataLoss)
	assert.Equal(t, "swazz/grpc-data-loss", findingsDataLoss[0].RuleID)

	// Test Unknown error
	inputUnknown := &AnalysisInput{
		Method:       "GRPC",
		Endpoint:     "/demo.UserService/UpdateUser",
		ResponseBody: []byte("rpc error: code = Unknown desc = generic unknown error"),
	}
	findingsUnknown := analyzer.Analyze(inputUnknown)
	assert.NotEmpty(t, findingsUnknown)
	assert.Equal(t, "swazz/grpc-unknown-error", findingsUnknown[0].RuleID)
	assert.Equal(t, "warning", findingsUnknown[0].Level)

	// Test Non-gRPC input ignored
	inputHTTP := &AnalysisInput{
		Method:       "POST",
		Endpoint:     "/api/v1/users",
		ResponseBody: []byte("code = Internal"),
	}
	findingsHTTP := analyzer.Analyze(inputHTTP)
	assert.Empty(t, findingsHTTP)

	// Test endpoint with grpc:// scheme
	inputScheme := &AnalysisInput{
		Method:       "",
		Endpoint:     "grpc://127.0.0.1:50051/demo.UserService/UpdateUser",
		ResponseBody: []byte("rpc error: code = 13 desc = internal error"),
	}
	findingsScheme := analyzer.Analyze(inputScheme)
	assert.NotEmpty(t, findingsScheme)
	assert.Equal(t, "swazz/grpc-internal-error", findingsScheme[0].RuleID)
}

func TestRegistry_GRPCAnalyzer(t *testing.T) {
	reg := NewRegistry()
	input := &AnalysisInput{
		Method:       "GRPC",
		Endpoint:     "/demo.UserService/GetUser",
		ResponseBody: []byte("rpc error: code = Internal desc = panic"),
	}
	findings := reg.Analyze(input)
	var found bool
	for _, f := range findings {
		if f.RuleID == "swazz/grpc-internal-error" {
			found = true
			break
		}
	}
	assert.True(t, found, "expected swazz/grpc-internal-error in registry findings")
}
