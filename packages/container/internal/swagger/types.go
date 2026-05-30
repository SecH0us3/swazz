package swagger

import "net/http"

// FuzzingProfile represents the type of payload generation strategy.
type FuzzingProfile string

const (
	ProfileRandom    FuzzingProfile = "RANDOM"
	ProfileBoundary  FuzzingProfile = "BOUNDARY"
	ProfileMalicious FuzzingProfile = "MALICIOUS"
)

// SchemaProperty mirrors a JSON Schema property definition.
type SchemaProperty struct {
	Type       string                     `json:"type,omitempty"`
	Format     string                     `json:"format,omitempty"`
	Enum       []any                      `json:"enum,omitempty"`
	Properties map[string]*SchemaProperty `json:"properties,omitempty"`
	Items      *SchemaProperty            `json:"items,omitempty"`
	Required   []string                   `json:"required,omitempty"`
}

// EndpointConfig describes a single API endpoint extracted from the spec.
type EndpointConfig struct {
	Path         string                     `json:"path"`
	Method       string                     `json:"method"`
	Schema       SchemaProperty             `json:"schema"`
	PathParams   map[string]*SchemaProperty `json:"pathParams,omitempty"`
	HeaderParams map[string]*SchemaProperty `json:"headerParams,omitempty"`
	ContentType  string                     `json:"contentType,omitempty"`
}

// SecurityConfig holds configuration for engine security policies.
type SecurityConfig struct {
	AllowPrivateIPs bool `json:"allow_private_ips"`
}

// Config holds the full fuzzing configuration.
type Config struct {
	BaseURL       string            `json:"base_url"`
	GlobalHeaders map[string]string `json:"global_headers"`
	Cookies       map[string]string `json:"cookies"`
	Dictionaries  map[string][]any  `json:"dictionaries"`
	WordlistFiles map[string]string `json:"wordlist_files,omitempty"`
	Settings      Settings          `json:"settings"`
	Endpoints     []EndpointConfig  `json:"endpoints"`
	Rules         *RulesConfig      `json:"rules,omitempty"`
	AuthSequence  []AuthStep        `json:"auth_sequence,omitempty"`
	Variables     map[string]any    `json:"variables,omitempty"`
	Security      SecurityConfig    `json:"security,omitempty"`
}

// RulesConfig configures how results are classified.
type RulesConfig struct {
	Ignore   []int             `json:"ignore,omitempty"`
	Severity map[string]string `json:"severity,omitempty"` // map status code or range (e.g. "5xx") to severity
	Defaults map[string]string `json:"defaults,omitempty"`
}

// AuthStep describes a request to be made before fuzzing to establish a session.
type AuthStep struct {
	Method           string            `json:"method"`
	URL              string            `json:"url"` // If relative, prefixed with BaseURL
	Headers          map[string]string `json:"headers"`
	Body             any               `json:"body"`
	ExtractCookies   []string          `json:"extract_cookies,omitempty"`   // If empty, all cookies are saved
	ExtractJSON      map[string]string `json:"extract_json,omitempty"`      // Map JSON field name (or simple path) to Global Header name
	ExtractVariables map[string]string `json:"extract_variables,omitempty"` // Map JSON field name to template variable name
}

// Settings controls the fuzzing run behavior.
type Settings struct {
	IterationsPerProfile          int              `json:"iterations_per_profile"`
	Concurrency                   int              `json:"concurrency"`
	TimeoutMs                     int              `json:"timeout_ms"`
	MaxPayloadSizeBytes           int              `json:"max_payload_size_bytes"`
	DelayBetweenRequestMs         int              `json:"delay_between_requests_ms"`
	Debug                         bool             `json:"debug,omitempty"`
	Profiles                      []FuzzingProfile `json:"profiles"`
	PayloadCategories             map[FuzzingProfile][]string `json:"payload_categories,omitempty"`
	AnalyzeResponseBody           bool                      `json:"analyze_response_body"`
	ResponseSizeAnomalyMultiplier float64                   `json:"response_size_anomaly_multiplier"`
}

// DefaultSettings returns sensible defaults matching the original TS implementation.
func DefaultSettings() Settings {
	return Settings{
		IterationsPerProfile:          20,
		Concurrency:                   5,
		TimeoutMs:                     10000,
		MaxPayloadSizeBytes:           134217728, // 128MB (to allow large boundary strings)
		DelayBetweenRequestMs:         0,
		Profiles:                      []FuzzingProfile{ProfileRandom, ProfileBoundary, ProfileMalicious},
		AnalyzeResponseBody:           true,
		ResponseSizeAnomalyMultiplier: 5.0,
	}
}

