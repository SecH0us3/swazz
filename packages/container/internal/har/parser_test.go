package har

import (
	"testing"
	"github.com/stretchr/testify/assert"
)

func TestParseHAR(t *testing.T) {
	rawHAR := []byte(`{
		"log": {
			"entries": [
				{
					"request": {
						"method": "POST",
						"url": "https://api.example.com/v1/users",
						"queryString": [
							{"name": "filter", "value": "active"}
						],
						"postData": {
							"mimeType": "application/json",
							"text": "{\"username\": \"admin\", \"age\": 30}"
						}
					}
				},
				{
					"request": {
						"method": "GET",
						"url": "https://api.example.com/v1/users?page=1",
						"queryString": [
							{"name": "page", "value": "1"}
						]
					}
				},
				{
					"request": {
						"method": "GET",
						"url": "https://static.example.com/style.css"
					}
				}
			]
		}
	}`)

	res, err := ParseHAR(rawHAR, "^api\\.example\\.com$")
	assert.NoError(t, err)
	assert.NotNil(t, res)

	assert.Equal(t, "https://api.example.com", res.BasePath)
	assert.Len(t, res.Endpoints, 2)

	// Sort endpoints by method for deterministic check or just find them
	var postEP, getEP bool
	for _, ep := range res.Endpoints {
		if ep.Method == "POST" {
			postEP = true
			assert.Equal(t, "/v1/users", ep.Path)
			assert.Equal(t, "application/json", ep.ContentType)
			// Body parameters are in ep.Schema
			assert.Contains(t, ep.Schema.Properties, "username")
			assert.Contains(t, ep.Schema.Properties, "age")
			assert.Equal(t, "string", ep.Schema.Properties["username"].Type)
			assert.Equal(t, "integer", ep.Schema.Properties["age"].Type)
			// Query parameters are in ep.QueryParams
			assert.Contains(t, ep.QueryParams, "filter")
			assert.Equal(t, "string", ep.QueryParams["filter"].Type)
		} else if ep.Method == "GET" {
			getEP = true
			assert.Equal(t, "/v1/users", ep.Path)
			// Query parameters are in ep.QueryParams
			assert.Contains(t, ep.QueryParams, "page")
			assert.Equal(t, "integer", ep.QueryParams["page"].Type)
		}
	}
	assert.True(t, postEP)
	assert.True(t, getEP)
}

func TestParseHARInvalid(t *testing.T) {
	_, err := ParseHAR([]byte(`{"log": {}}`), "")
	assert.Error(t, err)
}

func TestParseHAR_Merging(t *testing.T) {
	rawHAR := []byte(`{
		"log": {
			"entries": [
				{
					"request": {
						"method": "POST",
						"url": "https://api.example.com/v1/users",
						"queryString": [
							{"name": "filter", "value": "active"}
						],
						"postData": {
							"mimeType": "application/json",
							"text": "{\"username\": \"admin\"}"
						}
					}
				},
				{
					"request": {
						"method": "POST",
						"url": "https://api.example.com/v1/users",
						"queryString": [
							{"name": "sort", "value": "asc"}
						],
						"postData": {
							"mimeType": "application/json",
							"text": "{\"age\": 30}"
						}
					}
				}
			]
		}
	}`)

	res, err := ParseHAR(rawHAR, "")
	assert.NoError(t, err)
	assert.NotNil(t, res)
	assert.Len(t, res.Endpoints, 1)

	ep := res.Endpoints[0]
	assert.Equal(t, "/v1/users", ep.Path)
	assert.Equal(t, "POST", ep.Method)

	// Verify merged query params
	assert.Contains(t, ep.QueryParams, "filter")
	assert.Contains(t, ep.QueryParams, "sort")

	// Verify merged body params
	assert.Contains(t, ep.Schema.Properties, "username")
	assert.Contains(t, ep.Schema.Properties, "age")
}
