package har

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"swazz-engine/internal/swagger"
	"github.com/tidwall/gjson"
)

// ParseHAR parses a standard HAR JSON log.entries.
func ParseHAR(raw []byte, domainFilter string) (*swagger.ParseResult, error) {
	parsed := gjson.ParseBytes(raw)
	entries := parsed.Get("log.entries")
	if !entries.Exists() || !entries.IsArray() {
		return nil, fmt.Errorf("invalid HAR: missing log.entries")
	}

	var filterRegex *regexp.Regexp
	if domainFilter != "" {
		re, err := regexp.Compile(domainFilter)
		if err == nil {
			filterRegex = re
		}
	}

	endpointsMap := make(map[string]swagger.EndpointConfig)
	var basePath string

	entries.ForEach(func(_, entry gjson.Result) bool {
		req := entry.Get("request")
		if !req.Exists() {
			return true
		}

		method := strings.ToUpper(req.Get("method").String())
		fullURL := req.Get("url").String()
		
		u, err := url.Parse(fullURL)
		if err != nil || u.Host == "" {
			return true
		}

		if filterRegex != nil && !filterRegex.MatchString(u.Host) {
			return true
		}

		if basePath == "" {
			basePath = u.Scheme + "://" + u.Host
		}

		path := u.Path
		if path == "" {
			path = "/"
		}

		key := method + " " + path

		if _, exists := endpointsMap[key]; !exists {
			ep := swagger.EndpointConfig{
				Path:   path,
				Method: method,
				Schema: swagger.SchemaProperty{
					Type:       "object",
					Properties: make(map[string]*swagger.SchemaProperty),
				},
				HeaderParams: make(map[string]*swagger.SchemaProperty),
			}

			// Query string
			qs := req.Get("queryString").Array()
			if len(qs) > 0 {
				for _, q := range qs {
					name := q.Get("name").String()
					// Infer type from value
					val := q.Get("value").String()
					// For query string, we usually treat it as string or infer if it's numeric/boolean
					inferred := inferQueryValue(val)
					ep.Schema.Properties[name] = &inferred
				}
			}

			// Post data
			postData := req.Get("postData")
			if postData.Exists() {
				mime := postData.Get("mimeType").String()
				text := postData.Get("text").String()
				if strings.Contains(mime, "application/json") && text != "" {
					ep.ContentType = mime
					bodySchema := InferSchemaFromJSON(text)
					
					// Merge body schema into the main schema properties if it's an object
					if bodySchema.Type == "object" && bodySchema.Properties != nil {
						for k, v := range bodySchema.Properties {
							ep.Schema.Properties[k] = v
						}
					} else {
						// If the body is an array or something else, set it directly (this simplifies, but is sufficient for phase 1)
						ep.Schema = bodySchema
					}
					
					// Parse example
					var example any
					_ = json.Unmarshal([]byte(text), &example)
					ep.Example = example
				}
			}

			endpointsMap[key] = ep
		}

		return true
	})

	var endpoints []swagger.EndpointConfig
	for _, ep := range endpointsMap {
		endpoints = append(endpoints, ep)
	}

	return &swagger.ParseResult{
		BasePath:  basePath,
		Endpoints: endpoints,
	}, nil
}

func inferQueryValue(val string) swagger.SchemaProperty {
	if val == "true" || val == "false" {
		return swagger.SchemaProperty{Type: "boolean"}
	}
	// Test if it's integer
	isNum := true
	for i, c := range val {
		if c < '0' || c > '9' {
			if i == 0 && c == '-' {
				continue
			}
			isNum = false
			break
		}
	}
	if isNum && len(val) > 0 && val != "-" {
		return swagger.SchemaProperty{Type: "integer"}
	}
	return swagger.SchemaProperty{Type: "string"}
}
