// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"testing"
)

func TestSSRFCloudMetadataAnalyzer(t *testing.T) {
	analyzer := &SSRFCloudMetadataAnalyzer{}

	tests := []struct {
		name          string
		responseBody  string
		expectFinding bool
		expectedRule  string
		expectedCWE   string
	}{
		{
			name:          "Clean response",
			responseBody:  `{"status":"ok","url":"https://example.com"}`,
			expectFinding: false,
		},
		{
			name:          "AWS EC2 Instance Metadata leak",
			responseBody:  `ami-0abcdef1234567890\ni-0123456789abcdef0\ninstance-type: t3.medium`,
			expectFinding: true,
			expectedRule:  "swazz/ssrf-cloud-metadata",
			expectedCWE:   "CWE-918",
		},
		{
			name:          "AWS IAM Credentials JSON leak",
			responseBody:  `{"Code":"Success","LastUpdated":"2026-08-28T00:00:00Z","Type":"AWS-HMAC","AccessKeyId":"ASIA..."}`,
			expectFinding: true,
			expectedRule:  "swazz/ssrf-cloud-metadata",
			expectedCWE:   "CWE-918",
		},
		{
			name:          "GCP Cloud Metadata leak",
			responseBody:  `{"project":{"numericProjectId":123,"projectId":"my-gcp-app.compute.internal"}}`,
			expectFinding: true,
			expectedRule:  "swazz/ssrf-cloud-metadata",
			expectedCWE:   "CWE-918",
		},
		{
			name:          "Azure Instance Metadata leak",
			responseBody:  `{"compute":{"azEnvironment":"AzurePublicCloud","vmId":"12345678-1234-1234-1234-1234567890ab","subscriptionId":"98765432-4321-4321-4321-ba0987654321"}}`,
			expectFinding: true,
			expectedRule:  "swazz/ssrf-cloud-metadata",
			expectedCWE:   "CWE-918",
		},
		{
			name:          "Kubernetes ServiceAccount leak",
			responseBody:  `system:serviceaccount:kube-system:default`,
			expectFinding: true,
			expectedRule:  "swazz/ssrf-cloud-metadata",
			expectedCWE:   "CWE-918",
		},
		{
			name:          "Envoy admin port leak",
			responseBody:  `cluster_manager.warming_clusters: 0\nlistener_manager.workers_started: 1`,
			expectFinding: true,
			expectedRule:  "swazz/ssrf-cloud-metadata",
			expectedCWE:   "CWE-918",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := &AnalysisInput{
				ResponseBody: []byte(tt.responseBody),
			}
			findings := analyzer.Analyze(input)
			if tt.expectFinding {
				if len(findings) == 0 {
					t.Fatalf("expected finding for test %q, got none", tt.name)
				}
				if findings[0].RuleID != tt.expectedRule {
					t.Errorf("expected rule ID %q, got %q", tt.expectedRule, findings[0].RuleID)
				}
				if len(findings[0].CWEIDs) == 0 || findings[0].CWEIDs[0] != tt.expectedCWE {
					t.Errorf("expected %s, got %v", tt.expectedCWE, findings[0].CWEIDs)
				}
			} else {
				if len(findings) > 0 {
					t.Fatalf("unexpected finding for test %q: %v", tt.name, findings)
				}
			}
		})
	}
}
