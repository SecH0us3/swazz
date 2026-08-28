// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package swagger

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

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

// UnmarshalJSON accepts both spellings of JSON Schema's "type": a single string
// ("string") and a union array (["string","null"]).
//
// The union form is not exotic — it is how JSON Schema expresses a nullable field,
// and MCP tool schemas use it routinely. Without this, a single nullable property
// anywhere in a tool's inputSchema fails the whole tools/list decode and the scan
// never starts.
//
// A union collapses to its first non-"null" member, which is what the payload
// generator needs to pick a strategy. Nullability itself is not retained, so a
// re-serialised schema spells the type as a plain string.
func (s *SchemaProperty) UnmarshalJSON(data []byte) error {
	type alias SchemaProperty
	var aux struct {
		*alias
		Type json.RawMessage `json:"type,omitempty"`
	}
	aux.alias = (*alias)(s)

	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}

	s.Type = ""
	if len(aux.Type) > 0 {
		var single string
		if err := json.Unmarshal(aux.Type, &single); err == nil {
			s.Type = single
		} else {
			var union []string
			if err := json.Unmarshal(aux.Type, &union); err != nil {
				return fmt.Errorf("schema \"type\" must be a string or an array of strings, got %s", aux.Type)
			}
			for _, t := range union {
				if t != "null" {
					s.Type = t
					break
				}
			}
		}
	}

	// Polymorphic schema resolution: anyOf, oneOf, allOf
	if s.Type == "" && (s.Properties == nil || len(s.Properties) == 0) {
		var polymorphic struct {
			AnyOf []*SchemaProperty `json:"anyOf,omitempty"`
			OneOf []*SchemaProperty `json:"oneOf,omitempty"`
			AllOf []*SchemaProperty `json:"allOf,omitempty"`
		}
		if err := json.Unmarshal(data, &polymorphic); err == nil {
			candidates := polymorphic.AnyOf
			if len(candidates) == 0 {
				candidates = polymorphic.OneOf
			}
			if len(candidates) == 0 {
				candidates = polymorphic.AllOf
			}
			for _, cand := range candidates {
				if cand != nil && (cand.Type != "" || cand.Properties != nil || cand.Items != nil) {
					if s.Type == "" && cand.Type != "" {
						s.Type = cand.Type
					}
					if s.Format == "" && cand.Format != "" {
						s.Format = cand.Format
					}
					if len(s.Enum) == 0 && len(cand.Enum) > 0 {
						s.Enum = cand.Enum
					}
					if s.Properties == nil && cand.Properties != nil {
						s.Properties = cand.Properties
					}
					if s.Items == nil && cand.Items != nil {
						s.Items = cand.Items
					}
					break
				}
			}
		}
	}

	return nil
}

// EndpointConfig describes a single API endpoint extracted from the spec.
type EndpointConfig struct {
	Path             string                     `json:"path"`
	Method           string                     `json:"method"`
	Schema           SchemaProperty             `json:"schema"`
	PathParams       map[string]*SchemaProperty `json:"pathParams,omitempty"`
	QueryParams      map[string]*SchemaProperty `json:"queryParams,omitempty"`
	HeaderParams     map[string]*SchemaProperty `json:"headerParams,omitempty"`
	ContentType      string                     `json:"contentType,omitempty"`
	ExtractVariables map[string]string          `json:"extract_variables,omitempty"` // map JSON path to variable name
	ParamsMapping    map[string]string          `json:"params_mapping,omitempty"`    // map path param name to variable name
	Example          any                        `json:"example,omitempty"`
}

// SecurityConfig holds configuration for engine security policies.
type SecurityConfig struct {
	AllowPrivateIPs bool `json:"allow_private_ips"`
}

// MCPServerConfig defines configuration for target MCP servers.
type MCPServerConfig struct {
	Type    string   `json:"type"`              // "stdio", "sse", or "http"
	Command string   `json:"command,omitempty"` // Executable name (for stdio type)
	Args    []string `json:"args,omitempty"`    // Arguments passed to command (for stdio type)
	URL     string   `json:"url,omitempty"`     // SSE or HTTP endpoint URL
}

