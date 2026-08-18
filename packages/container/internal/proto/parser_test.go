// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package proto

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseProtoBytes(t *testing.T) {
	protoSrc := `
syntax = "proto3";
package demo;

service UserService {
  rpc GetUser(GetUserRequest) returns (User);
  rpc SearchUsers(SearchRequest) returns (SearchResponse);
}

enum Role {
  UNKNOWN = 0;
  USER = 1;
  ADMIN = 2;
}

message User {
  int64 id = 1;
  string name = 2;
  string email = 3;
  Role role = 4;
}

message GetUserRequest {
  int64 id = 1;
}

message SearchRequest {
  string query = 1;
  int32 limit = 2;
  repeated string tags = 3;
  map<string, string> metadata = 4;
}

message SearchResponse {
  repeated User users = 1;
  int32 total = 2;
}
`
	res, err := ParseProtoBytes("demo.proto", []byte(protoSrc), "localhost:50051")
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.Equal(t, "localhost:50051", res.BasePath)
	require.Len(t, res.Endpoints, 2)

	// Check GetUser endpoint
	getUser := res.Endpoints[0]
	assert.Equal(t, "GRPC", getUser.Method)
	assert.Equal(t, "/demo.UserService/GetUser", getUser.Path)
	assert.Equal(t, "application/grpc", getUser.ContentType)
	require.NotNil(t, getUser.Schema.Properties)
	assert.Contains(t, getUser.Schema.Properties, "id")
	assert.Equal(t, "integer", getUser.Schema.Properties["id"].Type)
	assert.Equal(t, "int64", getUser.Schema.Properties["id"].Format)

	// Check SearchUsers endpoint
	search := res.Endpoints[1]
	assert.Equal(t, "GRPC", search.Method)
	assert.Equal(t, "/demo.UserService/SearchUsers", search.Path)
	assert.Contains(t, search.Schema.Properties, "query")
	assert.Equal(t, "string", search.Schema.Properties["query"].Type)
	assert.Contains(t, search.Schema.Properties, "tags")
	assert.Equal(t, "array", search.Schema.Properties["tags"].Type)
	assert.Equal(t, "string", search.Schema.Properties["tags"].Items.Type)
	assert.Contains(t, search.Schema.Properties, "metadata")
	assert.Equal(t, "object", search.Schema.Properties["metadata"].Type)
}

func TestParseProtoFile(t *testing.T) {
	tmpDir := t.TempDir()
	protoFile := filepath.Join(tmpDir, "test.proto")
	content := `
syntax = "proto3";
package test;

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
}

message HelloRequest {
  string name = 1;
}

message HelloReply {
  string message = 1;
}
`
	require.NoError(t, os.WriteFile(protoFile, []byte(content), 0600))

	res, err := ParseProtoFile(protoFile, "localhost:50051")
	require.NoError(t, err)
	require.Len(t, res.Endpoints, 1)
	assert.Equal(t, "/test.Greeter/SayHello", res.Endpoints[0].Path)
	assert.Equal(t, "GRPC", res.Endpoints[0].Method)
	assert.Equal(t, "application/grpc", res.Endpoints[0].ContentType)
}

func TestParseProtoWithOneof(t *testing.T) {
	protoSrc := `
syntax = "proto3";
package oneofdemo;

service AuthHelper {
  rpc Authenticate(AuthRequest) returns (AuthResponse);
}

message AuthRequest {
  oneof credential {
    string password = 1;
    string token = 2;
    int64 pin = 3;
  }
}

message AuthResponse {
  bool success = 1;
}
`
	res, err := ParseProtoBytes("oneof.proto", []byte(protoSrc), "grpc://127.0.0.1:9000")
	require.NoError(t, err)
	require.Len(t, res.Endpoints, 1)

	ep := res.Endpoints[0]
	assert.Equal(t, "/oneofdemo.AuthHelper/Authenticate", ep.Path)
	require.NotNil(t, ep.Schema.Properties)
	assert.Contains(t, ep.Schema.Properties, "password")
	assert.Contains(t, ep.Schema.Properties, "token")
	assert.Contains(t, ep.Schema.Properties, "pin")
	assert.Equal(t, "string", ep.Schema.Properties["password"].Type)
	assert.Equal(t, "string", ep.Schema.Properties["token"].Type)
	assert.Equal(t, "integer", ep.Schema.Properties["pin"].Type)
}

func TestParseProtoRecursive(t *testing.T) {
	protoSrc := `
syntax = "proto3";
package tree;

service TreeService {
  rpc Traverse(TreeNode) returns (TreeNode);
}

message TreeNode {
  int32 val = 1;
  TreeNode left = 2;
  TreeNode right = 3;
}
`
	res, err := ParseProtoBytes("tree.proto", []byte(protoSrc), "grpc://localhost:50051")
	require.NoError(t, err)
	require.Len(t, res.Endpoints, 1)

	ep := res.Endpoints[0]
	assert.Equal(t, "/tree.TreeService/Traverse", ep.Path)
	assert.Equal(t, "integer", ep.Schema.Properties["val"].Type)
	assert.Equal(t, "object", ep.Schema.Properties["left"].Type)
	assert.Equal(t, "object", ep.Schema.Properties["right"].Type)
}

