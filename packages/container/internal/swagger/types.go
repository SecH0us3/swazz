package swagger

// FuzzingProfile represents the type of payload generation strategy.
type FuzzingProfile string

const (
	ProfileRandom   FuzzingProfile = "RANDOM"
	ProfileBoundary FuzzingProfile = "BOUNDARY"
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

// Config holds the full fuzzing configuration.
type Config struct {
	BaseURL          string                 `json:"base_url"`
	GlobalHeaders    map[string]string      `json:"global_headers"`
	Cookies          map[string]string      `json:"cookies"`
	Dictionaries     map[string][]any       `json:"dictionaries"`
	Settings         Settings               `json:"settings"`
	Endpoints        []EndpointConfig       `json:"endpoints"`
	DisabledEndpoints []string              `json:"disabled_endpoints,omitempty"`
}

// Settings controls the fuzzing run behavior.
type Settings struct {
	IterationsPerProfile  int              `json:"iterations_per_profile"`
	Concurrency           int              `json:"concurrency"`
	TimeoutMs             int              `json:"timeout_ms"`
	MaxPayloadSizeBytes   int              `json:"max_payload_size_bytes"`
	DelayBetweenRequestMs int              `json:"delay_between_requests_ms"`
	Profiles              []FuzzingProfile `json:"profiles"`
}

// DefaultSettings returns sensible defaults matching the original TS implementation.
func DefaultSettings() Settings {
	return Settings{
		IterationsPerProfile:  20,
		Concurrency:           5,
		TimeoutMs:             10000,
		MaxPayloadSizeBytes:   1048576, // 1MB
		DelayBetweenRequestMs: 0,
		Profiles:              []FuzzingProfile{ProfileRandom, ProfileBoundary, ProfileMalicious},
	}
}

// FuzzResult represents the outcome of a single fuzz request.
type FuzzResult struct {
	ID           string         `json:"id"`
	Endpoint     string         `json:"endpoint"`
	ResolvedPath string         `json:"resolvedPath"`
	Method       string         `json:"method"`
	Profile      FuzzingProfile `json:"profile"`
	Status       int            `json:"status"`
	Duration     int64          `json:"duration"` // milliseconds
	Payload      any            `json:"payload"`
	ResponseBody any            `json:"responseBody,omitempty"`
	Error        string         `json:"error,omitempty"`
	Timestamp    int64          `json:"timestamp"`
	Retries      int            `json:"retries"`
}

// RunStats tracks live statistics during a fuzzing run.
type RunStats struct {
	TotalRequests    int64                       `json:"totalRequests"`
	TotalPlanned     int64                       `json:"totalPlanned"`
	RequestsPerSec   float64                     `json:"requestsPerSecond"`
	StatusCounts     map[int]int64               `json:"statusCounts"`
	ProfileCounts    map[FuzzingProfile]int64     `json:"profileCounts"`
	EndpointCounts   map[string]map[int]int64     `json:"endpointCounts"`
	StartTime        int64                       `json:"startTime"`
	IsRunning        bool                        `json:"isRunning"`
	Progress         Progress                    `json:"progress"`
}

// Progress tracks endpoint-level completion.
type Progress struct {
	CompletedEndpoints int    `json:"completedEndpoints"`
	TotalEndpoints     int    `json:"totalEndpoints"`
	CurrentEndpoint    string `json:"currentEndpoint"`
	CurrentProfile     string `json:"currentProfile"`
}

// ParseResult is the output of ParseSpec.
type ParseResult struct {
	BasePath  string           `json:"basePath"`
	Endpoints []EndpointConfig `json:"endpoints"`
}
