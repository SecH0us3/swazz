package ai

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
)

type AIAnalyzer interface {
	Analyze(findingMessage string, contextCode string, prompt string) (string, error)
}

type CLIAnalyzer struct {
	CommandTemplate string
}

func NewCLIAnalyzer(commandTemplate string) *CLIAnalyzer {
	return &CLIAnalyzer{
		CommandTemplate: commandTemplate,
	}
}

func (c *CLIAnalyzer) Analyze(findingMessage string, contextCode string, prompt string) (string, error) {
	tmpFile, err := os.CreateTemp("", "swazz-prompt-*.txt")
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %w", err)
	}
	defer os.Remove(tmpFile.Name())

	fullPrompt := fmt.Sprintf("%s\n<untrusted-finding-context>\n%s\n</untrusted-finding-context>\n<code-context>\n%s\n</code-context>\n", prompt, findingMessage, contextCode)

	if _, err := tmpFile.WriteString(fullPrompt); err != nil {
		tmpFile.Close()
		return "", fmt.Errorf("failed to write to temp file: %w", err)
	}
	tmpFile.Close()

	fields := strings.Fields(c.CommandTemplate)
	if len(fields) == 0 {
		return "", fmt.Errorf("empty command template")
	}

	cmdName := fields[0]
	var args []string
	for _, arg := range fields[1:] {
		args = append(args, strings.ReplaceAll(arg, "{{prompt_file}}", tmpFile.Name()))
	}

	cmd := exec.Command(cmdName, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("command execution failed: %w", err)
	}

	return string(out), nil
}
