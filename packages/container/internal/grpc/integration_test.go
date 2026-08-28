// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package grpc_test

import (
	"context"
	"fmt"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bufbuild/protocompile"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/reflection"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/dynamicpb"

	swazzGrpc "swazz-engine/internal/grpc"
	"swazz-engine/internal/proto"
	"swazz-engine/internal/runner"
	"swazz-engine/internal/swagger"
)

const demoProtoSrc = `
syntax = "proto3";
package demo;
option go_package = "demo/grpc/demopb";

service UserService {
  rpc GetUser(GetUserRequest) returns (User);
  rpc SearchUsers(SearchRequest) returns (SearchResponse);
  rpc UpdateUser(UpdateUserRequest) returns (User);
  rpc ExecuteDiagnostic(DiagnosticRequest) returns (DiagnosticResponse);
  rpc DeleteUser(DeleteUserRequest) returns (DeleteUserResponse);
}

message User {
  int64 id = 1;
  string name = 2;
  string email = 3;
  string role = 4;
}

message GetUserRequest {
  int64 id = 1;
}

message SearchRequest {
  string query = 1;
  int32 limit = 2;
}

message SearchResponse {
  repeated User users = 1;
  int32 total = 2;
}

message UpdateUserRequest {
  int64 id = 1;
  string name = 2;
  string email = 3;
}

message DiagnosticRequest {
  string host = 1;
  int32 count = 2;
}

message DiagnosticResponse {
  string output = 1;
  int32 packets_sent = 2;
}

message DeleteUserRequest {
  int64 id = 1;
  string reason = 2;
}

message DeleteUserResponse {
  bool success = 1;
  string message = 2;
}
`

