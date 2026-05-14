package main

import (
	"fmt"
	"swazz-engine/internal/generator"
	"swazz-engine/internal/swagger"
)

func main() {
	schema := &swagger.SchemaProperty{
		Type: "object",
		Properties: map[string]*swagger.SchemaProperty{
			"data": {Type: "string"},
		},
		Required: []string{"data"},
	}
	
	gen := generator.New(nil, swagger.ProfileBoundary)
	
	iterations := generator.MinIterationsNeeded(swagger.ProfileBoundary)
	fmt.Printf("Iterations needed: %d\n", iterations)
	
	for i := 0; i < iterations; i++ {
		obj := gen.BuildObject(schema)
		if data, ok := obj["data"].(string); ok {
			fmt.Printf("Iteration %d: length %d\n", i, len(data))
			if len(data) >= 1048576 {
				fmt.Printf("  -> FOUND LARGE STRING! (%d bytes)\n", len(data))
			}
		} else {
			fmt.Printf("Iteration %d: data missing or not a string: %v\n", i, obj["data"])
		}
	}
}
