package bola

import (
	"testing"
)

func TestCheckSimilarity(t *testing.T) {
	tests := []struct {
		name          string
		bodyA         string
		bodyB         string
		minSimilarity float64
		maxSimilarity float64
	}{
		{
			name:          "Identical JSON",
			bodyA:         `{"id": 1, "name": "Alice"}`,
			bodyB:         `{"id": 1, "name": "Alice"}`,
			minSimilarity: 0.99,
			maxSimilarity: 1.0,
		},
		{
			name:          "Structurally identical JSON with different values",
			bodyA:         `{"id": 1, "name": "Alice", "email": "alice@example.com"}`,
			bodyB:         `{"id": 2, "name": "Bob", "email": "bob@example.com"}`,
			minSimilarity: 0.85,
			maxSimilarity: 0.98,
		},
		{
			name:          "Structurally different JSON",
			bodyA:         `{"id": 1, "name": "Alice"}`,
			bodyB:         `{"error": "Unauthorized", "code": 401}`,
			minSimilarity: 0.0,
			maxSimilarity: 0.3,
		},
		{
			name:          "Empty inputs",
			bodyA:         "",
			bodyB:         "",
			minSimilarity: 1.0,
			maxSimilarity: 1.0,
		},
		{
			name:          "One empty input",
			bodyA:         `{"id": 1}`,
			bodyB:         "",
			minSimilarity: 0.0,
			maxSimilarity: 0.0,
		},
		{
			name:          "Non-JSON identical text",
			bodyA:         "Hello world this is swazz",
			bodyB:         "Hello world this is swazz",
			minSimilarity: 0.99,
			maxSimilarity: 1.0,
		},
		{
			name:          "Non-JSON similar text",
			bodyA:         "Hello user Alice",
			bodyB:         "Hello user Bob",
			minSimilarity: 0.5,
			maxSimilarity: 0.9,
		},
		{
			name:          "Non-JSON completely different",
			bodyA:         "Hello user Alice",
			bodyB:         "Access denied",
			minSimilarity: 0.0,
			maxSimilarity: 0.4,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sim := CheckSimilarity([]byte(tt.bodyA), []byte(tt.bodyB))
			if sim < tt.minSimilarity || sim > tt.maxSimilarity {
				t.Errorf("expected similarity in range [%.2f, %.2f], got %.4f", tt.minSimilarity, tt.maxSimilarity, sim)
			}
		})
	}
}
