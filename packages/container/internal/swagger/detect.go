package swagger

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// IsValidSpec checks if the given raw JSON is a valid OpenAPI/Swagger specification
// or a GraphQL Introspection result.
func IsValidSpec(raw json.RawMessage) bool {
	var check map[string]any
	if err := json.Unmarshal(raw, &check); err != nil {
		return false
	}

	if _, hasOpenAPI := check["openapi"]; hasOpenAPI {
		return true
	}
	if _, hasSwagger := check["swagger"]; hasSwagger {
		return true
	}
	if _, hasData := check["data"]; hasData {
		if dataMap, ok := check["data"].(map[string]any); ok {
			if _, hasSchema := dataMap["__schema"]; hasSchema {
				return true
			}
		}
	}
	if _, hasSchema := check["__schema"]; hasSchema {
		return true
	}

	return false
}

// IsWSDL checks if the given raw bytes represent a WSDL specification.
func IsWSDL(raw []byte) bool {
	content := strings.TrimSpace(string(raw))
	if !strings.HasPrefix(content, "<?xml") && !strings.HasPrefix(content, "<") {
		return false
	}
	return strings.Contains(content, "<definitions") || strings.Contains(content, "<wsdl:definitions")
}

// IsPostman checks if the given raw JSON represents a Postman Collection.
func IsPostman(raw []byte) bool {
	var check map[string]any
	if err := json.Unmarshal(raw, &check); err != nil {
		return false
	}

	info, hasInfo := check["info"].(map[string]any)
	if !hasInfo {
		return false
	}

	schema, _ := info["schema"].(string)
	_, hasItem := check["item"].([]any)
	return hasItem && (strings.Contains(schema, "schema.getpostman.com") || schema != "")
}

// FetchRemoteSpec fetches a specification from a URL, trying GET first, and then trying POST with the provided GraphQL introspection query if GET does not return a valid spec.
func FetchRemoteSpec(ctx context.Context, client *http.Client, urlStr string, headers map[string]string, gqlIntrospectionQuery string) (json.RawMessage, error) {
	// 1. Try GET request first
	// #nosec G107 -- URL is user-controlled by design in this fuzzer tool
	req, err := http.NewRequestWithContext(ctx, "GET", urlStr, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json, application/yaml, application/x-yaml, text/yaml, text/x-yaml, text/xml, application/xml")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	// codeql[go/request-forgery]
	resp, err := client.Do(req)
	var body []byte
	if err == nil {
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			body, err = io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024)) // 10MB limit
			if err == nil {
				if converted, convErr := ConvertYAMLToJSON(body); convErr == nil {
					body = converted
				}

				if IsValidSpec(body) || IsWSDL(body) || IsPostman(body) {
					return body, nil
				}
			}
		}
	}

	// 2. Try POST Introspection if GET failed or didn't return a valid spec
	gqlQuery := map[string]string{
		"query": gqlIntrospectionQuery,
	}
	gqlBody, err := json.Marshal(gqlQuery)
	if err != nil {
		return nil, err
	}

	// #nosec G107 -- URL is user-controlled by design in this fuzzer tool
	postReq, err := http.NewRequestWithContext(ctx, "POST", urlStr, bytes.NewBuffer(gqlBody))
	if err != nil {
		return nil, err
	}
	postReq.Header.Set("Content-Type", "application/json")
	postReq.Header.Set("Accept", "application/json")
	for k, v := range headers {
		postReq.Header.Set(k, v)
	}

	// codeql[go/request-forgery]
	postResp, err := client.Do(postReq)
	if err != nil {
		if body != nil {
			return body, nil
		}
		return nil, fmt.Errorf("failed to fetch via GET and POST: %w", err)
	}
	defer postResp.Body.Close()

	if postResp.StatusCode == http.StatusOK {
		postBody, err := io.ReadAll(io.LimitReader(postResp.Body, 10*1024*1024)) // 10MB limit
		if err == nil {
			if IsValidSpec(postBody) || IsPostman(postBody) {
				return postBody, nil
			}
		}
	}

	if body != nil {
		return body, nil
	}
	return nil, fmt.Errorf("spec server returned status %d on POST introspection request", postResp.StatusCode)
}
