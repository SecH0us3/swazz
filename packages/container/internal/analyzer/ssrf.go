// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"fmt"
	"regexp"

	"swazz-engine/internal/swagger"
)

// SSRFCloudMetadataAnalyzer detects cloud instance metadata, Kubernetes tokens, and service mesh admin interface leaks resulting from SSRF attacks.
type SSRFCloudMetadataAnalyzer struct{}

type ssrfSignature struct {
	provider string
	pattern  *regexp.Regexp
}

var ssrfSignatures = []ssrfSignature{
	{"AWS IMDS", regexp.MustCompile(`(?i)(ami-[0-9a-fA-F]{8,17}|i-[0-9a-fA-F]{8,17}|security-credentials/[a-zA-Z0-9_-]+|"Code"\s*:\s*"Success"\s*,\s*"LastUpdated"|iam/info)`)},
	{"GCP Cloud Metadata", regexp.MustCompile(`(?i)(computeMetadata/v1|Metadata-Flavor:\s*Google|compute[.]internal|service-accounts/default/token)`)},
	{"Azure IMDS", regexp.MustCompile(`(?i)("azEnvironment"\s*:\s*"AzurePublicCloud"|"vmId"\s*:\s*"[0-9a-fA-F-]+"|"subscriptionId"\s*:\s*"[0-9a-fA-F-]+")`)},
	{"Kubernetes ServiceAccount", regexp.MustCompile(`(?i)(var/run/secrets/kubernetes[.]io/serviceaccount/token|apiVersion:\s*v1.*kind:\s*Secret|system:serviceaccount:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+)`)},
	{"Envoy/Service Mesh Admin", regexp.MustCompile(`(?i)(cluster_manager|listener_manager|stats_recent_lookups|server_info.*envoy)`)},
}

func (a *SSRFCloudMetadataAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if len(input.ResponseBody) == 0 {
		return nil
	}

	// Fast pre-filter: skip scanning if no cloud metadata / internal service indicators are present in response body
	if !containsAnyFoldASCII(input.ResponseBody, "ami-", "i-", "security-credentials", "computemetadata", "metadata-flavor", "azenvironment", "subscriptionid", "vmid", "kubernetes.io/serviceaccount", "cluster_manager", "listener_manager", "serviceaccount", "lastupdated", "iam/info", "compute.internal") {
		return nil
	}

	var findings []swagger.AnalysisFinding

	for _, sig := range ssrfSignatures {
		loc := sig.pattern.FindIndex(input.ResponseBody)
		if loc != nil {
			matchText := string(input.ResponseBody[loc[0]:loc[1]])

			start := loc[0] - 50
			if start < 0 {
				start = 0
			}
			end := loc[1] + 50
			if end > len(input.ResponseBody) {
				end = len(input.ResponseBody)
			}
			contextSnippet := string(input.ResponseBody[start:end])
			if len(contextSnippet) > 200 {
				contextSnippet = contextSnippet[:200]
			}

			findings = append(findings, swagger.AnalysisFinding{
				RuleID:           "swazz/ssrf-cloud-metadata",
				Level:            "critical",
				Message:          fmt.Sprintf("Cloud instance metadata or internal interface (%s) leaked in response, indicating SSRF vulnerability.", sig.provider),
				Evidence:         fmt.Sprintf("Match: %q | Context: ...%s...", matchText, contextSnippet),
				OWASPAPICategory: []string{"API7:2023 Server Side Request Forgery"},
				OWASPCategory:    []string{"A01:2025 Broken Access Control"},
				CWEIDs:           []string{"CWE-918"},
			})
			break
		}
	}

	return findings
}
