package api

import (
	"encoding/json"
	"net/http"
	"os"
	"sync"
	"time"

	"swazz-engine/internal/runner"
	"swazz-engine/internal/security"
	"swazz-engine/internal/swagger"
)

// Handler holds references to the runner and current config.
type Handler struct {
	mu         sync.Mutex
	runner     *runner.Runner
	config     *swagger.Config
	results    []*swagger.FuzzResult
	httpClient *http.Client
}

// NewHandler creates a new API handler.
func NewHandler() *Handler {
	allowPrivate := os.Getenv("SWAZZ_ALLOW_PRIVATE_IPS") == "true"
	return &Handler{
		httpClient: security.NewSSRFProtectedClient(30*time.Second, allowPrivate),
	}
}

func (h *Handler) getClient() *http.Client {
	if h.httpClient != nil {
		return h.httpClient
	}
	return http.DefaultClient
}

// ─── POST /api/parse ────────────────────────────────────

type parseRequest struct {
	URL  string          `json:"url,omitempty"`
	Spec json.RawMessage `json:"spec,omitempty"`
}

// ─── POST /api/fuzz/start ───────────────────────────────

// ─── POST /api/fuzz/stop ────────────────────────────────

// ─── POST /api/fuzz/pause ───────────────────────────────

// ─── POST /api/fuzz/resume ──────────────────────────────

// ─── GET /api/fuzz/stream (SSE) ─────────────────────────

// ─── GET /api/stats ─────────────────────────────────────

// ─── POST /api/proxy (replaces @swazz/worker) ──────────

type proxyRequest struct {
	URL     string            `json:"url"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers,omitempty"`
	Cookies map[string]string `json:"cookies,omitempty"`
	Body    json.RawMessage   `json:"body,omitempty"`
}

// ─── GET /api/report ────────────────────────────────────

// ─── GET /api/payload-catalog ────────────────────────────
// Returns all available payload categories per profile.
// The frontend uses this to render dynamic checkboxes without hardcoding.
// Response: { "RANDOM": [...], "BOUNDARY": [...], "MALICIOUS": [...] }

// ─── ANY /api/oob/:uuid ────────────────────────────────
