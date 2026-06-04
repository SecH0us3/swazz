package analyzer

import "swazz-engine/internal/swagger"

// AnalyzerRegistry aggregates multiple response analyzers and executes them in sequence.
type AnalyzerRegistry struct {
	analyzers []ResponseAnalyzer
}

// NewRegistry instantiates the default set of response body analyzers.
func NewRegistry() *AnalyzerRegistry {
	return &AnalyzerRegistry{
		analyzers: []ResponseAnalyzer{
			&XSSAnalyzer{},
			&SQLiAnalyzer{},
			&StackTraceAnalyzer{},
			&SensitiveAnalyzer{},
			NewCRLFAnalyzer(),
			&CORSAnalyzer{},
			&SizeAnalyzer{},
			NewCustomAnalyzer(),
			&TimingAnalyzer{},
			&PathTraversalAnalyzer{},
			&CmdiAnalyzer{},
			&SSTIAnalyzer{},
			&XXEAnalyzer{},
		},
	}
}

// Analyze runs the inputs against all registered checkers and combines their findings.
func (r *AnalyzerRegistry) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	var findings []swagger.AnalysisFinding
	for _, a := range r.analyzers {
		res := a.Analyze(input)
		if len(res) > 0 {
			findings = append(findings, res...)
		}
	}
	return findings
}
