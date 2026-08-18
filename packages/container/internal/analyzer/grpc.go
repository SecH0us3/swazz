// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"strings"

	"swazz-engine/internal/swagger"
)

// GRPCStatusAnalyzer inspects gRPC status codes and error responses.
type GRPCStatusAnalyzer struct{}

// Analyze inspects gRPC error payloads for crashes, internal panics, data loss, and unexpected errors.
func (a *GRPCStatusAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if input.Method != "GRPC" && !strings.Contains(input.Endpoint, "grpc://") {
		return nil
	}

	bodyStr := string(input.ResponseBody)
	bodyLower := strings.ToLower(bodyStr)

	var findings []swagger.AnalysisFinding

	// 1. Check for connection drop / server crash
	if strings.Contains(bodyLower, "transport: error while reading from server: eof") ||
		strings.Contains(bodyLower, "broken pipe") ||
		strings.Contains(bodyLower, "connection reset by peer") ||
		strings.Contains(bodyLower, "all sub-channels are in transient-failure") {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:   "swazz/grpc-server-crash",
			Level:    "error",
			Message:  "gRPC server connection dropped or crashed during RPC processing.",
			Evidence: bodyStr,
		})
	}

	// 2. Check for Internal Error (Code = 13)
	if strings.Contains(bodyStr, "code = Internal") || strings.Contains(bodyStr, "code = 13") {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:   "swazz/grpc-internal-error",
			Level:    "error",
			Message:  "gRPC server returned status Internal (code 13), indicating an unhandled server error or panic.",
			Evidence: bodyStr,
		})
	}

	// 3. Check for DataLoss (Code = 15)
	if strings.Contains(bodyStr, "code = DataLoss") || strings.Contains(bodyStr, "code = 15") {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:   "swazz/grpc-data-loss",
			Level:    "error",
			Message:  "gRPC server returned status DataLoss (code 15).",
			Evidence: bodyStr,
		})
	}

	// 4. Check for Unknown (Code = 2)
	if strings.Contains(bodyStr, "code = Unknown") || strings.Contains(bodyStr, "code = 2") {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:   "swazz/grpc-unknown-error",
			Level:    "warning",
			Message:  "gRPC server returned status Unknown (code 2).",
			Evidence: bodyStr,
		})
	}

	return findings
}
