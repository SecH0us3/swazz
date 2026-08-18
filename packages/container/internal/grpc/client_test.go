// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package grpc

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestMapGRPCCodeToHTTPStatus(t *testing.T) {
	assert.Equal(t, 200, MapGRPCCodeToHTTPStatus(codes.OK))
	assert.Equal(t, 400, MapGRPCCodeToHTTPStatus(codes.InvalidArgument))
	assert.Equal(t, 404, MapGRPCCodeToHTTPStatus(codes.NotFound))
	assert.Equal(t, 409, MapGRPCCodeToHTTPStatus(codes.AlreadyExists))
	assert.Equal(t, 403, MapGRPCCodeToHTTPStatus(codes.PermissionDenied))
	assert.Equal(t, 401, MapGRPCCodeToHTTPStatus(codes.Unauthenticated))
	assert.Equal(t, 429, MapGRPCCodeToHTTPStatus(codes.ResourceExhausted))
	assert.Equal(t, 412, MapGRPCCodeToHTTPStatus(codes.FailedPrecondition))
	assert.Equal(t, 409, MapGRPCCodeToHTTPStatus(codes.Aborted))
	assert.Equal(t, 400, MapGRPCCodeToHTTPStatus(codes.OutOfRange))
	assert.Equal(t, 499, MapGRPCCodeToHTTPStatus(codes.Canceled))
	assert.Equal(t, 501, MapGRPCCodeToHTTPStatus(codes.Unimplemented))
	assert.Equal(t, 500, MapGRPCCodeToHTTPStatus(codes.Internal))
	assert.Equal(t, 500, MapGRPCCodeToHTTPStatus(codes.Unknown))
	assert.Equal(t, 500, MapGRPCCodeToHTTPStatus(codes.DataLoss))
	assert.Equal(t, 504, MapGRPCCodeToHTTPStatus(codes.DeadlineExceeded))
	assert.Equal(t, 503, MapGRPCCodeToHTTPStatus(codes.Unavailable))
	assert.Equal(t, 500, MapGRPCCodeToHTTPStatus(codes.Code(999)))
}

func TestRawCodec(t *testing.T) {
	codec := &rawCodec{}
	assert.Equal(t, "raw", codec.Name())

	data := []byte("hello protobuf wire")
	marshaled, err := codec.Marshal(data)
	require.NoError(t, err)
	assert.Equal(t, data, marshaled)

	marshaledPtr, err := codec.Marshal(&data)
	require.NoError(t, err)
	assert.Equal(t, data, marshaledPtr)

	_, err = codec.Marshal("invalid type")
	assert.Error(t, err)

	var unmarshaled []byte
	err = codec.Unmarshal(data, &unmarshaled)
	require.NoError(t, err)
	assert.Equal(t, data, unmarshaled)

	var invalidTarget string
	err = codec.Unmarshal(data, &invalidTarget)
	assert.Error(t, err)
}

func TestClient_Invoke(t *testing.T) {
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer lis.Close()

	// Use UnknownServiceHandler to mock arbitrary RPCs
	srv := grpc.NewServer(
		grpc.UnknownServiceHandler(func(srv interface{}, stream grpc.ServerStream) error {
			md, _ := metadata.FromIncomingContext(stream.Context())
			if len(md.Get("x-test-error")) > 0 {
				return status.Error(codes.InvalidArgument, "invalid argument provided")
			}
			if len(md.Get("x-test-panic")) > 0 {
				return status.Error(codes.Internal, "panic: nil pointer dereference")
			}

			var reqBytes []byte
			if err := stream.RecvMsg(&reqBytes); err != nil {
				return err
			}
			respBytes := append([]byte("echo: "), reqBytes...)
			return stream.SendMsg(&respBytes)
		}),
	)

	go func() {
		_ = srv.Serve(lis)
	}()
	defer srv.Stop()

	client := NewClient("grpc://"+lis.Addr().String(), false, map[string]string{"client-hdr": "val1"})
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 1. Successful Invoke
	resp, statusHttp, err := client.Invoke(ctx, "/test.Service/Echo", []byte("hello"), nil)
	require.NoError(t, err)
	assert.Equal(t, 200, statusHttp)
	assert.Equal(t, "echo: hello", string(resp))

	// 2. Error Invoke (InvalidArgument -> 400)
	_, statusHttp400, err400 := client.Invoke(ctx, "/test.Service/Echo", []byte("hello"), map[string]string{"x-test-error": "1"})
	assert.Error(t, err400)
	assert.Equal(t, 400, statusHttp400)

	// 3. Error Invoke (Internal -> 500)
	_, statusHttp500, err500 := client.Invoke(ctx, "/test.Service/Echo", []byte("hello"), map[string]string{"x-test-panic": "1"})
	assert.Error(t, err500)
	assert.Equal(t, 500, statusHttp500)

	// Test Connect idempotency
	require.NoError(t, client.Connect(ctx))
	require.NoError(t, client.Connect(ctx))

	// Test Close idempotency
	require.NoError(t, client.Close())
	require.NoError(t, client.Close())
}

func TestClient_TLSInit(t *testing.T) {
	client := NewClient("grpcs://localhost:50051", true, nil)
	assert.NotNil(t, client)
	assert.True(t, client.isTLS)
	assert.Equal(t, "localhost:50051", client.addr)
}
