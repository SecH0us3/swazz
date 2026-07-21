package crawler

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/chromedp/cdproto/network"
)

var (
	uuidRegex    = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	numericRegex = regexp.MustCompile(`^[0-9]+$`)
	mongoIDRegex = regexp.MustCompile(`(?i)^[0-9a-f]{24}$`)

	staticExtensions = []string{
		".js", ".css", ".png", ".jpg", ".jpeg", ".svg", ".ico",
		".woff2", ".woff", ".ttf", ".map", ".pdf", ".gif", ".webp",
		".eot", ".mp4", ".mp3",
	}

	analyticsDomains = []string{
		"sentry.io",
		"google-analytics.com",
		"googletagmanager.com",
		"hotjar.com",
		"intercom.io",
		"mixpanel.com",
		"segment.io",
		"segment.com",
		"amplitude.com",
		"logrocket.com",
		"clarity.ms",
		"facebook.net",
		"analytics.twitter.com",
		"posthog.com",
		"datadoghq.com",
		"nr-data.net",
		"newrelic.com",
	}
)

// Sniffer intercepts network events and records discovered API endpoints.
type Sniffer struct {
	mu              sync.Mutex
	endpoints       map[string]DiscoveredEndpoint
	pendingRequests map[network.RequestID]*DiscoveredEndpoint
	ignoredPatterns []string
}

// NewSniffer initializes a new Sniffer instance.
func NewSniffer(ignorePatterns ...string) *Sniffer {
	return &Sniffer{
		endpoints:       make(map[string]DiscoveredEndpoint),
		pendingRequests: make(map[network.RequestID]*DiscoveredEndpoint),
		ignoredPatterns: ignorePatterns,
	}
}

// ParameterizeRoute converts numeric IDs and UUIDs in URL paths to {id}.
func ParameterizeRoute(path string) string {
	if path == "" || path == "/" {
		return path
	}
	parts := strings.Split(path, "/")
	for i, part := range parts {
		if part == "" {
			continue
		}
		if numericRegex.MatchString(part) || uuidRegex.MatchString(part) || mongoIDRegex.MatchString(part) {
			parts[i] = "{id}"
		}
	}
	return strings.Join(parts, "/")
}

// IsStaticBlacklist checks if the URL path ends with a blacklisted file extension.
func IsStaticBlacklist(urlStr string) bool {
	u, err := url.Parse(urlStr)
	if err != nil {
		return false
	}
	path := strings.ToLower(u.Path)
	for _, ext := range staticExtensions {
		if strings.HasSuffix(path, ext) {
			return true
		}
	}
	return false
}

// IsAnalyticsDomain checks if the URL host matches known analytics/telemetry services.
func IsAnalyticsDomain(urlStr string) bool {
	u, err := url.Parse(urlStr)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Host)
	for _, domain := range analyticsDomains {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return false
}

// IsAllowedContentType checks if the Content-Type is appropriate for API interception.
func IsAllowedContentType(contentType string) bool {
	if contentType == "" {
		return true
	}
	ct := strings.ToLower(contentType)
	if strings.Contains(ct, "application/json") ||
		strings.Contains(ct, "application/xml") ||
		strings.Contains(ct, "text/xml") ||
		strings.Contains(ct, "application/graphql") ||
		strings.Contains(ct, "form-data") ||
		strings.Contains(ct, "multipart/form-data") ||
		strings.Contains(ct, "application/x-www-form-urlencoded") {
		return true
	}
	if strings.Contains(ct, "text/html") ||
		strings.Contains(ct, "text/css") ||
		strings.Contains(ct, "image/") ||
		strings.Contains(ct, "font/") ||
		strings.Contains(ct, "audio/") ||
		strings.Contains(ct, "video/") ||
		strings.Contains(ct, "application/javascript") ||
		strings.Contains(ct, "application/x-javascript") ||
		strings.Contains(ct, "text/javascript") {
		return false
	}
	return true
}

// IsNoise returns true if the request or response should be ignored.
func (s *Sniffer) IsNoise(urlStr string, contentType string, method string) bool {
	if IsStaticBlacklist(urlStr) {
		return true
	}
	if IsAnalyticsDomain(urlStr) {
		return true
	}
	if !IsAllowedContentType(contentType) {
		return true
	}
	for _, pattern := range s.ignoredPatterns {
		if pattern != "" && strings.Contains(urlStr, pattern) {
			return true
		}
	}
	return false
}

