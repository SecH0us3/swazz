package ai

import (
	"strings"
	"testing"
)

func TestCLIAnalyzer_Analyze(t *testing.T) {
	// "cat" is safe cross-platform enough for Unix-like testing, which Mac OS handles well.
	analyzer := NewCLIAnalyzer("cat {{prompt_file}}")
	
	findingMessage := "SQL Injection found"
	contextCode := "SELECT * FROM users"
	prompt := "Analyze this finding:"

	out, err := analyzer.Analyze(findingMessage, contextCode, prompt)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if !strings.Contains(out, "<untrusted-finding-context>") {
		t.Errorf("expected output to contain <untrusted-finding-context>, got:\n%s", out)
	}
	if !strings.Contains(out, "</untrusted-finding-context>") {
		t.Errorf("expected output to contain </untrusted-finding-context>, got:\n%s", out)
	}
	if !strings.Contains(out, findingMessage) {
		t.Errorf("expected output to contain findingMessage, got:\n%s", out)
	}
	if !strings.Contains(out, "<code-context>") {
		t.Errorf("expected output to contain <code-context>, got:\n%s", out)
	}
	if !strings.Contains(out, "</code-context>") {
		t.Errorf("expected output to contain </code-context>, got:\n%s", out)
	}
	if !strings.Contains(out, contextCode) {
		t.Errorf("expected output to contain contextCode, got:\n%s", out)
	}
	if !strings.Contains(out, prompt) {
		t.Errorf("expected output to contain prompt, got:\n%s", out)
	}
}

func TestCLIAnalyzer_AnalyzeStdin(t *testing.T) {
	// "cat" reads from stdin on Unix-like systems (Mac OS) when no file arguments are passed
	analyzer := NewCLIAnalyzer("cat")
	
	findingMessage := "SQL Injection found"
	contextCode := "SELECT * FROM users"
	prompt := "Analyze this finding:"

	out, err := analyzer.Analyze(findingMessage, contextCode, prompt)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if !strings.Contains(out, findingMessage) {
		t.Errorf("expected output to contain findingMessage, got:\n%s", out)
	}
}

func TestCLIAnalyzer_AnalyzeStdinWithHyphen(t *testing.T) {
	// "cat -" reads from stdin on Unix-like systems (Mac OS) when "-" is passed
	analyzer := NewCLIAnalyzer("cat -")
	
	findingMessage := "CRLF Injection found"
	contextCode := "resp.Header.Add(\"Location\", input)"
	prompt := "Check this out:"

	out, err := analyzer.Analyze(findingMessage, contextCode, prompt)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if !strings.Contains(out, findingMessage) {
		t.Errorf("expected output to contain findingMessage, got:\n%s", out)
	}
	if !strings.Contains(out, contextCode) {
		t.Errorf("expected output to contain contextCode, got:\n%s", out)
	}
}

func TestSplitCommand(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected []string
		wantErr  bool
	}{
		{
			name:     "simple",
			input:    "vibe -p - --auto-approve --trust",
			expected: []string{"vibe", "-p", "-", "--auto-approve", "--trust"},
		},
		{
			name:     "double quotes",
			input:    `claude -m "claude-3-5-sonnet" -p {{prompt_file}}`,
			expected: []string{"claude", "-m", "claude-3-5-sonnet", "-p", "{{prompt_file}}"},
		},
		{
			name:     "single quotes",
			input:    `tool --option='value with spaces'`,
			expected: []string{"tool", "--option=value with spaces"},
		},
		{
			name:     "escaped space",
			input:    `tool -x \ `,
			expected: []string{"tool", "-x", " "},
		},
		{
			name:     "nested quotes",
			input:    `tool "arg with 'single' quotes"`,
			expected: []string{"tool", "arg with 'single' quotes"},
		},
		{
			name:    "unclosed double quotes",
			input:   `tool "unclosed`,
			wantErr: true,
		},
		{
			name:    "unclosed single quotes",
			input:   `tool 'unclosed`,
			wantErr: true,
		},
		{
			name:    "trailing backslash",
			input:   `tool \`,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := splitCommand(tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("splitCommand() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr {
				if len(got) != len(tt.expected) {
					t.Fatalf("expected %v, got %v", tt.expected, got)
				}
				for i := range got {
					if got[i] != tt.expected[i] {
						t.Errorf("at index %d: expected %q, got %q", i, tt.expected[i], got[i])
					}
				}
			}
		})
	}
}
