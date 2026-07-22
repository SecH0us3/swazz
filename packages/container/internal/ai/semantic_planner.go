package ai

import (
	"swazz-engine/internal/swagger"
)

type SemanticPlanner struct {
	gatewayURL string
	apiKey     string
}

func NewSemanticPlanner(gatewayURL, apiKey string) *SemanticPlanner {
	return &SemanticPlanner{
		gatewayURL: gatewayURL,
		apiKey:     apiKey,
	}
}

// ExtractSemanticFormats scans a swagger Config for parameter formats and semantic types.
func (p *SemanticPlanner) ExtractSemanticFormats(cfg *swagger.Config) map[string]string {
	result := make(map[string]string)
	if cfg == nil {
		return result
	}
	for _, ep := range cfg.Endpoints {
		extractParams(ep.PathParams, result)
		extractParams(ep.QueryParams, result)
		extractParams(ep.HeaderParams, result)
		extractSchemaProps(ep.Schema.Properties, result)
	}
	return result
}

func extractParams(params map[string]*swagger.SchemaProperty, result map[string]string) {
	for name, prop := range params {
		if prop != nil && prop.Format != "" {
			result[name] = prop.Format
		}
	}
}

func extractSchemaProps(props map[string]*swagger.SchemaProperty, result map[string]string) {
	for name, prop := range props {
		if prop != nil && prop.Format != "" {
			result[name] = prop.Format
		}
	}
}