func TestStreamingRPCSkipped(t *testing.T) {
	protoSrc := `
syntax = "proto3";
package streamdemo;

service StreamService {
  rpc UnaryCall(Req) returns (Resp);
  rpc ClientStream(stream Req) returns (Resp);
  rpc ServerStream(Req) returns (stream Resp);
  rpc BidiStream(stream Req) returns (stream Resp);
}

message Req {
  string data = 1;
}

message Resp {
  string result = 1;
}
`
	res, err := ParseProtoBytes("stream.proto", []byte(protoSrc), "grpc://localhost:50051")
	require.NoError(t, err)
	require.Len(t, res.Endpoints, 1)
	assert.Equal(t, "/streamdemo.StreamService/UnaryCall", res.Endpoints[0].Path)
}

func TestParseProtoErrors(t *testing.T) {
	_, err := ParseProtoBytes("invalid.proto", []byte("invalid syntax non proto"), "")
	assert.Error(t, err)

	_, err = ParseProtoFile("non_existent_file.proto", "")
	assert.Error(t, err)
}

func TestParseProtoAllScalarTypes(t *testing.T) {
	protoSrc := `
syntax = "proto3";
package scalardemo;

service ScalarService {
  rpc CheckScalars(ScalarRequest) returns (ScalarResponse);
}

message ScalarRequest {
  int32 i32 = 1;
  sint32 si32 = 2;
  sfixed32 sf32 = 3;
  int64 i64 = 4;
  sint64 si64 = 5;
  sfixed64 sf64 = 6;
  uint32 u32 = 7;
  fixed32 f32 = 8;
  uint64 u64 = 9;
  fixed64 f64 = 10;
  float flt = 11;
  double dbl = 12;
  bool flag = 13;
  string str = 14;
  bytes raw = 15;
}

message ScalarResponse {
  bool ok = 1;
}
`
	res, err := ParseProtoBytes("scalars.proto", []byte(protoSrc), "grpc://127.0.0.1:50051")
	require.NoError(t, err)
	require.Len(t, res.Endpoints, 1)

	ep := res.Endpoints[0]
	props := ep.Schema.Properties

	assert.Equal(t, "integer", props["i32"].Type)
	assert.Equal(t, "int32", props["i32"].Format)
	assert.Equal(t, "integer", props["si32"].Type)
	assert.Equal(t, "int32", props["si32"].Format)
	assert.Equal(t, "integer", props["sf32"].Type)
	assert.Equal(t, "int32", props["sf32"].Format)

	assert.Equal(t, "integer", props["i64"].Type)
	assert.Equal(t, "int64", props["i64"].Format)
	assert.Equal(t, "integer", props["si64"].Type)
	assert.Equal(t, "int64", props["si64"].Format)
	assert.Equal(t, "integer", props["sf64"].Type)
	assert.Equal(t, "int64", props["sf64"].Format)

	assert.Equal(t, "integer", props["u32"].Type)
	assert.Equal(t, "uint32", props["u32"].Format)
	assert.Equal(t, "integer", props["f32"].Type)
	assert.Equal(t, "uint32", props["f32"].Format)

	assert.Equal(t, "integer", props["u64"].Type)
	assert.Equal(t, "uint64", props["u64"].Format)
	assert.Equal(t, "integer", props["f64"].Type)
	assert.Equal(t, "uint64", props["f64"].Format)

	assert.Equal(t, "number", props["flt"].Type)
	assert.Equal(t, "float", props["flt"].Format)
	assert.Equal(t, "number", props["dbl"].Type)
	assert.Equal(t, "double", props["dbl"].Format)

	assert.Equal(t, "boolean", props["flag"].Type)
	assert.Equal(t, "string", props["str"].Type)
	assert.Equal(t, "string", props["raw"].Type)
	assert.Equal(t, "byte", props["raw"].Format)

	// Check descriptor getters
	inDesc := GetMethodInputDescriptor(ep.Path)
	assert.NotNil(t, inDesc)
	assert.Equal(t, "ScalarRequest", string(inDesc.Name()))

	outDesc := GetMethodOutputDescriptor(ep.Path)
	assert.NotNil(t, outDesc)
	assert.Equal(t, "ScalarResponse", string(outDesc.Name()))

	assert.Nil(t, GetMethodInputDescriptor("/non/existent"))
	assert.Nil(t, GetMethodOutputDescriptor("/non/existent"))
}
