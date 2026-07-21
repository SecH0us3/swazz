package crawler

// CrawlerConfig defines configuration for the headless browser crawler.
type CrawlerConfig struct {
	Enabled         bool              `json:"enabled"`
	Headless        bool              `json:"headless"`
	MaxDepth        int               `json:"max_depth"`
	MaxClicksPerUrl int               `json:"max_clicks_per_url"`
	MaxPages        int               `json:"max_pages"`
	TimeoutPerPage  int               `json:"timeout_per_page"` // in seconds
	MemoryLimitMB   int               `json:"memory_limit_mb"`
	IgnorePatterns  []string          `json:"ignore_patterns,omitempty"`
	Cookies         map[string]string `json:"cookies,omitempty"`
	Headers         map[string]string `json:"headers,omitempty"`
	UserAgent       string            `json:"user_agent,omitempty"`
}

// DefaultCrawlerConfig returns a CrawlerConfig populated with default parameters.
func DefaultCrawlerConfig() CrawlerConfig {
	return CrawlerConfig{
		Enabled:         true,
		Headless:        true,
		MaxDepth:        3,
		MaxClicksPerUrl: 3,
		MaxPages:        50,
		TimeoutPerPage:  30,
		MemoryLimitMB:   512,
		IgnorePatterns:  []string{},
		Cookies:         make(map[string]string),
		Headers:         make(map[string]string),
	}
}

// DiscoveredEndpoint represents an API endpoint intercepted during crawling.
type DiscoveredEndpoint struct {
	URL         string            `json:"url"`
	Method      string            `json:"method"`
	Headers     map[string]string `json:"headers,omitempty"`
	QueryParams map[string]string `json:"query_params,omitempty"`
	BodySample  string            `json:"body_sample,omitempty"`
	ContentType string            `json:"content_type,omitempty"`
}

// CrawlerResult contains summary statistics and all discovered endpoints.
type CrawlerResult struct {
	Endpoints    []DiscoveredEndpoint `json:"endpoints"`
	PagesVisited int                  `json:"pages_visited"`
	DurationMs   int64                `json:"duration_ms"`
}
