// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package ws

import (
	"context"
	"errors"
	"net/http"

	"nhooyr.io/websocket"

	"swazz-engine/internal/security"
)

// Client sends one message per connection (see SendMessage). It keeps no connection, so it is
// safe for concurrent use and has nothing to close.
type Client struct {
	// The HTTP client of the handshake; nil is the library's default (http.DefaultClient).
	httpClient *http.Client
}

// NewClient creates a WebSocket client. Unless allowPrivate is set, it refuses to connect to
// private and reserved addresses, like the runner's HTTP client (see protectedHTTPClient).
func NewClient(allowPrivate bool) *Client {
	c := &Client{}
	if !allowPrivate {
		c.httpClient = protectedHTTPClient
	}
	return c
}

// protectedHTTPClient makes the handshake through security.NewSSRFProtectedTransport, the
// transport the HTTP executor's guard is built from, so a WebSocket target cannot reach a private
// or reserved address the HTTP one may not; the connection then stays on that checked socket. It
// has no proxy: a proxy would resolve and dial the target itself, out of the check's reach. No
// Timeout, which the WebSocket library refuses: the caller's context bounds the handshake.
var protectedHTTPClient = &http.Client{Transport: security.NewSSRFProtectedTransport(false)}

// MapWSCloseCodeToHTTPStatus maps RFC 6455 WebSocket close codes to HTTP status codes.
func MapWSCloseCodeToHTTPStatus(code websocket.StatusCode) int {
	switch code {
	case websocket.StatusNormalClosure: // 1000
		return http.StatusOK
	case websocket.StatusProtocolError, websocket.StatusUnsupportedData, websocket.StatusInvalidFramePayloadData: // 1002, 1003, 1007
		return http.StatusBadRequest
	case websocket.StatusPolicyViolation: // 1008
		return http.StatusForbidden
	case websocket.StatusMessageTooBig: // 1009
		return http.StatusRequestEntityTooLarge
	case websocket.StatusAbnormalClosure, websocket.StatusInternalError: // 1006, 1011
		return http.StatusInternalServerError
	default:
		return http.StatusInternalServerError
	}
}

// SendMessage opens a connection to endpoint, writes payload, reads one message back and closes
// the connection.
func (c *Client) SendMessage(ctx context.Context, endpoint string, payload []byte, headers map[string]string) ([]byte, int, error) {
	httpHeader := http.Header{}
	for k, v := range headers {
		httpHeader.Set(k, v)
	}

	conn, resp, err := websocket.Dial(ctx, endpoint, &websocket.DialOptions{
		HTTPHeader: httpHeader,
		HTTPClient: c.httpClient,
	})
	if err != nil {
		if errors.Is(err, security.ErrSSRFBlocked) {
			// Never contacted: a network error like the HTTP executor's, not a status of the target.
			return nil, 0, err
		}
		if resp != nil {
			return nil, resp.StatusCode, err
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, http.StatusGatewayTimeout, err
		}
		// No answer at all (refused, reset, DNS): a network error, not a 5xx of the target.
		return nil, 0, err
	}
	// No close handshake: the library gives a peer that ignores the close frame seconds of its
	// own (beyond ctx), which would hold every exchange with such a target past its timeout.
	defer conn.CloseNow()

	if err := conn.Write(ctx, websocket.MessageText, payload); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, http.StatusGatewayTimeout, err
		}
		return nil, http.StatusInternalServerError, err
	}

	typ, msg, err := conn.Read(ctx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, http.StatusGatewayTimeout, err
		}
		code := websocket.CloseStatus(err)
		if code != -1 {
			return nil, MapWSCloseCodeToHTTPStatus(code), err
		}
		return nil, http.StatusInternalServerError, err
	}

	_ = typ // ignore type for now

	return msg, http.StatusOK, nil
}
