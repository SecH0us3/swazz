// auth.go: Handles authentication sequences and variable management.
// It provides functionality to run multi-step authentication flows, substitute
// variables in requests, and extract values from responses.

package runner

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"io"
	"net/http"
	"net/http/httputil"
	"strconv"
	"strings"
	"time"

	"swazz-engine/internal/swagger"
)

func (r *Runner) ExecuteAuthSequence(ctx context.Context, sequence []swagger.AuthStep, initialHeaders map[string]string, initialCookies map[string]string) (map[string]string, map[string]string, error) {
	cfg := r.config
	headers := make(map[string]string)
	cookies := make(map[string]string)
	for k, v := range initialHeaders {
		headers[k] = v
	}
	for k, v := range initialCookies {
		cookies[k] = v
	}

	if len(sequence) == 0 {
		return headers, cookies, nil
	}

	fmt.Printf("Running authentication sequence (%d steps)...\n", len(sequence))

	reqCtx, reqCancel := context.WithTimeout(ctx, 30*time.Second)
	defer reqCancel()

	for i, step := range sequence {

		if len(step.SetVariables) > 0 {
			cache := make(map[string]string) // кэш вызовов функций на этот шаг

			r.configMu.Lock()
			if cfg.Variables == nil {
				cfg.Variables = make(map[string]any)
			}
			r.configMu.Unlock()

			for varName, expr := range step.SetVariables {
				var result string
				var err error

				expr = strings.TrimSpace(expr)
				if looksLikeFuncCall(expr) {
					node, parseErr := parseExpression(expr)
					if parseErr != nil {
						return nil, nil, fmt.Errorf("auth step %d: set_variables[%q]: parse error: %w",
							i+1, varName, parseErr)
					}
					result, err = r.evalExpr(node, cache)
					if err != nil {
						return nil, nil, fmt.Errorf("auth step %d: set_variables[%q]: eval error: %w",
							i+1, varName, err)
					}
				} else {
					r.configMu.RLock()
					result = r.subVarsLocked(expr)
					r.configMu.RUnlock()
				}

				r.configMu.Lock()
				cfg.Variables[varName] = result
				r.configMu.Unlock()

				fmt.Printf("    [Auth] set_variables: {{%s}} = %q\n", varName, result)
			}

			r.updateReplacer()
		}

		fullURL := r.subVars(step.URL)
		if !strings.HasPrefix(fullURL, "http://") && !strings.HasPrefix(fullURL, "https://") {
			fullURL = strings.TrimRight(cfg.BaseURL, "/") + "/" + strings.TrimLeft(fullURL, "/")
		}

		var bodyReader io.Reader
		if step.Body != nil {
			r.configMu.RLock()
			subBody := r.substituteInObject(step.Body)
			r.configMu.RUnlock()
			b, err := json.Marshal(subBody)
			if err != nil {
				return nil, nil, fmt.Errorf("auth step %d: failed to marshal body: %w", i+1, err)
			}
			bodyReader = bytes.NewReader(b)
		}

		req, err := http.NewRequestWithContext(reqCtx, step.Method, fullURL, bodyReader)
		if err != nil {
			return nil, nil, fmt.Errorf("auth step %d: failed to create request: %w", i+1, err)
		}

		if step.Body != nil {
			req.Header.Set("Content-Type", "application/json")
		}

		r.configMu.RLock()
		for k, v := range step.Headers {
			req.Header.Set(k, r.subVarsLocked(v))
		}
		// Apply accumulated headers and cookies for this sequence
		if len(headers) > 0 {
			for k, v := range headers {
				req.Header.Set(k, v)
			}
		}
		if len(cookies) > 0 {
			for k, v := range cookies {
				req.AddCookie(&http.Cookie{Name: k, Value: v})
			}
		}
		r.configMu.RUnlock()

		if cfg.Settings.Debug {
			dump, _ := httputil.DumpRequestOut(req, true)
			fmt.Printf("\n--- [DEBUG] Auth Request ---\n%s\n----------------------------\n", string(dump))
		}

		resp, err := r.client.Do(req)
		if err != nil {
			return nil, nil, fmt.Errorf("auth step %d: request failed: %w", i+1, err)
		}

		if cfg.Settings.Debug {
			dump, _ := httputil.DumpResponse(resp, false)
			fmt.Printf("\n--- [DEBUG] Auth Response ---\n%s\n-----------------------------\n", string(dump))
		}

		fmt.Printf("  Step %d: %s %s -> %d\n", i+1, step.Method, fullURL, resp.StatusCode)

		body, err := io.ReadAll(io.LimitReader(resp.Body, 1*1024*1024))
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()

		if err != nil {
			return nil, nil, fmt.Errorf("auth step %d: failed to read response: %w", i+1, err)
		}

		if resp.StatusCode >= 400 {
			errBody := string(body)
			if len(errBody) > 1024 {
				errBody = errBody[:1024]
			}
			return nil, nil, fmt.Errorf("auth step %d failed with status %d: %s", i+1, resp.StatusCode, errBody)
		}

		// Collect cookies
		for _, cookie := range resp.Cookies() {
			shouldSave := true
			if len(step.ExtractCookies) > 0 {
				shouldSave = false
				for _, name := range step.ExtractCookies {
					if name == cookie.Name {
						shouldSave = true
						break
					}
				}
			}

			if shouldSave {
				cookies[cookie.Name] = cookie.Value
				fmt.Printf("    [Auth] Saved cookie: %s\n", cookie.Name)
			}
		}

		// Extract JSON fields & Variables
		if len(step.ExtractJSON) > 0 || len(step.ExtractVariables) > 0 {
			var parsed map[string]any
			if err := json.Unmarshal(body, &parsed); err != nil {
				if len(step.ExtractJSON) > 0 || len(step.ExtractVariables) > 0 {
					return nil, nil, fmt.Errorf("auth step %d: failed to parse JSON response for value extraction: %w", i+1, err)
				}
				fmt.Printf("    \033[33m[Auth] Warning: Failed to parse response JSON: %v\033[0m\n", err)
			} else {
				r.configMu.Lock()
				if cfg.Variables == nil {
					cfg.Variables = make(map[string]any)
				}

				for jsonKey, headerName := range step.ExtractJSON {
					val := extractJSONPath(parsed, jsonKey)
					if val != nil {
						strVal := fmt.Sprintf("%v", val)
						headers[headerName] = strVal
						fmt.Printf("    [Auth] Extracted %s -> Header %s\n", jsonKey, headerName)
					}
				}

				varsUpdated := false
				for jsonKey, varName := range step.ExtractVariables {
					val := extractJSONPath(parsed, jsonKey)
					if val != nil {
						cfg.Variables[varName] = val
						fmt.Printf("    [Auth] Extracted %s -> Variable {{%s}}\n", jsonKey, varName)
						varsUpdated = true
					}
				}
				r.configMu.Unlock()

				if varsUpdated {
					r.updateReplacer()
				}
			}
		}
	}

	fmt.Println("Authentication sequence complete.")
	return headers, cookies, nil
}

