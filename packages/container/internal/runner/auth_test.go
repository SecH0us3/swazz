package runner

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"swazz-engine/internal/swagger"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

)

func TestRunAuthSequence(t *testing.T) {
	// 1. Setup mock server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/login" {
			// Set some cookies
			http.SetCookie(w, &http.Cookie{Name: "session", Value: "secret-session"})
			http.SetCookie(w, &http.Cookie{Name: "ignore-me", Value: "trash"})

			// Return JSON with token
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]string{
					"token":  "bearer-123",
					"user":   "admin",
					"userId": "999",
				},
			})
			return
		}
		if r.URL.Path == "/verify/999" {
			// Check if we got the session cookie and the header from previous step
			cookie, err := r.Cookie("session")
			if err != nil || cookie.Value != "secret-session" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			auth := r.Header.Get("Authorization")
			if auth != "bearer-123" {
				w.WriteHeader(http.StatusForbidden)
				return
			}

			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	// 2. Define config
	cfg := &swagger.Config{
		BaseURL: server.URL,
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
		AuthSequence: []swagger.AuthStep{
			{
				Method:         "POST",
				URL:            "/login",
				Body:           map[string]string{"user": "admin"},
				ExtractCookies: []string{"session"}, // Ignore "ignore-me"
				ExtractJSON: map[string]string{
					"data.token": "Authorization",
				},
				ExtractVariables: map[string]string{
					"data.userId": "user_id",
				},
			},
			{
				Method: "GET",
				URL:    "/verify/{{user_id}}",
			},
		},
	}

	// 3. Run runner
	r := New(cfg, nil)
	defer r.Close()
	err := r.RunAuthSequence(context.Background())

	if err != nil {
		t.Fatalf("Auth sequence failed: %v", err)
	}

	// 4. Verify results
	if cfg.Cookies["session"] != "secret-session" {
		t.Errorf("Expected cookie 'session' to be 'secret-session', got '%s'", cfg.Cookies["session"])
	}
	if _, ok := cfg.Cookies["ignore-me"]; ok {
		t.Errorf("Cookie 'ignore-me' should have been filtered out")
	}
	if cfg.GlobalHeaders["Authorization"] != "bearer-123" {
		t.Errorf("Expected header 'Authorization' to be 'bearer-123', got '%s'", cfg.GlobalHeaders["Authorization"])
	}
}

func TestRunAuthSequenceFailures(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("crash"))
	}))
	defer server.Close()

	cfg := &swagger.Config{
		BaseURL: server.URL,
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
		AuthSequence: []swagger.AuthStep{
			{Method: "GET", URL: "/fail"},
		},
	}

	r := New(cfg, nil)
	defer r.Close()
	err := r.RunAuthSequence(context.Background())

	if err == nil {
		t.Fatal("Expected error for 500 status code, got nil")
	}
}

func TestParseExpression(t *testing.T) {
	tests := []struct {
		input   string
		wantErr bool
		check   func(t *testing.T, n *exprNode)
	}{
		{
			input: "uuid()",
			check: func(t *testing.T, n *exprNode) {
				require.Equal(t, "uuid", n.name)
				require.NotNil(t, n.args)
				require.Len(t, n.args, 0)
			},
		},
		{
			input: "solvePoW(serverChallenge, proofDifficulty)",
			check: func(t *testing.T, n *exprNode) {
				require.Equal(t, "solvePoW", n.name)
				require.Len(t, n.args, 2)
				require.Equal(t, "serverChallenge", n.args[0].name)
				require.Nil(t, n.args[0].args)
				require.Equal(t, "proofDifficulty", n.args[1].name)
			},
		},
		{
			input: "f(g(a), b)",
			check: func(t *testing.T, n *exprNode) {
				require.Equal(t, "f", n.name)
				require.Len(t, n.args, 2)
				require.Equal(t, "g", n.args[0].name)
				require.Len(t, n.args[0].args, 1)
				require.Equal(t, "a", n.args[0].args[0].name)
			},
		},
		{input: "()", wantErr: true},
		{input: "f(", wantErr: true},
		{input: "f(a,)", wantErr: true},
		{input: "", wantErr: true},
		{input: "f() extra", wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			node, err := parseExpression(tc.input)
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			tc.check(t, node)
		})
	}
}

