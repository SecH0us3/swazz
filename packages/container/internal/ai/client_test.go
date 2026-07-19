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
