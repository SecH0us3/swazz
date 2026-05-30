package analyzer

import (
	"net/http"
	"swazz-engine/internal/swagger"
)

// AnalysisInput represents the input payload and response metadata used for body analysis.
type AnalysisInput struct {
	SentPayload     any
	ResponseBody    []byte
	ResponseHeaders http.Header
	Duration        int64
	Profile         swagger.FuzzingProfile
	Endpoint        string
	Method          string
	ResponseSize    int64
	BaselineSize    int64
	SizeMultiplier  float64
}

// ResponseAnalyzer is the interface implemented by each specific vulnerability scanner.
type ResponseAnalyzer interface {
	Analyze(input *AnalysisInput) []swagger.AnalysisFinding
}