func TestLooksLikeFuncCall(t *testing.T) {
	require.True(t, looksLikeFuncCall("uuid()"))
	require.True(t, looksLikeFuncCall("solvePoW(a, b)"))
	require.True(t, looksLikeFuncCall("  f(x)"))
	require.False(t, looksLikeFuncCall("{{operationId}}"))
	require.False(t, looksLikeFuncCall("literal string"))
	require.False(t, looksLikeFuncCall("staging"))
	require.False(t, looksLikeFuncCall(""))
}

func TestSolvePoW(t *testing.T) {
	challenge := "ABCD1234ABCD1234ABCD1234ABCD1234"
	nonce, err := solvePoW(challenge, 2)
	require.NoError(t, err)

	h := sha256.Sum256([]byte(challenge + nonce))
	assert.True(t, strings.HasPrefix(hex.EncodeToString(h[:]), "00"),
		"hash should start with 00, got %s", hex.EncodeToString(h[:]))
}

func TestSolvePoWDifficultyZero(t *testing.T) {
	nonce, err := solvePoW("ANYTHING", 0)
	require.NoError(t, err)
	assert.Equal(t, "0", nonce)
}

func TestSolvePoWNegativeDifficulty(t *testing.T) {
	_, err := solvePoW("X", -1)
	require.Error(t, err)
}

func TestRunAuthSequenceSetVariables(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/auth/token" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"operationId": "op-test-1",
				"challengeData": map[string]any{
					"challenge":       "ABCD1234ABCD1234ABCD1234ABCD1234",
					"proofDifficulty": 2,
				},
			})
			return
		}
		if r.URL.Path == "/api/auth/challenge" {
			var body map[string]string
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}

			if body["operationId"] != "op-test-1" {
				w.WriteHeader(http.StatusForbidden)
				return
			}

			// Verify encryptedKey is UUID
			uuidRegex := regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)
			if !uuidRegex.MatchString(body["encryptedKey"]) {
				w.WriteHeader(http.StatusBadRequest)
				return
			}

			// Verify PoW challenge
			nonce := body["challenge"]
			h := sha256.Sum256([]byte("ABCD1234ABCD1234ABCD1234ABCD1234" + nonce))
			if !strings.HasPrefix(hex.EncodeToString(h[:]), "00") {
				w.WriteHeader(http.StatusForbidden)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"twoFactorPublicKey": "pub-key-xyz",
			})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	cfg := &swagger.Config{
		BaseURL: server.URL,
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
		AuthSequence: []swagger.AuthStep{
			{
				Method: "POST",
				URL:    "/api/auth/token",
				ExtractVariables: map[string]string{
					"operationId":                   "operationId",
					"challengeData.challenge":       "serverChallenge",
					"challengeData.proofDifficulty": "proofDifficulty",
				},
			},
			{
				Method: "POST",
				URL:    "/api/auth/challenge",
				SetVariables: map[string]string{
					"encryptedKey": "uuid()",
					"powAnswer":    "solvePoW(serverChallenge, proofDifficulty)",
					"opIdCopy":     "{{operationId}}",
					"literalStr":   "staging",
				},
				Body: map[string]any{
					"operationId":  "{{operationId}}",
					"challenge":    "{{powAnswer}}",
					"encryptedKey": "{{encryptedKey}}",
				},
				ExtractVariables: map[string]string{
					"twoFactorPublicKey": "twoFactorPublicKey",
				},
			},
		},
	}

	r := New(cfg, nil)
	defer r.Close()
	err := r.RunAuthSequence(context.Background())
	require.NoError(t, err)

	uuidRegex := regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

	assert.Equal(t, "pub-key-xyz", cfg.Variables["twoFactorPublicKey"])
	assert.Regexp(t, uuidRegex, cfg.Variables["encryptedKey"])
	assert.NotRegexp(t, uuidRegex, cfg.Variables["powAnswer"])
	assert.Equal(t, "op-test-1", cfg.Variables["opIdCopy"])
	assert.Equal(t, "staging", cfg.Variables["literalStr"])

	// Verify nonce manually again here just in case
	nonce := fmt.Sprintf("%v", cfg.Variables["powAnswer"])
	h := sha256.Sum256([]byte("ABCD1234ABCD1234ABCD1234ABCD1234" + nonce))
	assert.True(t, strings.HasPrefix(hex.EncodeToString(h[:]), "00"))
}