// Config holds the full fuzzing configuration.
type Config struct {
	RunID          string                  `json:"run_id,omitempty"`
	BaseURL        string                  `json:"base_url"`
	GlobalHeaders  map[string]string       `json:"global_headers"`
	Cookies        map[string]string       `json:"cookies"`
	Dictionaries   map[string][]any        `json:"dictionaries"`
	WordlistFiles  map[string]string       `json:"wordlist_files,omitempty"`
	Settings       Settings                `json:"settings"`
	Endpoints      []EndpointConfig        `json:"endpoints"`
	Rules          *RulesConfig            `json:"rules,omitempty"`
	AuthSequence   []AuthStep              `json:"auth_sequence,omitempty"`
	AuthIdentities map[string]AuthIdentity `json:"auth_identities,omitempty"`
	Variables      map[string]any          `json:"variables,omitempty"`
	Security       SecurityConfig          `json:"security,omitempty"`
	MCPServer      *MCPServerConfig        `json:"mcp_server,omitempty"`
}

// RulesConfig configures how results are classified.
type RulesConfig struct {
	Ignore      []int             `json:"ignore,omitempty"`
	Severity    map[string]string `json:"severity,omitempty"` // map status code or range (e.g. "5xx") to severity
	Defaults    map[string]string `json:"defaults,omitempty"`
	IgnoreRules []IgnoreRule      `json:"ignore_rules,omitempty"`
}

// IgnoreRule defines matching criteria to suppress false positive or noise findings.
type IgnoreRule struct {
	RuleID    string         `json:"rule_id,omitempty"`
	Endpoint  string         `json:"endpoint,omitempty"`
	Method    string         `json:"method,omitempty"`
	Payload   string         `json:"payload,omitempty"`
	PayloadRx *regexp.Regexp `json:"-"`
	Status    string         `json:"status,omitempty"` // Status code/range constraint (e.g., 400, "400", "4xx")
}

var statusPatternRx = regexp.MustCompile(`^(0|[1-9]\d{2}|[1-9]xx)$`)

func (r *IgnoreRule) UnmarshalJSON(data []byte) error {
	type Alias IgnoreRule
	aux := &struct {
		Status     any `json:"status,omitempty"`
		StatusCode any `json:"status_code,omitempty"`
		*Alias
	}{
		Alias: (*Alias)(r),
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}

	var val any
	if aux.Status != nil {
		val = aux.Status
	} else if aux.StatusCode != nil {
		val = aux.StatusCode
	}

	if val != nil {
		switch v := val.(type) {
		case float64:
			r.Status = strconv.Itoa(int(v))
		case string:
			r.Status = v
		default:
			return fmt.Errorf("invalid type for status/status_code: %T", v)
		}

		trimmed := strings.ToLower(strings.TrimSpace(r.Status))
		if trimmed != "" {
			if !statusPatternRx.MatchString(trimmed) {
				return fmt.Errorf("invalid status/status_code format %q: must be a 3-digit HTTP status code (e.g., 404, 0) or range (e.g., 4xx)", r.Status)
			}
		}
		r.Status = trimmed
	}
	return nil
}

// AuthStep describes a request to be made before fuzzing to establish a session.
type AuthStep struct {
	Type             string            `json:"type,omitempty"`
	TOTPSecret       string            `json:"totp_secret,omitempty"`
	TOTPVariable     string            `json:"totp_variable,omitempty"`
	Method           string            `json:"method,omitempty"`
	URL              string            `json:"url,omitempty"` // If relative, prefixed with BaseURL
	Headers          map[string]string `json:"headers,omitempty"`
	Body             any               `json:"body,omitempty"`
	ExtractCookies   []string          `json:"extract_cookies,omitempty"`   // If empty, all cookies are saved
	ExtractJSON      map[string]string `json:"extract_json,omitempty"`      // Map JSON field name (or simple path) to Global Header name
	ExtractVariables map[string]string `json:"extract_variables,omitempty"` // Map JSON field name to template variable name
	SetVariables     map[string]string `json:"set_variables,omitempty"`     // Map variable name to expression
	SetHeaders       map[string]string `json:"set_headers,omitempty"`       // Map header name to template string (e.g. "Authorization": "Bearer {{token}}")
}

