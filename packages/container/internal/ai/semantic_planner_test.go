package ai

import (
	"testing"
	"swazz-engine/internal/swagger"
)

func TestSemanticPlanner_ExtractSemanticFormats(t *testing.T) {
	planner := NewSemanticPlanner("http://localhost:8080", "test-cf-token", "test-key")
	cfg := &swagger.Config{
		Endpoints: []swagger.EndpointConfig{
			{
				Path:   "/api/users",
				Method: "POST",
				QueryParams: map[string]*swagger.SchemaProperty{
					"email": {Type: "string", Format: "email"},
				},
				PathParams: map[string]*swagger.SchemaProperty{
					"user_uuid": {Type: "string", Format: "uuid"},
				},
			},
		},
	}
	formats := planner.ExtractSemanticFormats(cfg)
	if formats == nil {
		t.Fatalf("expected non-nil format map")
	}
	if formats["email"] != "email" {
		t.Errorf("expected email format to be 'email', got %s", formats["email"])
	}
	if formats["user_uuid"] != "uuid" {
		t.Errorf("expected user_uuid format to be 'uuid', got %s", formats["user_uuid"])
	}
}