func TestSetVariablesErrors(t *testing.T) {
	tests := []struct {
		name         string
		setVariables map[string]string
		wantErrMsg   string
	}{
		{
			name:         "UnknownFunction",
			setVariables: map[string]string{"x": "unknownFunc()"},
			wantErrMsg:   "unknown function \"unknownFunc\"",
		},
		{
			name:         "UndefinedVariable",
			setVariables: map[string]string{"x": "solvePoW(missingVar, proofDifficulty)"},
			wantErrMsg:   "undefined variable \"missingVar\"",
		},
		{
			name:         "ParseError",
			setVariables: map[string]string{"x": "uuid("},
			wantErrMsg:   "parse error",
		},
		{
			name:         "WrongArgCount",
			setVariables: map[string]string{"x": "solvePoW(onlyOneArg)"},
			wantErrMsg:   "solvePoW() takes 2 arguments (challenge, difficulty), got 1",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg := &swagger.Config{
				Variables: map[string]any{
					"proofDifficulty": "2",
					"onlyOneArg":      "1",
				},
				AuthSequence: []swagger.AuthStep{
					{
						Method:       "GET",
						URL:          "http://localhost",
						SetVariables: tc.setVariables,
					},
				},
			}
			r := New(cfg, nil)
			defer r.Close()
			err := r.RunAuthSequence(context.Background())
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.wantErrMsg)
		})
	}
}

// TestUUIDProducesDifferentValues verifies that two uuid() calls in the same
// set_variables step produce DIFFERENT UUIDs (regression test for caching bug).
func TestUUIDProducesDifferentValues(t *testing.T) {
	cfg := &swagger.Config{
		Variables: make(map[string]any),
	}
	r := New(cfg, nil)
	defer r.Close()

	cache := make(map[string]string)
	nodeA := &exprNode{name: "uuid", args: []*exprNode{}}
	nodeB := &exprNode{name: "uuid", args: []*exprNode{}}

	valA, err := r.evalExpr(nodeA, cache)
	require.NoError(t, err)
	valB, err := r.evalExpr(nodeB, cache)
	require.NoError(t, err)

	uuidRegex := regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)
	assert.Regexp(t, uuidRegex, valA)
	assert.Regexp(t, uuidRegex, valB)
	assert.NotEqual(t, valA, valB, "two uuid() calls must produce different values")
}

// TestSolvePoWDifficultyTooHigh verifies the fast-fail guard for difficulty > 64.
func TestSolvePoWDifficultyTooHigh(t *testing.T) {
	_, err := solvePoW("ANYTHING", 65)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds maximum SHA256 hex length of 64")
}

// TestDeterministicFunctionCacheHit verifies that a deterministic function
// with the same args is only computed once (cache hit on second call).
func TestDeterministicFunctionCacheHit(t *testing.T) {
	cfg := &swagger.Config{
		Variables: map[string]any{
			"challenge":  "ABCD1234ABCD1234ABCD1234ABCD1234",
			"difficulty": "2",
		},
	}
	r := New(cfg, nil)
	defer r.Close()

	cache := make(map[string]string)
	node := &exprNode{
		name: "solvePoW",
		args: []*exprNode{
			{name: "challenge"},
			{name: "difficulty"},
		},
	}

	val1, err := r.evalExpr(node, cache)
	require.NoError(t, err)

	val2, err := r.evalExpr(node, cache)
	require.NoError(t, err)

	assert.Equal(t, val1, val2, "deterministic function with same args must return cached result")
	// cacheKey for varRef nodes uses name+"()", so full key includes that
	_, cached := cache["solvePoW(challenge(),difficulty())"]
	assert.True(t, cached, "expected solvePoW result in cache")
}

