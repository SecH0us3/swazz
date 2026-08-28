// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package ws

import (
	"context"
	"errors"
	"net/http"
	"sync"

	"nhooyr.io/websocket"
)

type Client struct {
	mu   sync.Mutex
	conn *websocket.Conn
}

func NewClient() *Client {
	return &Client{}
}

func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		err := c.conn.Close(websocket.StatusNormalClosure, "")
		c.conn = nil
		return err
	}
	return nil
}

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

func (c *Client) SendMessage(ctx context.Context, endpoint string, payload []byte, headers map[string]string) ([]byte, int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	httpHeader := http.Header{}
	for k, v := range headers {
		httpHeader.Set(k, v)
	}

	conn, resp, err := websocket.Dial(ctx, endpoint, &websocket.DialOptions{
		HTTPHeader: httpHeader,
	})
	if err != nil {
		if resp != nil {
			return nil, resp.StatusCode, err
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, http.StatusGatewayTimeout, err
		}
		return nil, http.StatusInternalServerError, err
	}

	// Close when done
	defer conn.Close(websocket.StatusNormalClosure, "")

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
