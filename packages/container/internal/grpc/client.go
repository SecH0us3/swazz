// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package grpc

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/encoding"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"

	"swazz-engine/internal/security"
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
	if pm, ok := v.(proto.Message); ok {
		return proto.Marshal(pm)
	}
	return nil, fmt.Errorf("rawCodec: expected []byte or proto.Message, got %T", v)
}

func (c *rawCodec) Unmarshal(data []byte, v any) error {
	if b, ok := v.(*[]byte); ok {
		*b = make([]byte, len(data))
		copy(*b, data)
		return nil
	}
	if pm, ok := v.(proto.Message); ok {
		return proto.Unmarshal(data, pm)
	}
	return fmt.Errorf("rawCodec: expected *[]byte or proto.Message, got %T", v)
}

func (c *rawCodec) Name() string {
	return "raw"
}

// Client manages connections and unary gRPC method invocations.
type Client struct {
	addr         string
	isTLS        bool
	allowPrivate bool
	metadata     map[string]string
	conn         *grpc.ClientConn
	mu           sync.Mutex
}

// NewClient creates a new gRPC client instance. Unless allowPrivate is set, it refuses to connect
// to private and reserved addresses, like the runner's HTTP client (see dialOptions).
func NewClient(addr string, isTLS bool, md map[string]string, allowPrivate bool) *Client {
	cleanAddr := strings.TrimPrefix(addr, "grpc://")
	cleanAddr = strings.TrimPrefix(cleanAddr, "grpcs://")
	cleanAddr = strings.TrimRight(cleanAddr, "/")
	return &Client{
		addr:         cleanAddr,
		isTLS:        isTLS,
		allowPrivate: allowPrivate,
		metadata:     md,
	}
}

// Connect establishes the underlying gRPC connection.
func (c *Client) Connect(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		return nil
	}

	target, err := checkedTarget(ctx, c.addr, c.allowPrivate)
	if err != nil {
		return err
	}
	conn, err := grpc.NewClient(target, dialOptions(c.isTLS, c.allowPrivate)...)
	if err != nil {
		return fmt.Errorf("failed to create gRPC client for %s: %w", c.addr, err)
	}
	c.conn = conn
	return nil
}

// checkedTarget returns the gRPC target to connect to addr (host:port). Unless allowPrivate is
// set, it first checks the host the way the HTTP executor does (security.ResolvePublic: one
// private address blocks the host, the error wraps security.ErrSSRFBlocked), and makes gRPC hand
// the name, not its addresses one by one, to the guarded dialer (passthrough), so the dialer
// applies the same rule on every connection. Non-goal: targets with a resolver scheme (dns:///,
// unix:) are refused, not supported, while the check applies.
func checkedTarget(ctx context.Context, addr string, allowPrivate bool) (string, error) {
	if allowPrivate {
		return addr, nil
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		host, port = addr, "443" // gRPC's default port
	}
	if _, err := security.ResolvePublic(ctx, host); err != nil {
		return "", fmt.Errorf("gRPC target %s: %w", addr, err)
	}
	return "passthrough:///" + net.JoinHostPort(host, port), nil
}

// dialOptions are the options every gRPC connection of the runner is made with. Unless
// allowPrivate is set, connections go through security.GuardedDialContext, the dial function the
// HTTP executor's guard uses, so a gRPC target cannot reach a private or reserved address the HTTP
// one may not. A proxy is then not used: it would resolve and dial the target itself, out of the
// check's reach.
func dialOptions(isTLS, allowPrivate bool) []grpc.DialOption {
	var opts []grpc.DialOption
	if isTLS {
		opts = append(opts, grpc.WithTransportCredentials(credentials.NewTLS(nil)))
	} else {
		opts = append(opts, grpc.WithTransportCredentials(insecure.NewCredentials()))
	}
	if !allowPrivate {
		dial := security.GuardedDialContext()
		opts = append(opts,
			grpc.WithNoProxy(),
			grpc.WithContextDialer(func(ctx context.Context, addr string) (net.Conn, error) {
				return dial(ctx, "tcp", addr)
			}),
		)
	}
	return opts
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
		if errors.Is(err, security.ErrSSRFBlocked) {
			// Never contacted: a network error like the HTTP executor's, not a status of the target.
			return nil, 0, err
		}
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
