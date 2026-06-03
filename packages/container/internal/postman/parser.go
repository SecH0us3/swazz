package postman

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"swazz-engine/internal/swagger"
)

// Collection represents a Postman Collection JSON (v2.0.0 / v2.1.0).
type Collection struct {
	Info Info   `json:"info"`
	Item []Item `json:"item"`
}

// Info contains collection metadata.
type Info struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Schema      string `json:"schema"`
}

// Item can be a request or a folder/group of requests.
type Item struct {
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Request     *Request `json:"request,omitempty"`
	Item        []Item   `json:"item,omitempty"` // Child items for nested folders
}

// Request contains details of an API request.
type Request struct {
	Method      string      `json:"method"`
	Header      []Header    `json:"header,omitempty"`
	Body        *Body       `json:"body,omitempty"`
	URL         *URLWrapper `json:"url,omitempty"`
	Description string      `json:"description,omitempty"`
}

// Header represents an HTTP header.
type Header struct {
	Key         string `json:"key"`
	Value       string `json:"value"`
	Description string `json:"description,omitempty"`
	Disabled    bool   `json:"disabled,omitempty"`
}

// Body represents the request body.
type Body struct {
	Mode       string         `json:"mode,omitempty"`
	Raw        string         `json:"raw,omitempty"`
	URLEncoded []KeyValuePair `json:"urlencoded,omitempty"`
	FormData   []KeyValuePair `json:"formdata,omitempty"`
}

// KeyValuePair represents key-value fields (for query params, form data, urlencoded, etc).
type KeyValuePair struct {
	Key         string `json:"key"`
	Value       string `json:"value"`
	Type        string `json:"type,omitempty"`
	Description string `json:"description,omitempty"`
	Disabled    bool   `json:"disabled,omitempty"`
}

// URLWrapper wraps the URL. It can be a simple string or a structured object.
type URLWrapper struct {
	Raw      string
	Protocol string
	Host     []string
	Path     []string
	Query    []KeyValuePair
	Variable []KeyValuePair
}

// UnmarshalJSON implements custom JSON unmarshaling for URLWrapper since Postman urls can be a string or an object.
func (u *URLWrapper) UnmarshalJSON(data []byte) error {
	if len(data) == 0 {
		return nil
	}
	if data[0] == '"' {
		var s string
		if err := json.Unmarshal(data, &s); err != nil {
			return err
		}
		u.Raw = s
		return nil
	}

	type Alias URLWrapper
	var alias struct {
		Raw      string         `json:"raw"`
		Protocol string         `json:"protocol"`
		Host     any            `json:"host"`
		Path     any            `json:"path"`
		Query    []KeyValuePair `json:"query"`
		Variable []KeyValuePair `json:"variable"`
	}
	if err := json.Unmarshal(data, &alias); err != nil {
		return err
	}
	u.Raw = alias.Raw
	u.Protocol = alias.Protocol
	u.Query = alias.Query
	u.Variable = alias.Variable

	// Unmarshal Host (can be a string or an array of strings)
	if alias.Host != nil {
		switch h := alias.Host.(type) {
		case string:
			u.Host = []string{h}
		case []any:
			for _, item := range h {
				if s, ok := item.(string); ok {
					u.Host = append(u.Host, s)
				} else if item != nil {
					u.Host = append(u.Host, fmt.Sprintf("%v", item))
				}
			}
		}
	}

	// Unmarshal Path (can be a string or an array of strings)
	if alias.Path != nil {
		switch p := alias.Path.(type) {
		case string:
			u.Path = strings.Split(strings.TrimPrefix(p, "/"), "/")
		case []any:
			for _, item := range p {
				if s, ok := item.(string); ok {
					u.Path = append(u.Path, s)
				} else if item != nil {
					u.Path = append(u.Path, fmt.Sprintf("%v", item))
				}
			}
		}
	}

	return nil
}