func TestBuiltinFunctions(t *testing.T) {
	cfg := &swagger.Config{
		Variables: make(map[string]any),
	}
	r := New(cfg, nil)
	defer r.Close()

	call := func(name string, args ...string) (string, error) {
		return r.callBuiltin(name, args)
	}

	// ── sha256 ──
	t.Run("sha256", func(t *testing.T) {
		got, err := call("sha256", "hello")
		require.NoError(t, err)
		// SHA256("hello") is well-known
		assert.Equal(t, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", got)
	})

	t.Run("sha256/empty", func(t *testing.T) {
		got, err := call("sha256", "")
		require.NoError(t, err)
		assert.Len(t, got, 64) // hex-encoded 32 bytes
	})

	// ── hmacSHA256 ──
	t.Run("hmacSHA256", func(t *testing.T) {
		got, err := call("hmacSHA256", "message", "secret")
		require.NoError(t, err)
		assert.Len(t, got, 64)      // hex-encoded 32 bytes
		assert.NotEqual(t, got, "") // non-empty
	})

	t.Run("hmacSHA256/wrong_args", func(t *testing.T) {
		_, err := call("hmacSHA256", "only_one")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "takes 2 arguments")
	})

	// ── base64 ──
	t.Run("base64", func(t *testing.T) {
		got, err := call("base64", "hello world")
		require.NoError(t, err)
		assert.Equal(t, "aGVsbG8gd29ybGQ=", got)
	})

	// ── hex ──
	t.Run("hex", func(t *testing.T) {
		got, err := call("hex", "AB")
		require.NoError(t, err)
		assert.Equal(t, "4142", got)
	})

	// ── concat ──
	t.Run("concat/two", func(t *testing.T) {
		got, err := call("concat", "foo", "bar")
		require.NoError(t, err)
		assert.Equal(t, "foobar", got)
	})

	t.Run("concat/three", func(t *testing.T) {
		got, err := call("concat", "a", "b", "c")
		require.NoError(t, err)
		assert.Equal(t, "abc", got)
	})

	t.Run("concat/empty", func(t *testing.T) {
		got, err := call("concat")
		require.NoError(t, err)
		assert.Equal(t, "", got)
	})

	// ── upper / lower ──
	t.Run("upper", func(t *testing.T) {
		got, err := call("upper", "hello")
		require.NoError(t, err)
		assert.Equal(t, "HELLO", got)
	})

	t.Run("lower", func(t *testing.T) {
		got, err := call("lower", "HELLO")
		require.NoError(t, err)
		assert.Equal(t, "hello", got)
	})

	// ── trim ──
	t.Run("trim", func(t *testing.T) {
		got, err := call("trim", "  hello  ")
		require.NoError(t, err)
		assert.Equal(t, "hello", got)
	})

	t.Run("trim/tabs", func(t *testing.T) {
		got, err := call("trim", "\t\n value \n\t")
		require.NoError(t, err)
		assert.Equal(t, "value", got)
	})

	// ── substring ──
	t.Run("substring/normal", func(t *testing.T) {
		got, err := call("substring", "abcdef", "1", "4")
		require.NoError(t, err)
		assert.Equal(t, "bcd", got)
	})

	t.Run("substring/clamped", func(t *testing.T) {
		got, err := call("substring", "abc", "0", "100")
		require.NoError(t, err)
		assert.Equal(t, "abc", got) // end clamped to len
	})

	t.Run("substring/empty_range", func(t *testing.T) {
		got, err := call("substring", "abc", "3", "3")
		require.NoError(t, err)
		assert.Equal(t, "", got)
	})

	t.Run("substring/bad_start", func(t *testing.T) {
		_, err := call("substring", "abc", "x", "2")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "start must be integer")
	})

	// ── jsonPath ──
	t.Run("jsonPath/simple", func(t *testing.T) {
		got, err := call("jsonPath", `{"name":"alex"}`, "name")
		require.NoError(t, err)
		assert.Equal(t, "alex", got)
	})

	t.Run("jsonPath/nested", func(t *testing.T) {
		got, err := call("jsonPath", `{"data":{"token":"abc123"}}`, "data.token")
		require.NoError(t, err)
		assert.Equal(t, "abc123", got)
	})

	t.Run("jsonPath/missing", func(t *testing.T) {
		_, err := call("jsonPath", `{"name":"alex"}`, "missing")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not found")
	})

	t.Run("jsonPath/invalid_json", func(t *testing.T) {
		_, err := call("jsonPath", `not json`, "key")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "invalid JSON")
	})
}