// startVulnerableDemoServer spins up an in-process instance of the vulnerable demo gRPC server.
func startVulnerableDemoServer(t *testing.T) (string, func()) {
	compiler := protocompile.Compiler{
		Resolver: protocompile.CompositeResolver{
			&protocompile.SourceResolver{
				Accessor: protocompile.SourceAccessorFromMap(map[string]string{
					"demo.proto": demoProtoSrc,
				}),
			},
		},
	}

	files, err := compiler.Compile(context.Background(), "demo.proto")
	require.NoError(t, err)
	require.NotEmpty(t, files)

	fileDesc := files[0]
	if regErr := protoregistry.GlobalFiles.RegisterFile(fileDesc); regErr != nil {
		if !strings.Contains(regErr.Error(), "already registered") {
			t.Logf("Warning registering file descriptor: %v", regErr)
		}
	}

	userMsg := fileDesc.Messages().ByName("User")
	getUserReqMsg := fileDesc.Messages().ByName("GetUserRequest")
	searchReqMsg := fileDesc.Messages().ByName("SearchRequest")
	searchRespMsg := fileDesc.Messages().ByName("SearchResponse")
	updateUserReqMsg := fileDesc.Messages().ByName("UpdateUserRequest")
	diagReqMsg := fileDesc.Messages().ByName("DiagnosticRequest")
	diagRespMsg := fileDesc.Messages().ByName("DiagnosticResponse")
	deleteUserReqMsg := fileDesc.Messages().ByName("DeleteUserRequest")
	deleteUserRespMsg := fileDesc.Messages().ByName("DeleteUserResponse")

	grpcServiceDesc := grpc.ServiceDesc{
		ServiceName: "demo.UserService",
		HandlerType: (*any)(nil),
		Methods: []grpc.MethodDesc{
			{
				MethodName: "GetUser",
				Handler: func(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
					req := dynamicpb.NewMessage(getUserReqMsg)
					if err := dec(req); err != nil {
						return nil, err
					}
					idVal := req.Get(getUserReqMsg.Fields().ByName("id")).Int()

					resp := dynamicpb.NewMessage(userMsg)
					resp.Set(userMsg.Fields().ByName("id"), protoreflect.ValueOfInt64(idVal))

					if idVal == 999 {
						resp.Set(userMsg.Fields().ByName("name"), protoreflect.ValueOfString("Admin Debugger"))
						resp.Set(userMsg.Fields().ByName("email"), protoreflect.ValueOfString("debug.admin@swazz.internal"))
						resp.Set(userMsg.Fields().ByName("role"), protoreflect.ValueOfString("admin; jwt_secret=super_secret_master_key_999; AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE; DB_PASSWORD=admin_super_secret_pass"))
					} else {
						resp.Set(userMsg.Fields().ByName("name"), protoreflect.ValueOfString(fmt.Sprintf("User %d", idVal)))
						resp.Set(userMsg.Fields().ByName("email"), protoreflect.ValueOfString(fmt.Sprintf("user%d@example.com", idVal)))
						resp.Set(userMsg.Fields().ByName("role"), protoreflect.ValueOfString("member"))
					}
					return resp, nil
				},
			},
			{
				MethodName: "SearchUsers",
				Handler: func(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
					req := dynamicpb.NewMessage(searchReqMsg)
					if err := dec(req); err != nil {
						return nil, err
					}
					query := req.Get(searchReqMsg.Fields().ByName("query")).String()
					queryLower := strings.ToLower(query)

					if strings.Contains(query, "'") || strings.Contains(query, "\"") ||
						strings.Contains(queryLower, "union") || strings.Contains(queryLower, "select") ||
						strings.Contains(queryLower, "--") || strings.Contains(queryLower, "or 1=1") ||
						strings.Contains(queryLower, "and 1=1") || strings.Contains(queryLower, "sleep(") ||
						strings.Contains(queryLower, "/*") {
						return nil, status.Errorf(codes.InvalidArgument, "Error 1064 (42000): You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '%s' at line 1", query)
					}

					resp := dynamicpb.NewMessage(searchRespMsg)
					resp.Set(searchRespMsg.Fields().ByName("total"), protoreflect.ValueOfInt32(1))
					userList := resp.Mutable(searchRespMsg.Fields().ByName("users")).List()

					u := dynamicpb.NewMessage(userMsg)
					u.Set(userMsg.Fields().ByName("id"), protoreflect.ValueOfInt64(1))
					u.Set(userMsg.Fields().ByName("name"), protoreflect.ValueOfString("Alice matching: "+query))
					u.Set(userMsg.Fields().ByName("email"), protoreflect.ValueOfString("alice@example.com"))
					u.Set(userMsg.Fields().ByName("role"), protoreflect.ValueOfString("user"))
					userList.Append(protoreflect.ValueOfMessage(u))

					return resp, nil
				},
			},
			{
				MethodName: "UpdateUser",
				Handler: func(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
					req := dynamicpb.NewMessage(updateUserReqMsg)
					if err := dec(req); err != nil {
						return nil, err
					}
					idVal := req.Get(updateUserReqMsg.Fields().ByName("id")).Int()
					nameVal := req.Get(updateUserReqMsg.Fields().ByName("name")).String()
					emailVal := req.Get(updateUserReqMsg.Fields().ByName("email")).String()

					if idVal <= 0 {
						return nil, status.Errorf(codes.Internal, "panic: runtime error: invalid memory address or nil pointer dereference\n\ngoroutine 42 [running]:\nmain.updateUserHandler(0x104ef8200, {0x1400018a000, 0x18})\n\t/demo/grpc/main.go:142 +0x2bc\ngoogle.golang.org/grpc.(*Server).processUnaryRPC(...)")
					}

					resp := dynamicpb.NewMessage(userMsg)
					resp.Set(userMsg.Fields().ByName("id"), protoreflect.ValueOfInt64(idVal))
					resp.Set(userMsg.Fields().ByName("name"), protoreflect.ValueOfString(nameVal))
					resp.Set(userMsg.Fields().ByName("email"), protoreflect.ValueOfString(emailVal))
					resp.Set(userMsg.Fields().ByName("role"), protoreflect.ValueOfString("member"))
					return resp, nil
				},
			},
			{
				MethodName: "ExecuteDiagnostic",
				Handler: func(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
					req := dynamicpb.NewMessage(diagReqMsg)
					if err := dec(req); err != nil {
						return nil, err
					}
					host := req.Get(diagReqMsg.Fields().ByName("host")).String()
					count := int32(req.Get(diagReqMsg.Fields().ByName("count")).Int())
					if count <= 0 {
						count = 1
					}

					resp := dynamicpb.NewMessage(diagRespMsg)
					resp.Set(diagRespMsg.Fields().ByName("packets_sent"), protoreflect.ValueOfInt32(count))

					hostLower := strings.ToLower(host)
					if strings.Contains(host, ";") || strings.Contains(host, "|") ||
						strings.Contains(host, "&") || strings.Contains(hostLower, "whoami") ||
						strings.Contains(hostLower, "id") || strings.Contains(host, "$(") ||
						strings.Contains(host, "`") || strings.Contains(hostLower, "cat /etc/passwd") {
						out := fmt.Sprintf("uid=0(root) gid=0(root) groups=0(root)\nroot:x:0:0:root:/root:/bin/bash\nPING %s (127.0.0.1): 56 data bytes\n64 bytes from 127.0.0.1: icmp_seq=0 ttl=64 time=0.042 ms", host)
						resp.Set(diagRespMsg.Fields().ByName("output"), protoreflect.ValueOfString(out))
					} else {
						out := fmt.Sprintf("PING %s (127.0.0.1): 56 data bytes\n64 bytes from 127.0.0.1: icmp_seq=0 ttl=64 time=0.042 ms", host)
						resp.Set(diagRespMsg.Fields().ByName("output"), protoreflect.ValueOfString(out))
					}

					return resp, nil
				},
			},
			{
				MethodName: "DeleteUser",
				Handler: func(srv any, ctx context.Context, dec func(any) error, interceptor grpc.UnaryServerInterceptor) (any, error) {
					req := dynamicpb.NewMessage(deleteUserReqMsg)
					if err := dec(req); err != nil {
						return nil, err
					}
					idVal := req.Get(deleteUserReqMsg.Fields().ByName("id")).Int()

					resp := dynamicpb.NewMessage(deleteUserRespMsg)
					resp.Set(deleteUserRespMsg.Fields().ByName("success"), protoreflect.ValueOfBool(true))
					resp.Set(deleteUserRespMsg.Fields().ByName("message"), protoreflect.ValueOfString(fmt.Sprintf("User %d successfully deleted (unauthenticated access permitted)", idVal)))
					return resp, nil
				},
			},
		},
		Streams:  []grpc.StreamDesc{},
		Metadata: "demo.proto",
	}

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)

	srv := grpc.NewServer()
	srv.RegisterService(&grpcServiceDesc, nil)
	reflection.Register(srv)

	go func() {
		_ = srv.Serve(lis)
	}()

	addr := lis.Addr().String()
	cleanup := func() {
		srv.Stop()
		_ = lis.Close()
	}

	return addr, cleanup
}