// AuthIdentity represents an authentication context (like User B).
type AuthIdentity struct {
	AuthSequence []AuthStep        `json:"auth_sequence"`
	Headers      map[string]string `json:"headers,omitempty"`
	Cookies      map[string]string `json:"cookies,omitempty"`
}

// Settings controls the fuzzing run behavior.
type Settings struct {
	IterationsPerProfile          int                         `json:"iterations_per_profile"`
	Concurrency                   int                         `json:"concurrency"`
	TimeoutMs                     int                         `json:"timeout_ms"`
	MaxPayloadSizeBytes           int                         `json:"max_payload_size_bytes"`
	DelayBetweenRequestMs         int                         `json:"delay_between_requests_ms"`
	Debug                         bool                        `json:"debug,omitempty"`
	Profiles                      []FuzzingProfile            `json:"profiles"`
	PayloadCategories             map[FuzzingProfile][]string `json:"payload_categories,omitempty"`
	AnalyzeResponseBody           bool                        `json:"analyze_response_body"`
	ResponseSizeAnomalyMultiplier float64                     `json:"response_size_anomaly_multiplier"`
	TimeAnomalyThresholdMs        int                         `json:"time_anomaly_threshold_ms"`
	OOBServerURL                  string                      `json:"oob_server_url,omitempty"`
	RateLimitCheck                bool                        `json:"rate_limit_check"`
	RateLimitBurstSize            int                         `json:"rate_limit_burst_size"`
	BOLATesting                   bool                        `json:"bola_testing"`
	BOLASimilarityThreshold       float64                     `json:"bola_similarity_threshold"`
	AuthHeaders                   []string                    `json:"auth_headers,omitempty"`
	AuthCookies                   []string                    `json:"auth_cookies,omitempty"`
	AuthProbeURL                  string                      `json:"auth_probe_url,omitempty"`
	ChainingRules                 []ChainingRule              `json:"chaining_rules,omitempty"`
	HarDomainFilter               string                      `json:"har_domain_filter,omitempty"`
	MaxNodesBudget                int                         `json:"max_nodes_budget,omitempty"`
	MaxDepthLimit                 int                         `json:"max_depth_limit,omitempty"`
	MaxScanDurationMin            int                         `json:"max_scan_duration_min,omitempty"`
	ActiveParameterFuzzing        bool                        `json:"active_parameter_fuzzing"`
	Checkpoint                    *Checkpoint                 `json:"checkpoint,omitempty"`
	ProxyList                     []string                    `json:"proxy_list,omitempty"`
	RandomizeUserAgent            bool                        `json:"randomize_user_agent,omitempty"`
	EnableAdaptiveRateLimit       bool                        `json:"enable_adaptive_rate_limit,omitempty"`
	EnableSemanticMutation        *bool                       `json:"enable_semantic_mutation,omitempty"`
	EnableMCPMethodFuzzing        *bool                       `json:"enable_mcp_method_fuzzing,omitempty"`
	MCPFuzzTools                  *bool                       `json:"mcp_fuzz_tools,omitempty"`
	MCPFuzzResources              *bool                       `json:"mcp_fuzz_resources,omitempty"`
	MCPFuzzPrompts                *bool                       `json:"mcp_fuzz_prompts,omitempty"`
	UseLLMPrepass                 bool                        `json:"use_llm_prepass,omitempty"`
	AIGatewayURL                  string                      `json:"ai_gateway_url,omitempty"`
	CFAigToken                    string                      `json:"cf_aig_token,omitempty"`
	EnableSmartTriage             bool                        `json:"enable_smart_triage,omitempty"`
	MaxTriagePerScan              int                         `json:"max_triage_per_scan,omitempty"`
	EnableDifferentialAnalysis    *bool                       `json:"enable_differential_analysis,omitempty"`
	EnableSecurityHeadersAnalysis *bool                       `json:"enable_security_headers_analysis,omitempty"`
}

