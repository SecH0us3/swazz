// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)

// sync-features generates packages/shared/src/features.ts from the canonical
// feature manifest in internal/license/gates.go.
//
// The Go manifest (license.Features) is the single source of truth for feature
// IDs, labels, and gate types. This tool emits the TypeScript mirror used by
// the edge worker and the web dashboard.
//
// Usage:
//   go run ./cmd/sync-features
//   (or: go generate ./internal/license/...)

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"swazz-engine/internal/license"
)

const header = `// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)

// ⚠️ GENERATED FILE — DO NOT EDIT.
// Source of truth: packages/container/internal/license/gates.go (license.Features).
// Regenerate with: go run ./cmd/sync-features

export type FeatureType = 'paid' | 'coming_soon';

export interface FeatureDef {
  id: string;
  label: string;
  type: FeatureType;
}

export const FEATURE_TYPE_PAID: FeatureType = 'paid';
export const FEATURE_TYPE_COMING_SOON: FeatureType = 'coming_soon';

`

func main() {
	root, err := findRepoRoot()
	if err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}

	features := append([]license.FeatureDef(nil), license.Features...)
	sort.Slice(features, func(i, j int) bool { return features[i].ID < features[j].ID })

	var b strings.Builder
	b.WriteString(header)

	for _, f := range features {
		fmt.Fprintf(&b, "export const %s = '%s';\n", constName(f.ID), f.ID)
	}
	b.WriteString("\n")

	b.WriteString("export const FEATURES: FeatureDef[] = [\n")
	for _, f := range features {
		fmt.Fprintf(&b, "  { id: %s, label: %q, type: %q },\n", constName(f.ID), f.Label, string(f.Type))
	}
	b.WriteString("];\n\n")

	b.WriteString(`export function getFeature(id: string): FeatureDef | undefined {
  return FEATURES.find((f) => f.id === id);
}

export function getFeatureLabel(id: string): string {
  return getFeature(id)?.label ?? id;
}

export function getFeatureType(id: string): FeatureType {
  return getFeature(id)?.type ?? FEATURE_TYPE_PAID;
}
`)

	outPath := filepath.Join(root, "packages", "shared", "src", "features.ts")
	if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
	if err := os.WriteFile(outPath, []byte(b.String()), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
	fmt.Printf("Generated %s (%d features)\n", outPath, len(features))
}

// constName converts a feature ID to a TS constant name, e.g.
// "ai_remediation_pro" → "FEATURE_AI_REMEDIATION_PRO".
func constName(id string) string {
	parts := strings.Split(id, "_")
	for i, p := range parts {
		parts[i] = strings.ToUpper(p)
	}
	return "FEATURE_" + strings.Join(parts, "_")
}

// findRepoRoot walks up from the current directory until it finds the repo
// marker (package.json with "workspaces").
func findRepoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		marker := filepath.Join(dir, "package.json")
		if data, err := os.ReadFile(marker); err == nil && strings.Contains(string(data), `"workspaces"`) {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("repo root not found (no package.json with workspaces)")
		}
		dir = parent
	}
}