// OnRequestWillBeSent handles CDP network.EventRequestWillBeSent events.
func (s *Sniffer) OnRequestWillBeSent(evt *network.EventRequestWillBeSent) {
	if evt == nil || evt.Request == nil {
		return
	}
	req := evt.Request
	if s.IsNoise(req.URL, "", req.Method) {
		return
	}

	u, err := url.Parse(req.URL)
	if err != nil || u.Host == "" {
		return
	}

	headers := make(map[string]string)
	var contentType string
	for k, v := range req.Headers {
		strVal := fmt.Sprintf("%v", v)
		headers[k] = strVal
		if strings.EqualFold(k, "Content-Type") {
			contentType = strVal
		}
	}

	queryParams := make(map[string]string)
	for k, v := range u.Query() {
		if len(v) > 0 {
			queryParams[k] = v[0]
		}
	}

	var bodySample string
	if len(req.PostDataEntries) > 0 {
		var parts []string
		for _, entry := range req.PostDataEntries {
			if entry != nil && entry.Bytes != "" {
				parts = append(parts, entry.Bytes)
			}
		}
		bodySample = strings.Join(parts, "")
	}

	paramPath := ParameterizeRoute(u.Path)
	paramURL := u.Scheme + "://" + u.Host + paramPath

	ep := DiscoveredEndpoint{
		URL:         paramURL,
		Method:      strings.ToUpper(req.Method),
		Headers:     headers,
		QueryParams: queryParams,
		BodySample:  bodySample,
		ContentType: contentType,
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.pendingRequests[evt.RequestID] = &ep

	key := ep.Method + " " + ep.URL
	s.endpoints[key] = ep
}

// OnResponseReceived handles CDP network.EventResponseReceived events.
func (s *Sniffer) OnResponseReceived(evt *network.EventResponseReceived) {
	if evt == nil || evt.Response == nil {
		return
	}
	resp := evt.Response
	if s.IsNoise(resp.URL, resp.MimeType, "") {
		s.mu.Lock()
		if ep, ok := s.pendingRequests[evt.RequestID]; ok {
			key := ep.Method + " " + ep.URL
			delete(s.endpoints, key)
			delete(s.pendingRequests, evt.RequestID)
		}
		s.mu.Unlock()
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if ep, ok := s.pendingRequests[evt.RequestID]; ok {
		if resp.MimeType != "" {
			ep.ContentType = resp.MimeType
		}
		key := ep.Method + " " + ep.URL
		s.endpoints[key] = *ep
		delete(s.pendingRequests, evt.RequestID)
	}
}

// AddEndpoint manually adds a discovered endpoint to the sniffer.
func (s *Sniffer) AddEndpoint(ep DiscoveredEndpoint) {
	u, err := url.Parse(ep.URL)
	if err == nil && u.Host != "" {
		paramPath := ParameterizeRoute(u.Path)
		ep.URL = u.Scheme + "://" + u.Host + paramPath
	}
	key := strings.ToUpper(ep.Method) + " " + ep.URL
	s.mu.Lock()
	defer s.mu.Unlock()
	s.endpoints[key] = ep
}

// GetEndpoints returns all discovered endpoints, sorted deterministically by URL and Method.
func (s *Sniffer) GetEndpoints() []DiscoveredEndpoint {
	s.mu.Lock()
	defer s.mu.Unlock()
	res := make([]DiscoveredEndpoint, 0, len(s.endpoints))
	for _, ep := range s.endpoints {
		res = append(res, ep)
	}
	sort.Slice(res, func(i, j int) bool {
		if res[i].URL == res[j].URL {
			return res[i].Method < res[j].Method
		}
		return res[i].URL < res[j].URL
	})
	return res
}

// OpenAPI 3.0 export structures
type openAPI struct {
	OpenAPI string                         `json:"openapi"`
	Info    openAPIInfo                    `json:"info"`
	Paths   map[string]map[string]openAPIOp `json:"paths"`
}

type openAPIInfo struct {
	Title   string `json:"title"`
	Version string `json:"version"`
}

type openAPIOp struct {
	Summary     string                 `json:"summary"`
	Parameters  []openAPIParam         `json:"parameters,omitempty"`
	RequestBody *openAPIReqBody        `json:"requestBody,omitempty"`
	Responses   map[string]openAPIResp `json:"responses"`
}

type openAPIParam struct {
	Name     string         `json:"name"`
	In       string         `json:"in"`
	Required bool           `json:"required"`
	Schema   map[string]any `json:"schema"`
}

type openAPIReqBody struct {
	Required bool                       `json:"required,omitempty"`
	Content  map[string]openAPIMediaType `json:"content"`
}

type openAPIMediaType struct {
	Schema map[string]any `json:"schema,omitempty"`
}

type openAPIResp struct {
	Description string `json:"description"`
}

// ToOpenAPI exports discovered endpoints into OpenAPI v3 JSON bytes.
func (s *Sniffer) ToOpenAPI() ([]byte, error) {
	endpoints := s.GetEndpoints()

	pathsMap := make(map[string]map[string]openAPIOp)

	for _, ep := range endpoints {
		u, err := url.Parse(ep.URL)
		var pathStr string
		if err != nil || u.Path == "" {
			pathStr = "/"
		} else {
			pathStr = u.Path
		}
		pathStr = ParameterizeRoute(pathStr)

		methodLower := strings.ToLower(ep.Method)
		if methodLower == "" {
			methodLower = "get"
		}

		if _, ok := pathsMap[pathStr]; !ok {
			pathsMap[pathStr] = make(map[string]openAPIOp)
		}

		var params []openAPIParam

		// Check for path parameters
		if strings.Contains(pathStr, "{id}") {
			params = append(params, openAPIParam{
				Name:     "id",
				In:       "path",
				Required: true,
				Schema:   map[string]any{"type": "string"},
			})
		}

		// Query parameters
		for k := range ep.QueryParams {
			params = append(params, openAPIParam{
				Name:     k,
				In:       "query",
				Required: false,
				Schema:   map[string]any{"type": "string"},
			})
		}

		var reqBody *openAPIReqBody
		if ep.BodySample != "" {
			ct := ep.ContentType
			if ct == "" {
				ct = "application/json"
			}
			var exampleVal any = ep.BodySample
			if strings.Contains(strings.ToLower(ct), "json") {
				var parsed any
				if err := json.Unmarshal([]byte(ep.BodySample), &parsed); err == nil {
					exampleVal = parsed
				}
			}
			reqBody = &openAPIReqBody{
				Content: map[string]openAPIMediaType{
					ct: {
						Schema: map[string]any{
							"type":    "object",
							"example": exampleVal,
						},
					},
				},
			}
		}

		op := openAPIOp{
			Summary:     fmt.Sprintf("%s %s", ep.Method, pathStr),
			Parameters:  params,
			RequestBody: reqBody,
			Responses: map[string]openAPIResp{
				"200": {Description: "Successful response"},
			},
		}

		pathsMap[pathStr][methodLower] = op
	}

	doc := openAPI{
		OpenAPI: "3.0.3",
		Info: openAPIInfo{
			Title:   "Headless Crawler Discovered API",
			Version: "1.0.0",
		},
		Paths: pathsMap,
	}

	return json.MarshalIndent(doc, "", "  ")
}

// HAR structures
type harLog struct {
	Log harLogData `json:"log"`
}

type harLogData struct {
	Version string     `json:"version"`
	Creator harCreator `json:"creator"`
	Entries []harEntry `json:"entries"`
}

type harCreator struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type harEntry struct {
	StartedDateTime string      `json:"startedDateTime"`
	Time            float64     `json:"time"`
	Request         harRequest  `json:"request"`
	Response        harResponse `json:"response"`
}

type harRequest struct {
	Method      string             `json:"method"`
	URL         string             `json:"url"`
	HTTPVersion string             `json:"httpVersion"`
	Headers     []harNameValuePair `json:"headers"`
	QueryString []harNameValuePair `json:"queryString"`
	PostData    *harPostData       `json:"postData,omitempty"`
}

type harResponse struct {
	Status      int                `json:"status"`
	StatusText  string             `json:"statusText"`
	HTTPVersion string             `json:"httpVersion"`
	Headers     []harNameValuePair `json:"headers"`
	Content     harContent         `json:"content"`
}

type harNameValuePair struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type harPostData struct {
	MimeType string `json:"mimeType"`
	Text     string `json:"text"`
}

type harContent struct {
	Size     int64  `json:"size"`
	MimeType string `json:"mimeType"`
}

// ToHAR exports discovered endpoints into HAR v1.2 JSON bytes.
func (s *Sniffer) ToHAR() ([]byte, error) {
	endpoints := s.GetEndpoints()
	entries := make([]harEntry, 0, len(endpoints))

	nowStr := time.Now().UTC().Format(time.RFC3339)

	for _, ep := range endpoints {
		reqHeaders := make([]harNameValuePair, 0, len(ep.Headers))
		for k, v := range ep.Headers {
			reqHeaders = append(reqHeaders, harNameValuePair{Name: k, Value: v})
		}

		qs := make([]harNameValuePair, 0, len(ep.QueryParams))
		for k, v := range ep.QueryParams {
			qs = append(qs, harNameValuePair{Name: k, Value: v})
		}

		var postData *harPostData
		if ep.BodySample != "" {
			mime := ep.ContentType
			if mime == "" {
				mime = "application/json"
			}
			postData = &harPostData{
				MimeType: mime,
				Text:     ep.BodySample,
			}
		}

		entry := harEntry{
			StartedDateTime: nowStr,
			Time:            50.0,
			Request: harRequest{
				Method:      ep.Method,
				URL:         ep.URL,
				HTTPVersion: "HTTP/1.1",
				Headers:     reqHeaders,
				QueryString: qs,
				PostData:    postData,
			},
			Response: harResponse{
				Status:      200,
				StatusText:  "OK",
				HTTPVersion: "HTTP/1.1",
				Headers:     []harNameValuePair{},
				Content: harContent{
					Size:     0,
					MimeType: ep.ContentType,
				},
			},
		}

		entries = append(entries, entry)
	}

	doc := harLog{
		Log: harLogData{
			Version: "1.2",
			Creator: harCreator{
				Name:    "Swazz Headless Crawler",
				Version: "1.0.0",
			},
			Entries: entries,
		},
	}

	return json.MarshalIndent(doc, "", "  ")
}