func TestIsSessionExpired(t *testing.T) {
	cfg := &swagger.Config{
		Settings: swagger.Settings{
			AuthHeaders: []string{"Authorization"},
			AuthCookies: []string{"session_cookie"},
		},
		GlobalHeaders: map[string]string{"Authorization": "Bearer current-token"},
		Cookies:       map[string]string{"session_cookie": "current-session-id"},
	}
	r := New(cfg, nil)
	defer r.Close()

	// 1. HTTP 401 using current active session -> expired
	reqHeaders := map[string]string{"Authorization": "Bearer current-token"}
	reqCookies := map[string]string{"session_cookie": "current-session-id"}
	resp := &http.Response{StatusCode: 401}
	assert.True(t, r.isSessionExpired(resp, nil, reqHeaders, reqCookies, swagger.ProfileRandom))

	// 2. HTTP 401 using old/different session -> expired (since it contains active auth header keys and should trigger retry/refresh)
	oldHeaders := map[string]string{"Authorization": "Bearer old-token"}
	oldCookies := map[string]string{"session_cookie": "old-session-id"}
	assert.True(t, r.isSessionExpired(resp, nil, oldHeaders, oldCookies, swagger.ProfileRandom))

	// 3. Redirect to login -> expired
	redirectReq, _ := http.NewRequest("GET", "http://test.com/login", nil)
	redirectResp := &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"/login"}}, Request: redirectReq}
	assert.True(t, r.isSessionExpired(redirectResp, nil, reqHeaders, reqCookies, swagger.ProfileRandom))

	// 4. HTML response containing form with login indicators -> expired
	htmlBody := []byte(`<html><body><form action="/login" class="login-form"><input type="password" name="pwd"/></form></body></html>`)
	okResp := &http.Response{StatusCode: 200}
	assert.True(t, r.isSessionExpired(okResp, htmlBody, reqHeaders, reqCookies, swagger.ProfileRandom))

	// 5. BOLA profile -> should always return false to preserve expected findings
	assert.False(t, r.isSessionExpired(resp, nil, reqHeaders, reqCookies, swagger.FuzzingProfile("BOLA")))

	// 6. Unauthenticated request -> not expired
	assert.False(t, r.isSessionExpired(resp, nil, nil, nil, swagger.ProfileRandom))
}

func TestExtractCSRFToken(t *testing.T) {
	r := New(&swagger.Config{}, nil)
	defer r.Close()

	// 1. Extract from Cookie
	cookieResp := &http.Response{
		Header: http.Header{
			"Set-Cookie": []string{"csrf_token=cookie-csrf-val; Path=/"},
		},
	}
	r.extractAndSaveCSRFToken(cookieResp, nil)
	assert.Equal(t, "cookie-csrf-val", r.activeCSRFToken)

	// Reset
	r.activeCSRFToken = ""

	// 2. Extract from meta tag
	htmlMeta := []byte(`<html><head><meta name="csrf-token" content="meta-csrf-val"></head></html>`)
	resp := &http.Response{}
	r.extractAndSaveCSRFToken(resp, htmlMeta)
	assert.Equal(t, "meta-csrf-val", r.activeCSRFToken)

	// Reset
	r.activeCSRFToken = ""

	// 3. Extract from input tag
	htmlInput := []byte(`<html><body><input type="hidden" name="csrf-token" value="input-csrf-val"></body></html>`)
	r.extractAndSaveCSRFToken(resp, htmlInput)
	assert.Equal(t, "input-csrf-val", r.activeCSRFToken)

	// Reset
	r.activeCSRFToken = ""

	// 4. Extract from input tag with reversed attributes (value before name) and short name _csrf
	htmlReversedInput := []byte(`<html><body><input type="hidden" value="reversed-csrf-val" name="_csrf"></body></html>`)
	r.extractAndSaveCSRFToken(resp, htmlReversedInput)
	assert.Equal(t, "reversed-csrf-val", r.activeCSRFToken)

	// Reset
	r.activeCSRFToken = ""

	// 5. Extract from meta tag with reversed attributes and xsrf-token name
	htmlReversedMeta := []byte(`<html><head><meta content="reversed-xsrf-val" name="xsrf-token"></head></html>`)
	r.extractAndSaveCSRFToken(resp, htmlReversedMeta)
	assert.Equal(t, "reversed-xsrf-val", r.activeCSRFToken)

	// Reset
	r.activeCSRFToken = ""

	// 6. Extract from response headers (e.g. X-CSRF-Token)
	headerResp := &http.Response{
		Header: http.Header{
			"X-CSRF-Token": []string{"header-csrf-val"},
		},
	}
	r.extractAndSaveCSRFToken(headerResp, nil)
	assert.Equal(t, "header-csrf-val", r.activeCSRFToken)

	// Reset
	r.activeCSRFToken = ""

	// 7. Extract from response headers deterministically when multiple match (sorting keys)
	// Keys are: "X-XSRF-Token" and "X-CSRF-Token". Sorted: "X-CSRF-Token", "X-XSRF-Token"
	// So "X-CSRF-Token" should be picked first.
	multiHeaderResp := &http.Response{
		Header: http.Header{
			"X-XSRF-Token": []string{"xsrf-val"},
			"X-CSRF-Token": []string{"csrf-val"},
		},
	}
	r.extractAndSaveCSRFToken(multiHeaderResp, nil)
	assert.Equal(t, "csrf-val", r.activeCSRFToken)
}