// ParsePostman parses a Postman collection JSON into a ParseResult.
func ParsePostman(raw []byte) (*swagger.ParseResult, error) {
	var col Collection
	if err := json.Unmarshal(raw, &col); err != nil {
		return nil, fmt.Errorf("failed to unmarshal Postman Collection: %w", err)
	}

	if col.Info.Name == "" && len(col.Item) == 0 {
		return nil, fmt.Errorf("invalid Postman collection: missing info name and items")
	}

	var endpoints []swagger.EndpointConfig
	collectEndpoints(col.Item, &endpoints)

	basePath := determineBasePath(col.Item)

	return &swagger.ParseResult{
		BasePath:  basePath,
		Endpoints: endpoints,
	}, nil
}

func collectEndpoints(items []Item, endpoints *[]swagger.EndpointConfig) {
	for _, item := range items {
		if item.Request != nil {
			ep := parseRequestItem(item)
			*endpoints = append(*endpoints, ep)
		}
		if len(item.Item) > 0 {
			collectEndpoints(item.Item, endpoints)
		}
	}
}

func parseRequestItem(item Item) swagger.EndpointConfig {
	req := item.Request
	method := "GET"
	if req.Method != "" {
		method = strings.ToUpper(req.Method)
	}

	pathStr, pathParams := parseURL(req.URL)

	headerParams := make(map[string]*swagger.SchemaProperty)
	for _, h := range req.Header {
		if h.Key != "" && !h.Disabled {
			headerParams[h.Key] = &swagger.SchemaProperty{Type: "string"}
		}
	}

	// ContentType logic
	contentType := ""
	for _, h := range req.Header {
		if strings.EqualFold(h.Key, "Content-Type") && !h.Disabled {
			contentType = h.Value
			break
		}
	}

	var schema swagger.SchemaProperty
	hasBody := req.Body != nil && req.Body.Mode != ""

	if hasBody {
		switch req.Body.Mode {
		case "raw":
			if contentType == "" {
				// Try to infer content type from body content
				trimmedBody := strings.TrimSpace(req.Body.Raw)
				if strings.HasPrefix(trimmedBody, "{") || strings.HasPrefix(trimmedBody, "[") {
					contentType = "application/json"
				} else if strings.HasPrefix(trimmedBody, "<") {
					contentType = "application/xml"
				} else {
					contentType = "text/plain"
				}
			}

			// If JSON, try to infer the schema
			if strings.Contains(contentType, "json") && req.Body.Raw != "" {
				var bodyVal any
				if err := json.Unmarshal([]byte(req.Body.Raw), &bodyVal); err == nil {
					if inferred := inferSchema(bodyVal); inferred != nil {
						schema = *inferred
					}
				}
			}
			if schema.Type == "" {
				schema = swagger.SchemaProperty{Type: "string"}
			}

		case "urlencoded":
			if contentType == "" {
				contentType = "application/x-www-form-urlencoded"
			}
			sp := swagger.SchemaProperty{
				Type:       "object",
				Properties: make(map[string]*swagger.SchemaProperty),
			}
			for _, kv := range req.Body.URLEncoded {
				if kv.Key != "" && !kv.Disabled {
					sp.Properties[kv.Key] = &swagger.SchemaProperty{Type: "string"}
				}
			}
			schema = sp

		case "formdata":
			if contentType == "" {
				contentType = "multipart/form-data"
			}
			sp := swagger.SchemaProperty{
				Type:       "object",
				Properties: make(map[string]*swagger.SchemaProperty),
			}
			for _, kv := range req.Body.FormData {
				if kv.Key != "" && !kv.Disabled {
					sp.Properties[kv.Key] = &swagger.SchemaProperty{Type: "string"}
				}
			}
			schema = sp
		}
	}

	// If no body schema, create from query parameters
	if !hasBody && len(schema.Properties) == 0 && req.URL != nil && len(req.URL.Query) > 0 {
		sp := swagger.SchemaProperty{
			Type:       "object",
			Properties: make(map[string]*swagger.SchemaProperty),
		}
		for _, q := range req.URL.Query {
			if q.Key != "" && !q.Disabled {
				sp.Properties[q.Key] = &swagger.SchemaProperty{Type: "string"}
			}
		}
		schema = sp
	}

	// Ensure schema has a type
	if schema.Type == "" && schema.Properties == nil {
		schema.Type = "object"
		schema.Properties = make(map[string]*swagger.SchemaProperty)
	}

	ep := swagger.EndpointConfig{
		Path:   pathStr,
		Method: method,
		Schema: schema,
	}

	if len(pathParams) > 0 {
		ep.PathParams = pathParams
	}
	if len(headerParams) > 0 {
		ep.HeaderParams = headerParams
	}
	if contentType != "" {
		ep.ContentType = contentType
	}

	return ep
}

