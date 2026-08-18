// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package grpc

import (
	"context"
	"fmt"
	"io"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	rpb "google.golang.org/grpc/reflection/grpc_reflection_v1alpha"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/descriptorpb"
	swazzProto "swazz-engine/internal/proto"
	"swazz-engine/internal/swagger"
)

// DiscoverViaReflection queries a live gRPC server for available services and schemas.
func DiscoverViaReflection(ctx context.Context, targetAddr string, isTLS bool, reqHeaders map[string]string) (*swagger.ParseResult, error) {
	cleanAddr := strings.TrimPrefix(targetAddr, "grpc://")
	cleanAddr = strings.TrimPrefix(cleanAddr, "grpcs://")

	var dialOpt grpc.DialOption
	if isTLS {
		dialOpt = grpc.WithTransportCredentials(credentials.NewTLS(nil))
	} else {
		dialOpt = grpc.WithTransportCredentials(insecure.NewCredentials())
	}

	conn, err := grpc.NewClient(cleanAddr, dialOpt)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to gRPC server at %s: %w", cleanAddr, err)
	}
	defer conn.Close()

	client := rpb.NewServerReflectionClient(conn)

	if len(reqHeaders) > 0 {
		md := metadata.New(reqHeaders)
		ctx = metadata.NewOutgoingContext(ctx, md)
	}

	stream, err := client.ServerReflectionInfo(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to open reflection stream: %w", err)
	}
	defer stream.CloseSend()

	// 1. Request service list
	if err := stream.Send(&rpb.ServerReflectionRequest{
		MessageRequest: &rpb.ServerReflectionRequest_ListServices{
			ListServices: "*",
		},
	}); err != nil {
		return nil, fmt.Errorf("failed to send list services request: %w", err)
	}

	resp, err := stream.Recv()
	if err != nil {
		return nil, fmt.Errorf("failed to receive list services response: %w", err)
	}

	listResp := resp.GetListServicesResponse()
	if listResp == nil {
		return nil, fmt.Errorf("unexpected reflection response: missing ListServicesResponse")
	}

	fileDescMap := make(map[string]*descriptorpb.FileDescriptorProto)

	// 2. Fetch FileDescriptorProto for each service
	for _, svc := range listResp.Service {
		svcName := svc.Name
		if svcName == "grpc.reflection.v1alpha.ServerReflection" || svcName == "grpc.reflection.v1.ServerReflection" {
			continue
		}

		if err := stream.Send(&rpb.ServerReflectionRequest{
			MessageRequest: &rpb.ServerReflectionRequest_FileContainingSymbol{
				FileContainingSymbol: svcName,
			},
		}); err != nil {
			continue
		}

		fileResp, err := stream.Recv()
		if err != nil {
			if err == io.EOF {
				break
			}
			continue
		}

		fdResp := fileResp.GetFileDescriptorResponse()
		if fdResp == nil {
			continue
		}

		for _, rawFd := range fdResp.FileDescriptorProto {
			fd := &descriptorpb.FileDescriptorProto{}
			if err := proto.Unmarshal(rawFd, fd); err == nil && fd.Name != nil {
				fileDescMap[*fd.Name] = fd
			}
		}
	}

	// 3. Build FileDescriptorSet and convert to protoreflect
	var fds []protoreflect.FileDescriptor
	files := &descriptorpb.FileDescriptorSet{}
	for _, fd := range fileDescMap {
		files.File = append(files.File, fd)
	}

	reg, err := protodesc.NewFiles(files)
	if err != nil {
		// Fallback: parse individually
		for _, fd := range fileDescMap {
			if f, err := protodesc.NewFile(fd, nil); err == nil {
				fds = append(fds, f)
			}
		}
	} else {
		reg.RangeFiles(func(fd protoreflect.FileDescriptor) bool {
			fds = append(fds, fd)
			return true
		})
	}

	parseResult := swazzProto.ConvertFileDescriptorsToEndpoints(fds, targetAddr)
	return parseResult, nil
}
