// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/swagger"
)

// A webmcp:// endpoint must never be turned into an HTTP request against the
// target: the tool only exists inside a browser page.
func TestExecuteRequest_WebMCPFailsClosed(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	r := &Runner{}
	res := r.executeRequest(
		context.Background(),
		srv.URL, "webmcp://tool/delete_account", "webmcp://tool/delete_account", "CALL",
		nil, nil, map[string]any{"confirm": true},
		swagger.ProfileMalicious, nil, nil, "application/json",
	)

	require.NotNil(t, res)
	assert.Equal(t, int32(0), hits.Load(), "no HTTP request may reach the target")
	assert.Equal(t, 0, res.Status)
	assert.Empty(t, res.ResponseBody)
	assert.Contains(t, res.Error, "browser-side executor")
	assert.Equal(t, "webmcp://tool/delete_account", res.Endpoint)
}
