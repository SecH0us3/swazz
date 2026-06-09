package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/graphql"
	"swazz-engine/internal/postman"
	"swazz-engine/internal/swagger"
	"swazz-engine/internal/wsdl"
	"time"

	"github.com/gin-gonic/gin"
)

func (h *Handler) ParseSpec(c *gin.Context) {
	var req parseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON body"})
		return
	}

	var raw json.RawMessage

	if len(req.Spec) > 0 {
		raw = req.Spec
	} else if req.URL != "" {
		// Strict URL validation: only HTTP and HTTPS schemes are allowed to mitigate SSRF.
		// Since Swazz is a fuzzer, scanning arbitrary target URLs is by design, but we restrict the protocol.
		parsedURL, err := url.Parse(req.URL)
		if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid URL: scheme must be http or https"})
			return
		}
		sanitizedURL := parsedURL.String()

		// Fetch spec from URL
		ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
		defer cancel()

		var fetchErr error
		raw, fetchErr = swagger.FetchRemoteSpec(ctx, h.getClient(), sanitizedURL, nil, graphql.IntrospectionQuery)
		if fetchErr != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("failed to fetch valid OpenAPI or GraphQL spec from the URL: %s", fetchErr)})
			return
		}
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provide either 'url' or 'spec'"})
		return
	}

	result, err := swagger.ParseRawSpec(raw)
	if err != nil {
		if swagger.IsPostman(raw) {
			resultPostman, errPostman := postman.ParsePostman(raw)
			if errPostman == nil {
				c.JSON(http.StatusOK, resultPostman)
				return
			}
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": fmt.Sprintf("failed to parse spec as Postman Collection: %v", errPostman.Error())})
			return
		}

		defaultPath := "/graphql"
		if req.URL != "" {
			if parsedURL, errURL := url.Parse(req.URL); errURL == nil {
				if parsedURL.Path != "" && parsedURL.Path != "/" {
					defaultPath = parsedURL.Path
				}
			}
		}
		if swagger.IsWSDL(raw) {
			resultWSDL, errWSDL := wsdl.ParseWSDL(raw)
			if errWSDL == nil {
				c.JSON(http.StatusOK, resultWSDL)
				return
			}
		}
		resultGQL, errGQL := graphql.ParseGraphQLIntrospection(raw, defaultPath)
		if errGQL != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": fmt.Sprintf("failed to parse spec as OpenAPI (%v), WSDL, Postman or GraphQL (%v)", err.Error(), errGQL.Error())})
			return
		}
		result = resultGQL
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) GetPayloadCatalog(c *gin.Context) {
	catalog := swagger.PayloadCatalog{}

	for _, cat := range payloads.RandomCategories {
		catalog[swagger.ProfileRandom] = append(catalog[swagger.ProfileRandom], swagger.PayloadCategoryDef{
			ID:          cat.ID,
			Label:       cat.Label,
			Description: cat.Description,
			Count:       -1, // dynamic — no fixed count for random
		})
	}
	for _, cat := range payloads.BoundaryCategories {
		catalog[swagger.ProfileBoundary] = append(catalog[swagger.ProfileBoundary], swagger.PayloadCategoryDef{
			ID:          cat.ID,
			Label:       cat.Label,
			Description: cat.Description,
			Count:       len(cat.Items),
		})
	}
	for _, cat := range payloads.MaliciousCategories {
		catalog[swagger.ProfileMalicious] = append(catalog[swagger.ProfileMalicious], swagger.PayloadCategoryDef{
			ID:          cat.ID,
			Label:       cat.Label,
			Description: cat.Description,
			Count:       len(cat.Items),
		})
	}

	c.JSON(http.StatusOK, catalog)
}
