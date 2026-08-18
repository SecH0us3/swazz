// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package grpc

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"swazz-engine/internal/proto"
)

func TestMarshalAndUnmarshalPayload(t *testing.T) {
	protoSrc := `
syntax = "proto3";
package demo;

service UserService {
  rpc UpdateUser(UpdateUserRequest) returns (User);
}

enum Role {
  UNKNOWN = 0;
  USER = 1;
  ADMIN = 2;
}

message UpdateUserRequest {
  int64 id = 1;
  string name = 2;
  Role role = 3;
  repeated string tags = 4;
}

message User {
  int64 id = 1;
  string name = 2;
}
`
	res, err := proto.ParseProtoBytes("test.proto", []byte(protoSrc), "")
	require.NoError(t, err)
	require.Len(t, res.Endpoints, 1)

	// Test marshal map payload
	payload := map[string]any{
		"id":   float64(42),
		"name": "Alice",
		"role": "ADMIN",
		"tags": []any{"security", "qa"},
	}

	md, err := FindMessageDescriptor(protoSrc, "demo.UpdateUserRequest")
	require.NoError(t, err)

	bin, err := MarshalPayload(md, payload)
	require.NoError(t, err)
	assert.NotEmpty(t, bin)

	// Now unmarshal back
	parsedMap, jsonStr, err := UnmarshalResponse(md, bin)
	require.NoError(t, err)
	assert.Equal(t, "Alice", parsedMap["name"])
	assert.NotEmpty(t, jsonStr)
}

func TestMarshalPayload_NilAndRaw(t *testing.T) {
	protoSrc := `
syntax = "proto3";
package demo;

message EmptyMsg {}
`
	md, err := FindMessageDescriptor(protoSrc, "demo.EmptyMsg")
	require.NoError(t, err)

	// Nil payload
	bin, err := MarshalPayload(md, nil)
	require.NoError(t, err)
	assert.Empty(t, bin)

	// Raw byte payload
	raw := []byte{0x08, 0x01}
	binRaw, err := MarshalPayload(md, raw)
	require.NoError(t, err)
	assert.Equal(t, raw, binRaw)

	// Nil descriptor
	_, err = MarshalPayload(nil, map[string]any{"a": 1})
	assert.Error(t, err)
}

func TestMarshalPayload_JSONString(t *testing.T) {
	protoSrc := `
syntax = "proto3";
package demo;

message SimpleMsg {
  string text = 1;
}
`
	md, err := FindMessageDescriptor(protoSrc, "demo.SimpleMsg")
	require.NoError(t, err)

	bin, err := MarshalPayload(md, `{"text": "hello"}`)
	require.NoError(t, err)
	assert.NotEmpty(t, bin)

	parsed, _, err := UnmarshalResponse(md, bin)
	require.NoError(t, err)
	assert.Equal(t, "hello", parsed["text"])
}

func TestMarshalPayload_FuzzFallback(t *testing.T) {
	protoSrc := `
syntax = "proto3";
package demo;

message FuzzMsg {
  int32 num = 1;
  bool flag = 2;
  string desc = 3;
}
`
	md, err := FindMessageDescriptor(protoSrc, "demo.FuzzMsg")
	require.NoError(t, err)

	// Pass numeric values as string or type mismatch that fails standard protojson but succeeds with fallback
	payload := map[string]any{
		"num":  "12345",
		"flag": true,
		"desc": "testing fallback",
	}

	bin, err := MarshalPayload(md, payload)
	require.NoError(t, err)
	assert.NotEmpty(t, bin)

	parsed, _, err := UnmarshalResponse(md, bin)
	require.NoError(t, err)
	assert.Equal(t, "testing fallback", parsed["desc"])
}

func TestUnmarshalResponse_NilDescriptorAndInvalidBytes(t *testing.T) {
	// Nil descriptor
	m, s, err := UnmarshalResponse(nil, []byte("raw content"))
	assert.NoError(t, err)
	assert.Equal(t, "raw content", m["raw"])
	assert.Equal(t, "raw content", s)

	// Invalid bytes
	protoSrc := `
syntax = "proto3";
package demo;

message SimpleMsg {
  string text = 1;
}
`
	md, err := FindMessageDescriptor(protoSrc, "demo.SimpleMsg")
	require.NoError(t, err)

	_, _, err = UnmarshalResponse(md, []byte{0xff, 0xff, 0xff})
	assert.Error(t, err)
}

func TestFindMessageDescriptor_Errors(t *testing.T) {
	protoSrc := `
syntax = "proto3";
package demo;

service TestService {}
`
	// Descriptor not found
	_, err := FindMessageDescriptor(protoSrc, "demo.NonExistent")
	assert.Error(t, err)

	// Descriptor is service, not message
	_, err = FindMessageDescriptor(protoSrc, "demo.TestService")
	assert.Error(t, err)

	// Invalid proto syntax
	_, err = FindMessageDescriptor("invalid proto", "demo.Test")
	assert.Error(t, err)
}

func TestMarshalPayload_ComprehensiveFallback(t *testing.T) {
	protoSrc := `
syntax = "proto3";
package demo;

enum Status {
  UNKNOWN = 0;
  ACTIVE = 1;
  SUSPENDED = 2;
}

message NestedChild {
  string child_name = 1;
  int32 child_age = 2;
}

message AllTypesMsg {
  int32 i32 = 1;
  int64 i64 = 2;
  uint32 u32 = 3;
  uint64 u64 = 4;
  float flt = 5;
  double dbl = 6;
  bool flag = 7;
  bool flag_str = 8;
  string str = 9;
  bytes raw_b64 = 10;
  bytes raw_str = 11;
  Status status_str = 12;
  Status status_num = 13;
  repeated string tags = 14;
  repeated int32 numbers = 15;
  NestedChild child = 16;
}
`
	md, err := FindMessageDescriptor(protoSrc, "demo.AllTypesMsg")
	require.NoError(t, err)

	// Provide bad/unconventional types to trigger manual fallback population
	payload := map[string]any{
		"i32":        "42",
		"i64":        float64(10000000000),
		"u32":        "500",
		"u64":        "999999999",
		"flt":        "3.14",
		"dbl":        float64(2.71828),
		"flag":       true,
		"flag_str":   "true",
		"str":        12345,
		"raw_b64":    "aGVsbG8=",
		"raw_str":    "plainbytes",
		"status_str": "ACTIVE",
		"status_num": 2,
		"tags":       []any{"tag1", "tag2"},
		"numbers":    []any{10, "20", float64(30)},
		"child": map[string]any{
			"child_name": "Bobby",
			"child_age":  "12",
		},
	}

	bin, err := MarshalPayload(md, payload)
	require.NoError(t, err)
	assert.NotEmpty(t, bin)

	parsed, jsonStr, err := UnmarshalResponse(md, bin)
	require.NoError(t, err)
	assert.NotEmpty(t, jsonStr)

	assert.Equal(t, float64(42), parsed["i32"])
	assert.Equal(t, "10000000000", parsed["i64"]) // protojson marshals int64 as string
	assert.Equal(t, float64(500), parsed["u32"])
	assert.Equal(t, "999999999", parsed["u64"])
	assert.InDelta(t, 3.14, parsed["flt"].(float64), 0.01)
	assert.InDelta(t, 2.71828, parsed["dbl"].(float64), 0.001)
	assert.Equal(t, true, parsed["flag"])
	assert.Equal(t, true, parsed["flagStr"])
	assert.Equal(t, "12345", parsed["str"])
	assert.Equal(t, "ACTIVE", parsed["statusStr"])
	assert.Equal(t, "SUSPENDED", parsed["statusNum"])
}
