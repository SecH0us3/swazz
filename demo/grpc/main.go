// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"context"
	_ "embed"
	"flag"
	"fmt"
	"log"
	"net"
	"strings"

	"github.com/bufbuild/protocompile"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/reflection"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/dynamicpb"
)

//go:embed demo.proto
var demoProtoSrc string

func main() {
	portFlag := flag.String("port", "50051", "Port to listen on")
	flag.Parse()

	// 1. Compile proto in-memory and register with global registry for reflection
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
	if err != nil {
		log.Fatalf("Failed to compile demo.proto: %v", err)
	}
	if len(files) == 0 {
		log.Fatalf("No file descriptors compiled from demo.proto")
	}

	fileDesc := files[0]
	if err := protoregistry.GlobalFiles.RegisterFile(fileDesc); err != nil {
		// Ignore already registered error in tests
		if !strings.Contains(err.Error(), "already registered") {
			log.Printf("Warning registering file descriptor: %v", err)
		}
	}

	// 2. Extract MessageDescriptors
	svcDesc := fileDesc.Services().ByName("UserService")
	if svcDesc == nil {
		log.Fatalf("UserService not found in demo.proto")
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

	// 3. Build gRPC ServiceDesc
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

					// Vulnerability: Sensitive data & secret leak on ID 999
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

					// Vulnerability: SQL Injection Simulation
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

					// Vulnerability: Unhandled Server Crash / Panic on invalid or negative ID
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
					// Vulnerability: Command Injection Simulation
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

					// Vulnerability: Broken Object Level Authorization (BOLA) / Unauthorized deletion
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

	lis, err := net.Listen("tcp", ":"+*portFlag)
	if err != nil {
		log.Fatalf("Failed to listen on :%s: %v", *portFlag, err)
	}

	srv := grpc.NewServer()
	srv.RegisterService(&grpcServiceDesc, nil)
	reflection.Register(srv)

	log.Printf("[gRPC Demo] Server listening on :%s (with reflection enabled)", *portFlag)
	if err := srv.Serve(lis); err != nil {
		log.Fatalf("gRPC server failed: %v", err)
	}
}
