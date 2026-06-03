package runner

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"swazz-engine/internal/swagger"
	"testing"
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
		assert.Len(t, got, 64) // hex-encoded 32 bytes
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
