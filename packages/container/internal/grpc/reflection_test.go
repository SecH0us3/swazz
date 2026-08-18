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
	"google.golang.org/grpc/reflection"
)

func TestDiscoverViaReflection(t *testing.T) {
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer lis.Close()

	srv := grpc.NewServer()
	reflection.Register(srv)

	go func() {
		_ = srv.Serve(lis)
	}()
	defer srv.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	res, err := DiscoverViaReflection(ctx, lis.Addr().String(), false, nil)
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.Equal(t, lis.Addr().String(), res.BasePath)
}

func TestDiscoverViaReflection_InvalidAddr(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	// Try to discover on an address where nothing is listening
	_, err := DiscoverViaReflection(ctx, "127.0.0.1:54321", false, nil)
	assert.Error(t, err)
}

func TestDiscoverViaReflection_WithHeaders(t *testing.T) {
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer lis.Close()

	srv := grpc.NewServer()
	reflection.Register(srv)

	go func() {
		_ = srv.Serve(lis)
	}()
	defer srv.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	headers := map[string]string{
		"authorization": "Bearer test-token",
	}
	res, err := DiscoverViaReflection(ctx, "grpc://"+lis.Addr().String(), false, headers)
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.Equal(t, "grpc://"+lis.Addr().String(), res.BasePath)
}
