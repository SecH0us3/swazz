// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz

package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/safenet"
)

// A 401 on a spec download reports the start of the body (capped, control characters removed),
// since the target controls it and the error is shown in the dashboard and the agent's log.
func TestParseRequest_AuthErrorBodyIsSanitized(t *testing.T) {
	safenet.AllowLocalNetwork = true
	defer func() { safenet.AllowLocalNetwork = false }()

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte("denied\r\nINFO forged\x1b[2J" + strings.Repeat("x", 1<<20)))
	}))
	defer ts.Close()

	outChan := make(chan interface{}, 5)
	d := NewAgentDispatcher("ws://localhost", "tok", false, outChan)
	t.Cleanup(d.Close)
	payload, _ := json.Marshal(map[string]string{"url": ts.URL + "/openapi.json"})
	d.Dispatch(context.Background(), WSMessageIn{Type: "parse_request", ReqID: "r1", Payload: payload})

	var out interface{}
	select {
	case out = <-outChan:
	case <-time.After(10 * time.Second):
		t.Fatal("no parse_result")
	}
	b, err := json.Marshal(out)
	require.NoError(t, err)
	var msg struct {
		Payload struct {
			Error    string `json:"error"`
			Response struct {
				Body string `json:"body"`
			} `json:"response"`
		} `json:"payload"`
	}
	require.NoError(t, json.Unmarshal(b, &msg), "%s", b)
	got := msg.Payload.Error
	assert.Contains(t, got, "authentication required (HTTP 401)")
	assert.Contains(t, got, "denied  INFO forged [2J")
	assert.NotContains(t, got, "\n")
	assert.NotContains(t, got, "\x1b")
	assert.Less(t, len(got), safenet.MaxErrorBodyBytes+200)
	assert.NotContains(t, msg.Payload.Response.Body, "\x1b")
}