// SecurityHeadersAnalysisEnabled returns true if security headers and CSP analysis is enabled.
// Defaults to false when nil to suppress noisy static header checks (e.g. missing HSTS, CSP, X-Content-Type-Options).
func (s Settings) SecurityHeadersAnalysisEnabled() bool {
	if s.EnableSecurityHeadersAnalysis == nil {
		return false
	}
	return *s.EnableSecurityHeadersAnalysis
}

// DifferentialAnalysisEnabled returns true if differential analysis and stateful BOLA chains are enabled.
// Defaults to false when nil.
func (s Settings) DifferentialAnalysisEnabled() bool {
	if s.EnableDifferentialAnalysis == nil {
		return false
	}
	return *s.EnableDifferentialAnalysis
}

// SemanticMutationEnabled returns true if semantic format wrappers are enabled.
// Defaults to true when the field is not set (nil), matching the frontend default.
func (s Settings) SemanticMutationEnabled() bool {
	if s.EnableSemanticMutation == nil {
		return true
	}
	return *s.EnableSemanticMutation
}

// MCPMethodFuzzingEnabled returns true if method and tool name fuzzing is enabled for MCP servers.
// Defaults to true when nil to proactively test MCP dispatch security when an MCP server is configured.
func (s Settings) MCPMethodFuzzingEnabled() bool {
	if s.EnableMCPMethodFuzzing == nil {
		return true
	}
	return *s.EnableMCPMethodFuzzing
}

// MCPFuzzToolsEnabled returns true if MCP tools fuzzing is enabled (default: true).
func (s Settings) MCPFuzzToolsEnabled() bool {
	if s.MCPFuzzTools == nil {
		return true
	}
	return *s.MCPFuzzTools
}

// MCPFuzzResourcesEnabled returns true if MCP resources fuzzing is enabled (default: true).
func (s Settings) MCPFuzzResourcesEnabled() bool {
	if s.MCPFuzzResources == nil {
		return true
	}
	return *s.MCPFuzzResources
}

// MCPFuzzPromptsEnabled returns true if MCP prompts fuzzing is enabled (default: true).
func (s Settings) MCPFuzzPromptsEnabled() bool {
	if s.MCPFuzzPrompts == nil {
		return true
	}
	return *s.MCPFuzzPrompts
}

// GetMaxTriagePerScan returns the configured max triage limit,
// defaulting to 30 when the field is zero (missing from old configs).
func (s Settings) GetMaxTriagePerScan() int {
	if s.MaxTriagePerScan <= 0 {
		return 30
	}
	return s.MaxTriagePerScan
}

type Checkpoint struct {
	Profile   string `json:"profile"`
	Endpoint  string `json:"endpoint"`
	Iteration int    `json:"iteration"`
	Paused    bool   `json:"paused,omitempty"`
}

// DefaultSettings returns sensible defaults matching the original TS implementation.
func DefaultSettings() Settings {
	return Settings{
		IterationsPerProfile:          20,
		Concurrency:                   5,
		TimeoutMs:                     10000,
		MaxPayloadSizeBytes:           10485760, // 10MB
		DelayBetweenRequestMs:         0,
		Profiles:                      []FuzzingProfile{ProfileRandom, ProfileBoundary, ProfileMalicious},
		AnalyzeResponseBody:           true,
		ResponseSizeAnomalyMultiplier: 5.0,
		TimeAnomalyThresholdMs:        4000,
		RateLimitCheck:                false,
		RateLimitBurstSize:            50,
		BOLATesting:                   false,
		BOLASimilarityThreshold:       0.85,
		AuthHeaders:                   []string{"Authorization", "X-API-Key"},
		AuthCookies:                   []string{"session", "token", "jwt", "sid", "JSESSIONID", "PHPSESSID"},
		MaxNodesBudget:                50000,
		MaxDepthLimit:                 64,
		MaxScanDurationMin:            0,
		ActiveParameterFuzzing:        false,
		ProxyList:                     []string{},
		RandomizeUserAgent:            false,
		EnableAdaptiveRateLimit:       false,
	}
}

