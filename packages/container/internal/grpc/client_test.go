// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package grpc

import (
	"context"
	"net"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/reflection"
	"google.golang.org/grpc/status"

	"swazz-engine/internal/security"
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

	client := NewClient("grpc://"+lis.Addr().String(), false, map[string]string{"client-hdr": "val1"}, true)
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
	client := NewClient("grpcs://localhost:50051", true, nil, true)
	assert.NotNil(t, client)
	assert.True(t, client.isTLS)
	assert.Equal(t, "localhost:50051", client.addr)
}

// countingListener counts the connections a server accepts.
type countingListener struct {
	net.Listener
	accepted atomic.Int32
}

func (l *countingListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err == nil {
		l.accepted.Add(1)
	}
	return c, err
}

// startEchoServer starts a gRPC server on loopback that answers any method.
func startEchoServer(t *testing.T) *countingListener {
	t.Helper()
	inner, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	lis := &countingListener{Listener: inner}
	srv := grpc.NewServer(
		grpc.UnknownServiceHandler(func(_ any, stream grpc.ServerStream) error {
			var req []byte
			if err := stream.RecvMsg(&req); err != nil {
				return err
			}
			return stream.SendMsg(&req)
		}),
	)
	reflection.Register(srv)
	go func() { _ = srv.Serve(lis) }()
	t.Cleanup(srv.Stop)
	return lis
}

// Unless the scan may reach private addresses, neither a call nor reflection may connect to a
// loopback target: gRPC goes through the same SSRF check as the HTTP executor.
func TestClient_BlocksPrivateAddress(t *testing.T) {
	lis := startEchoServer(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	blocked := NewClient("grpc://"+lis.Addr().String(), false, nil, false)
	defer blocked.Close()
	_, code, err := blocked.Invoke(ctx, "/test.Service/Echo", []byte("hi"), nil)
	require.ErrorIs(t, err, security.ErrSSRFBlocked)
	assert.Zero(t, code, "a blocked target never answered: no status, not a 5xx finding")

	// By name too: the whole host is checked before gRPC resolves it address by address.
	_, port, err := net.SplitHostPort(lis.Addr().String())
	require.NoError(t, err)
	byName := NewClient("grpc://localhost:"+port, false, nil, false)
	defer byName.Close()
	_, code, err = byName.Invoke(ctx, "/test.Service/Echo", []byte("hi"), nil)
	require.ErrorIs(t, err, security.ErrSSRFBlocked)
	assert.Zero(t, code)

	_, err = DiscoverViaReflection(ctx, "grpc://"+lis.Addr().String(), false, nil, false)
	require.ErrorIs(t, err, security.ErrSSRFBlocked)
	assert.Zero(t, lis.accepted.Load(), "the blocked target must not be contacted")

	allowed := NewClient("grpc://"+lis.Addr().String(), false, nil, true)
	defer allowed.Close()
	resp, code, err := allowed.Invoke(ctx, "/test.Service/Echo", []byte("hi"), nil)
	require.NoError(t, err)
	assert.Equal(t, 200, code)
	assert.Equal(t, "hi", string(resp))
}
