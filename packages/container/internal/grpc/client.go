// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package grpc

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/encoding"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func init() {
	// Register a raw bytes codec for dynamic payload invocation
	encoding.RegisterCodec(&rawCodec{})
}

type rawCodec struct{}

func (c *rawCodec) Marshal(v any) ([]byte, error) {
	if b, ok := v.([]byte); ok {
		return b, nil
	}
	if b, ok := v.(*[]byte); ok {
		return *b, nil
	}
	return nil, fmt.Errorf("rawCodec: expected []byte, got %T", v)
}

func (c *rawCodec) Unmarshal(data []byte, v any) error {
	if b, ok := v.(*[]byte); ok {
		*b = make([]byte, len(data))
		copy(*b, data)
		return nil
	}
	return fmt.Errorf("rawCodec: expected *[]byte, got %T", v)
}

func (c *rawCodec) Name() string {
	return "raw"
}

// Client manages connections and unary gRPC method invocations.
type Client struct {
	addr     string
	isTLS    bool
	metadata map[string]string
	conn     *grpc.ClientConn
	mu       sync.Mutex
}

// NewClient creates a new gRPC client instance.
func NewClient(addr string, isTLS bool, md map[string]string) *Client {
	cleanAddr := strings.TrimPrefix(addr, "grpc://")
	cleanAddr = strings.TrimPrefix(cleanAddr, "grpcs://")
	return &Client{
		addr:     cleanAddr,
		isTLS:    isTLS,
		metadata: md,
	}
}

// Connect establishes the underlying gRPC connection.
func (c *Client) Connect(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		return nil
	}

	var dialOpt grpc.DialOption
	if c.isTLS {
		dialOpt = grpc.WithTransportCredentials(credentials.NewTLS(nil))
	} else {
		dialOpt = grpc.WithTransportCredentials(insecure.NewCredentials())
	}

	conn, err := grpc.NewClient(c.addr, dialOpt)
	if err != nil {
		return fmt.Errorf("failed to create gRPC client for %s: %w", c.addr, err)
	}
	c.conn = conn
	return nil
}

// Close closes the gRPC client connection.
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		err := c.conn.Close()
		c.conn = nil
		return err
	}
	return nil
}

// Invoke executes a unary RPC call with binary request payload.
func (c *Client) Invoke(ctx context.Context, method string, reqPayload []byte, extraHeaders map[string]string) ([]byte, int, error) {
	if err := c.Connect(ctx); err != nil {
		return nil, 500, err
	}

	mdMap := make(map[string]string)
	for k, v := range c.metadata {
		mdMap[k] = v
	}
	for k, v := range extraHeaders {
		mdMap[k] = v
	}

	if len(mdMap) > 0 {
		ctx = metadata.NewOutgoingContext(ctx, metadata.New(mdMap))
	}

	var respBytes []byte
	callErr := c.conn.Invoke(ctx, method, reqPayload, &respBytes, grpc.CallContentSubtype("raw"))

	if callErr != nil {
		st, ok := status.FromError(callErr)
		if ok {
			httpStatus := MapGRPCCodeToHTTPStatus(st.Code())
			return respBytes, httpStatus, callErr
		}
		return respBytes, 500, callErr
	}

	return respBytes, 200, nil
}

// MapGRPCCodeToHTTPStatus translates gRPC status codes to standard HTTP status integers.
func MapGRPCCodeToHTTPStatus(code codes.Code) int {
	switch code {
	case codes.OK:
		return 200
	case codes.Canceled:
		return 499
	case codes.Unknown:
		return 500
	case codes.InvalidArgument:
		return 400
	case codes.DeadlineExceeded:
		return 504
	case codes.NotFound:
		return 404
	case codes.AlreadyExists:
		return 409
	case codes.PermissionDenied:
		return 403
	case codes.ResourceExhausted:
		return 429
	case codes.FailedPrecondition:
		return 412
	case codes.Aborted:
		return 409
	case codes.OutOfRange:
		return 400
	case codes.Unimplemented:
		return 501
	case codes.Internal:
		return 500
	case codes.Unavailable:
		return 503
	case codes.DataLoss:
		return 500
	case codes.Unauthenticated:
		return 401
	default:
		return 500
	}
}
