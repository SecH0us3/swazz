package classifier

import "testing"

func TestSeverityRank(t *testing.T) {
	tests := []struct {
		name     string
		level    Severity
		expected int
	}{
		{"error is rank 3", SeverityError, 3},
		{"warning is rank 2", SeverityWarning, 2},
		{"note is rank 1", SeverityNote, 1},
		{"ignore is rank 0", SeverityIgnore, 0},
		{"unknown string is rank 0", Severity("banana"), 0},
		{"empty string is rank 0", Severity(""), 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SeverityRank(tt.level)
			if got != tt.expected {
				t.Errorf("SeverityRank(%q) = %d, want %d", tt.level, got, tt.expected)
			}
		})
	}
}

func TestFindingsExceedThreshold(t *testing.T) {
	tests := []struct {
		name      string
		findings  []*Finding
		threshold string
		expected  bool
	}{
		{
			name:      "empty findings always returns false",
			findings:  []*Finding{},
			threshold: "error",
			expected:  false,
		},
		{
			name: "threshold none returns false even with error findings",
			findings: []*Finding{
				{Level: SeverityError},
			},
			threshold: "none",
			expected:  false,
		},
		{
			name: "threshold empty string returns false",
			findings: []*Finding{
				{Level: SeverityError},
			},
			threshold: "",
			expected:  false,
		},
		{
			name: "threshold error with only warnings returns false",
			findings: []*Finding{
				{Level: SeverityWarning},
				{Level: SeverityWarning},
			},
			threshold: "error",
			expected:  false,
		},
		{
			name: "threshold error with one error returns true",
			findings: []*Finding{
				{Level: SeverityWarning},
				{Level: SeverityError},
			},
			threshold: "error",
			expected:  true,
		},
		{
			name: "threshold warning with only notes returns false",
			findings: []*Finding{
				{Level: SeverityNote},
				{Level: SeverityNote},
			},
			threshold: "warning",
			expected:  false,
		},
		{
			name: "threshold warning with one warning returns true",
			findings: []*Finding{
				{Level: SeverityNote},
				{Level: SeverityWarning},
			},
			threshold: "warning",
			expected:  true,
		},
		{
			name: "threshold note with one note returns true",
			findings: []*Finding{
				{Level: SeverityNote},
			},
			threshold: "note",
			expected:  true,
		},
		{
			name: "threshold warning with an error also returns true",
			findings: []*Finding{
				{Level: SeverityError},
			},
			threshold: "warning",
			expected:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := FindingsExceedThreshold(tt.findings, tt.threshold)
			if got != tt.expected {
				t.Errorf("FindingsExceedThreshold(threshold=%q) = %v, want %v", tt.threshold, got, tt.expected)
			}
		})
	}
}