type AnalysisFinding struct {
	ID               string   `json:"id,omitempty"`
	RuleID           string   `json:"ruleId"`
	Level            string   `json:"level"` // "error", "warning", "note"
	Message          string   `json:"message"`
	Evidence         string   `json:"evidence,omitempty"`
	OWASPCategory    []string `json:"owaspCategory,omitempty"`
	OWASPAPICategory []string `json:"owaspApiCategory,omitempty"`
	CWEIDs           []string `json:"cweIds,omitempty"`
}

type RequestLog struct {
	Method       string            `json:"method"`
	URL          string            `json:"url"`
	Headers      map[string]string `json:"headers"`
	Body         string            `json:"body"`
	OriginalPath string            `json:"originalPath"`
	ResolvedPath string            `json:"resolvedPath"`
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
	Identity         string            `json:"identity,omitempty"`
	OWASPCategory    []string          `json:"owaspCategory,omitempty"`
	OWASPAPICategory []string          `json:"owaspApiCategory,omitempty"`
	CWEIDs           []string          `json:"cweIds,omitempty"`
}

// FuzzResultSSE is the lightweight version sent over SSE to the browser.
// Payload and ResponseBody are replaced with short preview strings (≤200 chars).
// This prevents the browser from ever receiving megabyte-sized JSON strings.
type FuzzResultSSE struct {
	ID                 string            `json:"id"`
	Endpoint           string            `json:"endpoint"`
	ResolvedPath       string            `json:"resolvedPath"`
	Method             string            `json:"method"`
	Profile            FuzzingProfile    `json:"profile"`
	Status             int               `json:"status"`
	Duration           int64             `json:"duration"`
	PayloadSize        int               `json:"payloadSize"`
	PayloadPreview     string            `json:"payloadPreview,omitempty"`
	ResponsePreview    string            `json:"responsePreview,omitempty"`
	Error              string            `json:"error,omitempty"`
	Timestamp          int64             `json:"timestamp"`
	Retries            int               `json:"retries"`
	ResponseSize       int64             `json:"responseSize"`
	HasHeaderInjection bool              `json:"hasHeaderInjection"`
	ResponseHeaders    http.Header       `json:"responseHeaders,omitempty"`
	RequestHeaders     map[string]string `json:"requestHeaders,omitempty"`
	AnalyzerFindings   []AnalysisFinding `json:"analyzerFindings,omitempty"`
	Identity           string            `json:"identity,omitempty"`
	OWASPCategory      []string          `json:"owaspCategory,omitempty"`
	OWASPAPICategory   []string          `json:"owaspApiCategory,omitempty"`
	CWEIDs             []string          `json:"cweIds,omitempty"`
}

// RunStats tracks live statistics during a fuzzing run.
type RunStats struct {
	TotalRequests      int64                            `json:"totalRequests"`
	TotalPlanned       int64                            `json:"totalPlanned"`
	RequestsPerSec     float64                          `json:"requestsPerSecond"`
	Concurrency        int                              `json:"concurrency"`
	StatusCounts       map[int]int64                    `json:"statusCounts"`
	StatusByProfile    map[FuzzingProfile]map[int]int64 `json:"statusByProfile"`
	ProfileCounts      map[FuzzingProfile]int64         `json:"profileCounts"`
	EndpointCounts     map[string]map[int]int64         `json:"endpointCounts"`
	StartTime          int64                            `json:"startTime"`
	IsRunning          bool                             `json:"isRunning"`
	Progress           Progress                         `json:"progress"`
	TotalSentBytes     int64                            `json:"totalSentBytes"`
	TotalResponseBytes int64                            `json:"totalResponseBytes"`
	MaxResponseSize    int64                            `json:"maxResponseSize"`
	TotalDurationMs    int64                            `json:"totalDurationMs"`
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

// ChainingRule defines how to extract a variable from an endpoint response to be used in subsequent requests.
type ChainingRule struct {
	SourceEndpoint string `json:"source_endpoint"`
	ExtractType    string `json:"extract_type"` // "json", "header", "regex"
	ExtractPath    string `json:"extract_path"`
	VariableName   string `json:"variable_name"`
}