func (r *Runner) RunAuthSequence(ctx context.Context) error {
	if len(r.config.AuthSequence) == 0 {
		return nil
	}
	headers, cookies, err := r.ExecuteAuthSequence(ctx, r.config.AuthSequence, r.config.GlobalHeaders, r.config.Cookies)
	if err != nil {
		return err
	}
	r.configMu.Lock()
	r.config.GlobalHeaders = headers
	r.config.Cookies = cookies
	r.configMu.Unlock()
	return nil
}

// extractJSONPath allows retrieving a nested value from a JSON map using dot notation (e.g., "data.token" or "data.users[0].id").
func extractJSONPath(data map[string]any, path string) any {
	parts := strings.Split(path, ".")
	var current any = data
	for i, part := range parts {
		var key = part
		var arrIdx = -1
		if start := strings.IndexByte(part, '['); start >= 0 {
			if end := strings.IndexByte(part, ']'); end > start {
				if idx, err := strconv.Atoi(part[start+1 : end]); err == nil {
					arrIdx = idx
					key = part[:start]
				}
			}
		}

		if m, ok := current.(map[string]any); ok {
			current = m[key]
		} else {
			return nil
		}

		if current != nil && arrIdx >= 0 {
			if arr, ok := current.([]any); ok && arrIdx < len(arr) {
				current = arr[arrIdx]
			} else {
				return nil
			}
		}

		if current == nil {
			return nil
		}
		if i == len(parts)-1 {
			return current
		}
	}
	return nil
}

// substituteInObject deeply substitutes string variables inside maps/slices.
// Must be called while holding configMu.RLock.
func (r *Runner) substituteInObject(v any) any {
	switch val := v.(type) {
	case string:
		return r.subVarsLocked(val)
	case map[string]any:
		res := make(map[string]any)
		for k, v := range val {
			res[k] = r.substituteInObject(v)
		}
		return res
	case []any:
		res := make([]any, len(val))
		for i, v := range val {
			res[i] = r.substituteInObject(v)
		}
		return res
	default:
		return v
	}
}

// exprNode — узел AST выражения из set_variables.
// Если Args == nil — это ссылка на переменную (varRef).
// Если Args != nil (включая пустой срез) — вызов функции (funcCall).
type exprNode struct {
	name string
	args []*exprNode
}

type exprParser struct {
	src string
	pos int
}

func parseExpression(src string) (*exprNode, error) {
	p := &exprParser{src: strings.TrimSpace(src)}
	node, err := p.parseExpr()
	if err != nil {
		return nil, err
	}
	p.skipWS()
	if p.pos != len(p.src) {
		return nil, fmt.Errorf("unexpected input at pos %d: %q", p.pos, p.src[p.pos:])
	}
	return node, nil
}

func (p *exprParser) peek() byte {
	if p.pos < len(p.src) {
		return p.src[p.pos]
	}
	return 0
}

func (p *exprParser) consume() byte {
	b := p.peek()
	p.pos++
	return b
}

func (p *exprParser) skipWS() {
	for p.pos < len(p.src) && (p.src[p.pos] == ' ' || p.src[p.pos] == '	') {
		p.pos++
	}
}

