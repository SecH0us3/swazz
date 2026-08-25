// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package mcp

import (
	"encoding/json"
	"fmt"
	"strconv"
)

const (
	mcpProtocolVersion = "2024-11-05"
)

// Request is the JSON-RPC 2.0 request wrapper.
type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
	ID      any             `json:"id"`
}

// Response is the JSON-RPC 2.0 response wrapper.
type Response struct {
	JSONRPC string          `json:"jsonrpc"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
	ID      any             `json:"id"`
}

// RPCError is a standard JSON-RPC 2.0 error object.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

func idToKey(id any) string {
	if id == nil {
		return ""
	}
	switch v := id.(type) {
	case string:
		return "s:" + v
	case int:
		return "f:" + strconv.FormatFloat(float64(v), 'f', -1, 64)
	case int64:
		return "f:" + strconv.FormatFloat(float64(v), 'f', -1, 64)
	case uint64:
		return "f:" + strconv.FormatFloat(float64(v), 'f', -1, 64)
	case int32:
		return "f:" + strconv.FormatFloat(float64(v), 'f', -1, 64)
	case uint32:
		return "f:" + strconv.FormatFloat(float64(v), 'f', -1, 64)
	case float64:
		return "f:" + strconv.FormatFloat(v, 'f', -1, 64)
	case float32:
		return "f:" + strconv.FormatFloat(float64(v), 'f', -1, 64)
	default:
		return fmt.Sprintf("v:%v", v)
	}
}
