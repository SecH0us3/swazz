package runner

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

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
	if p.pos < len(p.src) {
		p.pos++
	}
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

// nondeterministicBuiltins lists functions whose output changes between calls
// even with identical arguments (e.g. uuid()). These must NOT be cached.
var nondeterministicBuiltins = map[string]bool{
	"uuid": true,
}

// evalExpr вычисляет AST-узел и возвращает строковый результат.
// cache — результаты детерминированных функций в рамках одного шага,
// гарантирует что solvePoW(x, y) с одинаковыми аргументами не вычисляется дважды.
// Non-deterministic functions (uuid) are never cached.
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

	// funcCall: check cache for deterministic functions only
	cacheKey := node.cacheKey()
	canCache := !nondeterministicBuiltins[node.name]
	if canCache {
		if v, ok := cache[cacheKey]; ok {
			return v, nil
		}
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
	if canCache {
		cache[cacheKey] = result
	}
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

	// ── Generation ──────────────────────────────────────────────

	case "uuid":
		if len(args) != 0 {
			return "", fmt.Errorf("uuid() takes 0 arguments, got %d", len(args))
		}
		return uuid.New().String(), nil

	// ── Crypto ──────────────────────────────────────────────────

	case "sha256":
		if len(args) != 1 {
			return "", fmt.Errorf("sha256() takes 1 argument, got %d", len(args))
		}
		h := sha256.Sum256([]byte(args[0]))
		return hex.EncodeToString(h[:]), nil

	case "hmacSHA256":
		if len(args) != 2 {
			return "", fmt.Errorf("hmacSHA256() takes 2 arguments (message, key), got %d", len(args))
		}
		mac := hmac.New(sha256.New, []byte(args[1]))
		mac.Write([]byte(args[0]))
		return hex.EncodeToString(mac.Sum(nil)), nil

	// ── Encoding ────────────────────────────────────────────────

	case "base64":
		if len(args) != 1 {
			return "", fmt.Errorf("base64() takes 1 argument, got %d", len(args))
		}
		return base64.StdEncoding.EncodeToString([]byte(args[0])), nil

	case "hex":
		if len(args) != 1 {
			return "", fmt.Errorf("hex() takes 1 argument, got %d", len(args))
		}
		return hex.EncodeToString([]byte(args[0])), nil

	// ── String manipulation ─────────────────────────────────────

	case "concat":
		if len(args) == 0 {
			return "", nil
		}
		var b strings.Builder
		for _, a := range args {
			b.WriteString(a)
		}
		return b.String(), nil

	case "upper":
		if len(args) != 1 {
			return "", fmt.Errorf("upper() takes 1 argument, got %d", len(args))
		}
		return strings.ToUpper(args[0]), nil

	case "lower":
		if len(args) != 1 {
			return "", fmt.Errorf("lower() takes 1 argument, got %d", len(args))
		}
		return strings.ToLower(args[0]), nil

	case "trim":
		if len(args) != 1 {
			return "", fmt.Errorf("trim() takes 1 argument, got %d", len(args))
		}
		return strings.TrimSpace(args[0]), nil

	case "substring":
		if len(args) != 3 {
			return "", fmt.Errorf("substring() takes 3 arguments (value, start, end), got %d", len(args))
		}
		start, err := strconv.Atoi(args[1])
		if err != nil {
			return "", fmt.Errorf("substring(): start must be integer, got %q", args[1])
		}
		end, err := strconv.Atoi(args[2])
		if err != nil {
			return "", fmt.Errorf("substring(): end must be integer, got %q", args[2])
		}
		s := args[0]
		if start < 0 {
			start = 0
		}
		if end > len(s) {
			end = len(s)
		}
		if start >= end {
			return "", nil
		}
		return s[start:end], nil

	// ── JSON ────────────────────────────────────────────────────

	case "jsonPath":
		if len(args) != 2 {
			return "", fmt.Errorf("jsonPath() takes 2 arguments (jsonString, path), got %d", len(args))
		}
		var parsed map[string]any
		if err := json.Unmarshal([]byte(args[0]), &parsed); err != nil {
			return "", fmt.Errorf("jsonPath(): invalid JSON: %w", err)
		}
		val := extractJSONPath(parsed, args[1])
		if val == nil {
			return "", fmt.Errorf("jsonPath(): path %q not found", args[1])
		}
		return fmt.Sprintf("%v", val), nil

	// ── Legacy / PoW ────────────────────────────────────────────

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
// Zero-allocation hot loop: all buffers are pre-allocated, comparison is done on raw bytes.
// Лимит: 10 000 000 итераций.
func solvePoW(challenge string, difficulty int) (string, error) {
	if difficulty < 0 {
		return "", fmt.Errorf("solvePoW: difficulty must be >= 0, got %d", difficulty)
	}
	if difficulty == 0 {
		return "0", nil
	}
	if difficulty > 64 {
		return "", fmt.Errorf("solvePoW: difficulty %d exceeds maximum SHA256 hex length of 64", difficulty)
	}

	challengeBytes := []byte(challenge)
	h := sha256.New()
	var hashBuf [sha256.Size]byte
	var nonceBuf [20]byte // enough for strconv.AppendInt of any int64

	for nonce := range 10_000_000 {
		h.Reset()
		h.Write(challengeBytes)
		nonceBytes := strconv.AppendInt(nonceBuf[:0], int64(nonce), 10)
		h.Write(nonceBytes)
		hash := h.Sum(hashBuf[:0])

		// Check leading zero nibbles directly on raw hash bytes
		numZeroBytes := difficulty / 2
		matched := true
		for i := range numZeroBytes {
			if hash[i] != 0 {
				matched = false
				break
			}
		}
		if matched && difficulty%2 != 0 {
			if hash[numZeroBytes]>>4 != 0 {
				matched = false
			}
		}
		if matched {
			return string(nonceBytes), nil
		}
	}
	return "", fmt.Errorf("solvePoW: nonce not found in 10M iterations (difficulty=%d)", difficulty)
}

var csrfMetaRegex = regexp.MustCompile(`(?i)<meta\s+[^>]*?(?:name=["']_?(?:csrf|xsrf)(?:[-_]token)?["']\s+[^>]*?content=["']([^"']+)["']|content=["']([^"']+)["']\s+[^>]*?name=["']_?(?:csrf|xsrf)(?:[-_]token)?["'])`)
var csrfInputRegex = regexp.MustCompile(`(?i)<input\s+[^>]*?(?:name=["']_?(?:csrf|xsrf)(?:[-_]token)?["']\s+[^>]*?value=["']([^"']+)["']|value=["']([^"']+)["']\s+[^>]*?name=["']_?(?:csrf|xsrf)(?:[-_]token)?["'])`)