func TestMaybeReauthenticate(t *testing.T) {
	// Setup mock server
	authCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"token": fmt.Sprintf("fresh-token-%d", authCount),
		})
	}))
	defer server.Close()

	cfg := &swagger.Config{
		BaseURL: server.URL,
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
		AuthSequence: []swagger.AuthStep{
			{
				Method: "POST",
				URL:    "/",
				ExtractJSON: map[string]string{
					"token": "Authorization",
				},
			},
		},
		Settings: swagger.Settings{
			AuthHeaders: []string{"Authorization"},
		},
		GlobalHeaders: map[string]string{"Authorization": "old-token"},
	}

	r := New(cfg, nil)
	defer r.Close()

	// 1. Initial call should trigger re-authentication
	reqHeaders := map[string]string{"Authorization": "old-token"}
	newH, _, refreshed, err := r.MaybeReauthenticate(context.Background(), reqHeaders, nil)
	require.NoError(t, err)
	assert.True(t, refreshed)
	assert.Equal(t, "fresh-token-1", newH["Authorization"])

	// 2. Concurrent check: if another request has headers that match the *old* token,
	// but the runner has already moved to "fresh-token-1", it should return immediately
	// using the fresh token without invoking the auth server again.
	newH2, _, refreshed2, err2 := r.MaybeReauthenticate(context.Background(), reqHeaders, nil)
	require.NoError(t, err2)
	assert.True(t, refreshed2)
	assert.Equal(t, "fresh-token-1", newH2["Authorization"])
	assert.Equal(t, 1, authCount) // authCount should remain 1!
}

func TestMaybeReauthenticateWithProbe(t *testing.T) {
	authCount := 0
	probeCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/probe" {
			probeCount++
			if r.Header.Get("Authorization") == "valid-token" {
				w.WriteHeader(http.StatusOK)
				return
			}
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Path == "/auth" {
			authCount++
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"token": "valid-token",
			})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	cfg := &swagger.Config{
		BaseURL: server.URL,
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
		AuthSequence: []swagger.AuthStep{
			{
				Method: "POST",
				URL:    "/auth",
				ExtractJSON: map[string]string{
					"token": "Authorization",
				},
			},
		},
		Settings: swagger.Settings{
			AuthHeaders:  []string{"Authorization"},
			AuthProbeURL: "/probe",
		},
		GlobalHeaders: map[string]string{"Authorization": "valid-token"},
	}

	r := New(cfg, nil)
	defer r.Close()

	reqHeaders := map[string]string{"Authorization": "valid-token"}
	newH, _, refreshed, err := r.MaybeReauthenticate(context.Background(), reqHeaders, nil)
	require.NoError(t, err)
	assert.False(t, refreshed)
	assert.Nil(t, newH)

	assert.Equal(t, "valid-token", r.config.GlobalHeaders["Authorization"])
	assert.Equal(t, 0, authCount)
	assert.Equal(t, 1, probeCount)


	// 2. Session is expired.
	// Set global token to "expired-token". Now probe will fail, and it should run the auth sequence.
	r.configMu.Lock()
	r.config.GlobalHeaders["Authorization"] = "expired-token"
	r.configMu.Unlock()
	r.lastProbeTime = time.Time{} // Clear cache to force probe

	reqHeaders2 := map[string]string{"Authorization": "expired-token"}
	newH2, _, refreshed2, err2 := r.MaybeReauthenticate(context.Background(), reqHeaders2, nil)
	require.NoError(t, err2)
	assert.True(t, refreshed2)
	assert.Equal(t, "valid-token", newH2["Authorization"])
	assert.Equal(t, 1, authCount)
	assert.Equal(t, 2, probeCount)
}

