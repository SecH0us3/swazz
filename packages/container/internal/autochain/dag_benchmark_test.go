// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package autochain

import (
	"fmt"
	"testing"

	"swazz-engine/internal/swagger"
)

func BenchmarkBuildPlan_50Endpoints(b *testing.B) {
	eps := make([]swagger.EndpointConfig, 0, 50)
	for i := range 10 {
		res := fmt.Sprintf("res%d", i)
		idParam := fmt.Sprintf("res%dId", i)
		eps = append(eps,
			swagger.EndpointConfig{
				Path:           "/api/" + res,
				Method:         "POST",
				ResponseSchema: &swagger.SchemaProperty{Type: "object", Properties: map[string]*swagger.SchemaProperty{"id": {Type: "string"}}},
			},
			swagger.EndpointConfig{Path: "/api/" + res, Method: "GET"},
			swagger.EndpointConfig{Path: "/api/" + res + "/{" + idParam + "}", Method: "GET", PathParams: map[string]*swagger.SchemaProperty{idParam: {Type: "string"}}},
			swagger.EndpointConfig{Path: "/api/" + res + "/{" + idParam + "}", Method: "PATCH", PathParams: map[string]*swagger.SchemaProperty{idParam: {Type: "string"}}},
			swagger.EndpointConfig{Path: "/api/" + res + "/{" + idParam + "}", Method: "DELETE", PathParams: map[string]*swagger.SchemaProperty{idParam: {Type: "string"}}},
		)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		_ = BuildPlan(eps, nil, "https://api.example.com")
	}
}