func TestGRPCIntegration_EndToEnd(t *testing.T) {
	serverAddr, cleanupServer := startVulnerableDemoServer(t)
	defer cleanupServer()

	// 1. Test Proto file / in-memory bytes parsing
	protoRes, err := proto.ParseProtoBytes("demo.proto", []byte(demoProtoSrc), "grpc://"+serverAddr)
	require.NoError(t, err)
	require.NotNil(t, protoRes)
	assert.Equal(t, "grpc://"+serverAddr, protoRes.BasePath)
	require.Len(t, protoRes.Endpoints, 5)

	expectedEndpoints := map[string]bool{
		"/demo.UserService/GetUser":           false,
		"/demo.UserService/SearchUsers":       false,
		"/demo.UserService/UpdateUser":        false,
		"/demo.UserService/ExecuteDiagnostic": false,
		"/demo.UserService/DeleteUser":        false,
	}

	for _, ep := range protoRes.Endpoints {
		assert.Equal(t, "GRPC", ep.Method)
		assert.Equal(t, "application/grpc", ep.ContentType)
		if _, ok := expectedEndpoints[ep.Path]; ok {
			expectedEndpoints[ep.Path] = true
		}
	}
	for epPath, found := range expectedEndpoints {
		assert.Truef(t, found, "Endpoint %s not found in proto parse result", epPath)
	}

	// 2. Test Live gRPC Server Reflection Discovery
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	reflRes, err := swazzGrpc.DiscoverViaReflection(ctx, "grpc://"+serverAddr, false, nil)
	require.NoError(t, err)
	require.NotNil(t, reflRes)
	require.Len(t, reflRes.Endpoints, 5)

	reflEndpoints := make(map[string]bool)
	for _, ep := range reflRes.Endpoints {
		assert.Equal(t, "GRPC", ep.Method)
		assert.Equal(t, "application/grpc", ep.ContentType)
		reflEndpoints[ep.Path] = true
	}
	assert.True(t, reflEndpoints["/demo.UserService/GetUser"])
	assert.True(t, reflEndpoints["/demo.UserService/SearchUsers"])
	assert.True(t, reflEndpoints["/demo.UserService/UpdateUser"])
	assert.True(t, reflEndpoints["/demo.UserService/ExecuteDiagnostic"])
	assert.True(t, reflEndpoints["/demo.UserService/DeleteUser"])

	// 3. Configure full Swazz Fuzzing Runner with RANDOM, BOUNDARY, MALICIOUS profiles
	cfg := &swagger.Config{
		BaseURL:   "grpc://" + serverAddr,
		Endpoints: reflRes.Endpoints,
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
		Settings: swagger.Settings{
			IterationsPerProfile: 20,
			Concurrency:          2,
			Profiles: []swagger.FuzzingProfile{
				swagger.ProfileRandom,
				swagger.ProfileBoundary,
				swagger.ProfileMalicious,
			},
			AnalyzeResponseBody: true,
			TimeoutMs:           5000,
		},
	}

	r := runner.New(cfg, nil)
	require.NotNil(t, r)
	defer r.Close()

	// 4. Subscribe and collect fuzz results
	resultsCh := r.Subscribe()
	var allFuzzResults []*swagger.FuzzResult
	findingsByRule := make(map[string][]swagger.AnalysisFinding)
	var findingsMu sync.Mutex
	done := make(chan struct{})

	go func() {
		for evt := range resultsCh {
			if evt.Type == runner.EventResult {
				if res, ok := evt.Data.(*swagger.FuzzResult); ok {
					findingsMu.Lock()
					allFuzzResults = append(allFuzzResults, res)
					for _, f := range res.AnalyzerFindings {
						findingsByRule[f.RuleID] = append(findingsByRule[f.RuleID], f)
					}
					findingsMu.Unlock()
				}
			}
			if evt.Type == runner.EventComplete {
				break
			}
		}
		close(done)
	}()

	// 5. Execute Fuzzing Run
	runErr := r.Start(context.Background())
	require.NoError(t, runErr)

	select {
	case <-done:
	case <-time.After(20 * time.Second):
		t.Fatal("Timeout waiting for runner EventComplete")
	}
	r.Unsubscribe(resultsCh)

	// 6. Assertions on results and vulnerability findings
	findingsMu.Lock()
	defer findingsMu.Unlock()

	assert.NotEmpty(t, allFuzzResults, "Expected fuzz results from runner execution")

	// Verify swazz/grpc-internal-error was detected from UpdateUser (panic / runtime error)
	grpcInternalFindings := findingsByRule["swazz/grpc-internal-error"]
	assert.NotEmpty(t, grpcInternalFindings, "Expected finding 'swazz/grpc-internal-error' to be captured")

	// Verify swazz/sql-error-leak was detected from SearchUsers (SQL injection simulation)
	sqliFindings := findingsByRule["swazz/sql-error-leak"]
	assert.NotEmpty(t, sqliFindings, "Expected finding 'swazz/sql-error-leak' (SQLi) to be captured")

	// Verify swazz/cmdi-leak was detected from ExecuteDiagnostic (Command injection simulation)
	cmdiFindings := findingsByRule["swazz/cmdi-leak"]
	assert.NotEmpty(t, cmdiFindings, "Expected finding 'swazz/cmdi-leak' (Command Injection) to be captured")

	t.Logf("Integration test summary: %d results executed, %d unique finding rules detected",
		len(allFuzzResults), len(findingsByRule))
	for ruleID, findings := range findingsByRule {
		t.Logf(" - %s: %d occurrences", ruleID, len(findings))
	}
}