func (p *exprParser) readIdent() string {
	start := p.pos
	for p.pos < len(p.src) {
		c := p.src[p.pos]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
			(c >= '0' && c <= '9') || c == '_' {
			p.pos++
		} else {
			break
		}
	}
	return p.src[start:p.pos]
}

func (p *exprParser) parseExpr() (*exprNode, error) {
	p.skipWS()
	name := p.readIdent()
	if name == "" {
		return nil, fmt.Errorf("expected identifier at pos %d", p.pos)
	}
	p.skipWS()
	if p.peek() != '(' {
		return &exprNode{name: name}, nil // varRef
	}
	p.consume() // '('
	args, err := p.parseArgList()
	if err != nil {
		return nil, err
	}
	p.skipWS()
	if p.consume() != ')' {
		return nil, fmt.Errorf("expected ')' at pos %d", p.pos)
	}
	return &exprNode{name: name, args: args}, nil
}

func (p *exprParser) parseArgList() ([]*exprNode, error) {
	args := make([]*exprNode, 0)
	p.skipWS()
	if p.peek() == ')' {
		return args, nil // пустой список
	}
	for {
		arg, err := p.parseExpr()
		if err != nil {
			return nil, err
		}
		args = append(args, arg)
		p.skipWS()
		if p.peek() == ',' {
			p.consume()
		} else {
			break
		}
	}
	return args, nil
}

func looksLikeFuncCall(s string) bool {
	s = strings.TrimSpace(s)
	for i, c := range s {
		if c == '(' {
			return i > 0
		}
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
			(c >= '0' && c <= '9') || c == '_') {
			return false
		}
	}
	return false
}

// evalExpr вычисляет AST-узел и возвращает строковый результат.
// cache — результаты функций в рамках одного вызова evaluateSetVariables,
// гарантирует что uuid() с одинаковым cacheKey вернёт одно значение.
func (r *Runner) evalExpr(node *exprNode, cache map[string]string) (string, error) {
	if node.args == nil {
		// varRef: читаем из cfg.Variables
		r.configMu.RLock()
		val := r.config.Variables[node.name]
		r.configMu.RUnlock()
		if val == nil {
			return "", fmt.Errorf("undefined variable %q", node.name)
		}
		return fmt.Sprintf("%v", val), nil
	}

	// funcCall: проверяем кэш
	cacheKey := node.cacheKey()
	if v, ok := cache[cacheKey]; ok {
		return v, nil
	}

	// Вычисляем аргументы рекурсивно
	args := make([]string, len(node.args))
	for i, a := range node.args {
		v, err := r.evalExpr(a, cache)
		if err != nil {
			return "", fmt.Errorf("in arg %d of %s(): %w", i+1, node.name, err)
		}
		args[i] = v
	}

	result, err := r.callBuiltin(node.name, args)
	if err != nil {
		return "", err
	}
	cache[cacheKey] = result
	return result, nil
}

// cacheKey строит уникальный ключ для кэша на основе имени и аргументов.
func (n *exprNode) cacheKey() string {
	if len(n.args) == 0 {
		return n.name + "()"
	}
	parts := make([]string, len(n.args))
	for i, a := range n.args {
		parts[i] = a.cacheKey()
	}
	return n.name + "(" + strings.Join(parts, ",") + ")"
}

func (r *Runner) callBuiltin(name string, args []string) (string, error) {
	switch name {
	case "uuid":
		if len(args) != 0 {
			return "", fmt.Errorf("uuid() takes 0 arguments, got %d", len(args))
		}
		return uuid.New().String(), nil

	case "solvePoW":
		if len(args) != 2 {
			return "", fmt.Errorf("solvePoW() takes 2 arguments (challenge, difficulty), got %d", len(args))
		}
		challenge := args[0]
		difficulty, err := strconv.Atoi(args[1])
		if err != nil {
			return "", fmt.Errorf("solvePoW(): difficulty must be integer, got %q", args[1])
		}
		return solvePoW(challenge, difficulty)

	default:
		return "", fmt.Errorf("unknown function %q", name)
	}
}

// solvePoW ищет nonce такой, что hex(SHA256(challenge+nonce)) начинается с difficulty нулей.
// Перебор: nonce = "0", "1", "2", ...
// Лимит: 10 000 000 итераций (difficulty ≤ 6 — секунды, difficulty > 6 → error).
func solvePoW(challenge string, difficulty int) (string, error) {
	if difficulty < 0 {
		return "", fmt.Errorf("solvePoW: difficulty must be >= 0, got %d", difficulty)
	}
	if difficulty == 0 {
		return "0", nil
	}
	prefix := strings.Repeat("0", difficulty)
	h := sha256.New()
	for nonce := 0; nonce < 10_000_000; nonce++ {
		nonceStr := strconv.Itoa(nonce)
		h.Reset()
		h.Write([]byte(challenge + nonceStr))
		if strings.HasPrefix(hex.EncodeToString(h.Sum(nil)), prefix) {
			return nonceStr, nil
		}
	}
	return "", fmt.Errorf("solvePoW: nonce not found in 10M iterations (difficulty=%d)", difficulty)
}