type AnalysisFinding struct {
	RuleID   string `json:"ruleId"`
	Level    string `json:"level"` // "error", "warning", "note"
	Message  string `json:"message"`
	Evidence string `json:"evidence,omitempty"`
}

// FuzzResult represents the outcome of a single fuzz request.
// Used internally and in the report output — may contain large payload data.
type FuzzResult struct {
	ID               string            `json:"id"`
	Endpoint         string            `json:"endpoint"`
	ResolvedPath     string            `json:"resolvedPath"`
	Method           string            `json:"method"`
	Profile          FuzzingProfile    `json:"profile"`
	Status           int               `json:"status"`
	Duration         int64             `json:"duration"` // milliseconds
	Payload          any               `json:"payload"`
	PayloadSize      int               `json:"payloadSize"`
	ResponseBody     any               `json:"responseBody,omitempty"`
	Error            string            `json:"error,omitempty"`
	Timestamp        int64             `json:"timestamp"`
	Retries          int               `json:"retries"`
	ResponseSize     int64             `json:"responseSize"`
	ResponseHeaders  http.Header       `json:"responseHeaders,omitempty"`
	RequestHeaders   map[string]string `json:"requestHeaders,omitempty"`
	AnalyzerFindings []AnalysisFinding `json:"analyzerFindings,omitempty"`
}

// FuzzResultSSE is the lightweight version sent over SSE to the browser.
// Payload and ResponseBody are replaced with short preview strings (≤200 chars).
// This prevents the browser from ever receiving megabyte-sized JSON strings.
type FuzzResultSSE struct {
	ID              string            `json:"id"`
	Endpoint        string            `json:"endpoint"`
	ResolvedPath    string            `json:"resolvedPath"`
	Method          string            `json:"method"`
	Profile         FuzzingProfile    `json:"profile"`
	Status          int               `json:"status"`
	Duration        int64             `json:"duration"`
	PayloadSize     int               `json:"payloadSize"`
	PayloadPreview  string            `json:"payloadPreview,omitempty"`
	ResponsePreview string            `json:"responsePreview,omitempty"`
	Error           string            `json:"error,omitempty"`
	Timestamp       int64             `json:"timestamp"`
	Retries         int               `json:"retries"`
	ResponseSize     int64             `json:"responseSize"`
	HasHeaderInjection bool            `json:"hasHeaderInjection"`
	ResponseHeaders  http.Header       `json:"responseHeaders,omitempty"`
	RequestHeaders   map[string]string `json:"requestHeaders,omitempty"`
	AnalyzerFindings []AnalysisFinding `json:"analyzerFindings,omitempty"`
}

// RunStats tracks live statistics during a fuzzing run.
type RunStats struct {
	TotalRequests      int64                            `json:"totalRequests"`
	TotalPlanned       int64                            `json:"totalPlanned"`
	RequestsPerSec     float64                          `json:"requestsPerSecond"`
	StatusCounts       map[int]int64                    `json:"statusCounts"`
	StatusByProfile    map[FuzzingProfile]map[int]int64 `json:"statusByProfile"`
	ProfileCounts      map[FuzzingProfile]int64         `json:"profileCounts"`
	EndpointCounts     map[string]map[int]int64         `json:"endpointCounts"`
	StartTime          int64                            `json:"startTime"`
	IsRunning          bool                             `json:"isRunning"`
	Progress           Progress                         `json:"progress"`
	TotalResponseBytes int64                            `json:"totalResponseBytes"`
	MaxResponseSize    int64                            `json:"maxResponseSize"`
}

// Progress tracks endpoint-level completion.
type Progress struct {
	CompletedEndpoints int    `json:"completedEndpoints"`
	TotalEndpoints     int    `json:"totalEndpoints"`
	CurrentEndpoint    string `json:"currentEndpoint"`
	CurrentProfile     string `json:"currentProfile"`
	CurrentIteration   int    `json:"currentIteration"`
	TotalIterations    int    `json:"totalIterations"`
}

// ParseResult is the output of ParseSpec.
type ParseResult struct {
	BasePath  string           `json:"basePath"`
	Endpoints []EndpointConfig `json:"endpoints"`
}

// PayloadCategoryDef describes a single payload subcategory for the UI.
type PayloadCategoryDef struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Count       int    `json:"count"`
}

// PayloadCatalog maps each profile to its list of available categories.
type PayloadCatalog map[FuzzingProfile][]PayloadCategoryDef
