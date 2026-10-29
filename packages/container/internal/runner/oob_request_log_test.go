// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"

	"swazz-engine/internal/oob"
	"swazz-engine/internal/swagger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A MALICIOUS request registers itself with each OOB token it carries, wherever the payload put
// the token (body, query, header, cookie), and the logged body is the body as sent.
func TestExecuteRequest_MaliciousRequestIsLoggedForItsOOBTokens(t *testing.T) {
	const (
		inBody   = "11111111-1111-4111-8111-111111111111"
		inQuery  = "22222222-2222-4222-8222-222222222222"
		inHeader = "33333333-3333-4333-8333-333333333333"
		inCookie = "44444444-4444-4444-8444-444444444444"
	)
	for _, ct := range []string{"application/json", "application/x-www-form-urlencoded"} {
		t.Run(ct, func(t *testing.T) {
			var sent string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				b, _ := io.ReadAll(r.Body)
				sent = string(b)
				w.WriteHeader(http.StatusNoContent)
			}))
			t.Cleanup(srv.Close)
			r := New(&swagger.Config{BaseURL: srv.URL, Security: swagger.SecurityConfig{AllowPrivateIPs: true}, Settings: swagger.Settings{TimeoutMs: 5000}}, srv.Client())
			t.Cleanup(r.Close)

			tokens := []string{inBody, inQuery, inHeader, inCookie}
			for _, tok := range tokens {
				r.oobStore.RegisterUUID(tok, &oob.OOBContext{Endpoint: "/hook"})
			}

			res := r.executeRequest(context.Background(), srv.URL, "/hook", "/hook", "POST",
				map[string]string{"X-Trace": "t-" + inHeader},
				map[string]string{"session": inCookie},
				map[string]any{"callback": "http://oob.example/" + inBody},
				swagger.ProfileMalicious,
				map[string]any{"next": inQuery},
				nil, ct)
			require.NotNil(t, res)
			require.Empty(t, res.Error)
			require.NotEmpty(t, sent)

			for _, tok := range tokens {
				ctx, ok := r.oobStore.GetAndRemoveUUID(tok)
				require.True(t, ok, tok)
				require.NotNil(t, ctx.Request, "request not logged for the token in %s", tok)
				assert.Equal(t, sent, ctx.Request.Body, "logged body is the wire body")
				assert.Equal(t, "POST", ctx.Request.Method)
			}
		})
	}
}

// Every part of the request is searched, and nothing but UUIDs is returned.
func TestOOBUUIDsInRequest(t *testing.T) {
	got := oobUUIDsInRequest(
		"http://h/a/aaaaaaaa-0000-4000-8000-000000000001?q=bbbbbbbb-0000-4000-8000-000000000002",
		map[string]string{"X-cccccccc-0000-4000-8000-000000000003": "dddddddd-0000-4000-8000-000000000004", "Plain": "value"},
		[]byte(`{"x":"eeeeeeee-0000-4000-8000-000000000005","y":"not-a-uuid"}`),
	)
	sort.Strings(got)
	assert.Equal(t, []string{
		"aaaaaaaa-0000-4000-8000-000000000001",
		"bbbbbbbb-0000-4000-8000-000000000002",
		"cccccccc-0000-4000-8000-000000000003",
		"dddddddd-0000-4000-8000-000000000004",
		"eeeeeeee-0000-4000-8000-000000000005",
	}, got)
	assert.Empty(t, oobUUIDsInRequest("http://h/", nil, nil))
}

func TestOOBUUIDsInRequest_Boundaries(t *testing.T) {
	const validUUID = "11111111-2222-4333-8444-555555555555"

	// Boundary 1: Body exactly 36 bytes (exact UUID)
	assert.Equal(t, []string{validUUID}, oobUUIDsInRequest("http://h/", nil, []byte(validUUID)))

	// Boundary 2: Body 35 bytes (1 byte shorter than minimum UUID)
	assert.Empty(t, oobUUIDsInRequest("http://h/", nil, []byte(validUUID[:35])))

	// Boundary 3: Body >= 36 bytes but only 2 hyphens (typical JSON date/identifier)
	assert.Empty(t, oobUUIDsInRequest("http://h/", nil, []byte(`{"date":"2026-10-29","action":"update"}`)))

	// Boundary 4: Standard headers with hyphens but < 36 chars or < 4 hyphens
	headers := map[string]string{
		"Content-Type":  "application/json",
		"User-Agent":    "Mozilla/5.0-Custom-Agent",
		"X-Request-Id":  "req-12345-abcde",
		"Authorization": "Bearer token-without-uuid",
	}
	assert.Empty(t, oobUUIDsInRequest("http://h/", headers, nil))

	// Boundary 5: Header with exact UUID value
	headers["X-OOB-Callback"] = validUUID
	assert.Equal(t, []string{validUUID}, oobUUIDsInRequest("http://h/", headers, nil))

	// Boundary 6: URL < 36 chars with hyphens
	assert.Empty(t, oobUUIDsInRequest("http://h/a-b-c-d", nil, nil))

	// Boundary 7: URL >= 36 chars with < 4 hyphens
	assert.Empty(t, oobUUIDsInRequest("http://example.com/api/v1/items-with-name", nil, nil))
}

func TestOOBUUIDsInRequest_Equivalence(t *testing.T) {
	unoptimized := func(rawURL string, headers map[string]string, body []byte) []string {
		var matches []string
		matches = append(matches, uuidRegex.FindAllString(rawURL, -1)...)
		for k, v := range headers {
			matches = append(matches, uuidRegex.FindAllString(k, -1)...)
			matches = append(matches, uuidRegex.FindAllString(v, -1)...)
		}
		for _, m := range uuidRegex.FindAll(body, -1) {
			matches = append(matches, string(m))
		}
		return matches
	}

	testCases := []struct {
		url     string
		headers map[string]string
		body    []byte
	}{
		{"", nil, nil},
		{"http://example.com", nil, nil},
		{"http://example.com/11111111-2222-4333-8444-555555555555", nil, nil},
		{"http://example.com/item-123-abc", map[string]string{"Content-Type": "application/json"}, []byte(`{"date":"2026-10-29"}`)},
		{
			"http://target/api/oob/aaaaaaaa-1111-4222-8333-444444444444",
			map[string]string{
				"X-bbbbbbbb-2222-4333-8444-555555555555": "normal-value",
				"X-Normal-Header":                        "cccccccc-3333-4444-8555-666666666666",
			},
			[]byte(`{"data":"dddddddd-4444-4555-8666-777777777777","extra":"some-text-with-hyphens"}`),
		},
	}

	for _, tc := range testCases {
		got := oobUUIDsInRequest(tc.url, tc.headers, tc.body)
		want := unoptimized(tc.url, tc.headers, tc.body)
		sort.Strings(got)
		sort.Strings(want)
		assert.Equal(t, want, got)
	}
}
