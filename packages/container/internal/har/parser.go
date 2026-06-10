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

	endpointsMap := map[string]swagger.EndpointConfig{}
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

		ep, exists := endpointsMap[key]
		if !exists {
			ep = swagger.EndpointConfig{
				Path:         path,
				Method:       method,
				Schema: swagger.SchemaProperty{
					Type:       "object",
					Properties: map[string]*swagger.SchemaProperty{},
				},
				QueryParams:  map[string]*swagger.SchemaProperty{},
				HeaderParams: map[string]*swagger.SchemaProperty{},
			}
		}

		// 1. Merge Query parameters
		qs := req.Get("queryString").Array()
		if len(qs) > 0 {
			if ep.QueryParams == nil {
				ep.QueryParams = map[string]*swagger.SchemaProperty{}
			}
			for _, q := range qs {
				name := q.Get("name").String()
				if _, found := ep.QueryParams[name]; !found {
					val := q.Get("value").String()
					inferred := inferQueryValue(val)
					ep.QueryParams[name] = &inferred
				}
			}
		}

		// 2. Merge Post data (Request Body)
		postData := req.Get("postData")
		if postData.Exists() {
			mime := postData.Get("mimeType").String()
			text := postData.Get("text").String()
			if strings.Contains(mime, "application/json") && text != "" {
				ep.ContentType = mime
				newBodySchema := InferSchemaFromJSON(text)

				// Merge body schemas
				if ep.Schema.Type == "" || (ep.Schema.Type == "object" && len(ep.Schema.Properties) == 0) {
					ep.Schema = newBodySchema
				} else if ep.Schema.Type == "object" && newBodySchema.Type == "object" {
					if ep.Schema.Properties == nil {
						ep.Schema.Properties = map[string]*swagger.SchemaProperty{}
					}
					for k, v := range newBodySchema.Properties {
						if _, found := ep.Schema.Properties[k]; !found {
							ep.Schema.Properties[k] = v
						}
					}
				}

				// Merge examples
				var newExample any
				if err := json.Unmarshal([]byte(text), &newExample); err == nil {
					if ep.Example == nil {
						ep.Example = newExample
					} else if existingMap, ok1 := ep.Example.(map[string]any); ok1 {
						if newMap, ok2 := newExample.(map[string]any); ok2 {
							for k, v := range newMap {
								if _, found := existingMap[k]; !found {
									existingMap[k] = v
								}
							}
						}
					}
				}
			}
		}

		endpointsMap[key] = ep

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