func parseURL(urlObj *URLWrapper) (string, map[string]*swagger.SchemaProperty) {
	if urlObj == nil {
		return "/", nil
	}
	pathSegments := urlObj.Path
	if len(pathSegments) == 0 && urlObj.Raw != "" {
		u, err := url.Parse(urlObj.Raw)
		if err == nil {
			pathStr := u.Path
			if pathStr != "" {
				pathSegments = strings.Split(strings.TrimPrefix(pathStr, "/"), "/")
			}
		}
	}

	pathParams := make(map[string]*swagger.SchemaProperty)
	var segments []string
	for _, seg := range pathSegments {
		if strings.HasPrefix(seg, ":") {
			paramName := seg[1:]
			segments = append(segments, "{"+paramName+"}")
			pathParams[paramName] = &swagger.SchemaProperty{Type: "string"}
		} else if strings.HasPrefix(seg, "{{") && strings.HasSuffix(seg, "}}") {
			paramName := seg[2 : len(seg)-2]
			lowerParam := strings.ToLower(paramName)
			if lowerParam == "baseurl" || lowerParam == "base_url" || lowerParam == "url" || lowerParam == "host" {
				continue
			}
			segments = append(segments, "{"+paramName+"}")
			pathParams[paramName] = &swagger.SchemaProperty{Type: "string"}
		} else {
			segments = append(segments, seg)
		}
	}

	for _, v := range urlObj.Variable {
		if v.Key != "" {
			pathParams[v.Key] = &swagger.SchemaProperty{Type: "string"}
		}
	}

	pathStr := "/" + strings.Join(segments, "/")
	pathStr = strings.ReplaceAll(pathStr, "//", "/")
	if !strings.HasPrefix(pathStr, "/") {
		pathStr = "/" + pathStr
	}

	return pathStr, pathParams
}

func determineBasePath(items []Item) string {
	var firstReq *Request
	var findFirst func(items []Item)
	findFirst = func(items []Item) {
		for _, item := range items {
			if item.Request != nil {
				firstReq = item.Request
				return
			}
			if len(item.Item) > 0 {
				findFirst(item.Item)
				if firstReq != nil {
					return
				}
			}
		}
	}
	findFirst(items)

	if firstReq != nil && firstReq.URL != nil {
		u := firstReq.URL
		if u.Raw != "" {
			parsedURL, err := url.Parse(u.Raw)
			if err == nil && parsedURL.Host != "" {
				return parsedURL.Scheme + "://" + parsedURL.Host
			}
		}
		if len(u.Host) > 0 && u.Protocol != "" {
			return u.Protocol + "://" + strings.Join(u.Host, ".")
		}
	}
	return ""
}

func inferSchema(val any) *swagger.SchemaProperty {
	if val == nil {
		return nil
	}

	switch v := val.(type) {
	case string:
		return &swagger.SchemaProperty{Type: "string"}
	case float64:
		if v == float64(int64(v)) {
			return &swagger.SchemaProperty{Type: "integer"}
		}
		return &swagger.SchemaProperty{Type: "number"}
	case bool:
		return &swagger.SchemaProperty{Type: "boolean"}
	case []any:
		sp := &swagger.SchemaProperty{Type: "array"}
		if len(v) > 0 {
			if resolved := inferSchema(v[0]); resolved != nil {
				sp.Items = resolved
			} else {
				sp.Items = &swagger.SchemaProperty{Type: "string"}
			}
		} else {
			sp.Items = &swagger.SchemaProperty{Type: "string"}
		}
		return sp
	case map[string]any:
		sp := &swagger.SchemaProperty{
			Type:       "object",
			Properties: make(map[string]*swagger.SchemaProperty),
		}
		for k, valItem := range v {
			resolved := inferSchema(valItem)
			if resolved != nil {
				sp.Properties[k] = resolved
			}
		}
		return sp
	}
	return &swagger.SchemaProperty{Type: "string"}
}
