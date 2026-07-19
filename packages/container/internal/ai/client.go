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
	fields := strings.Fields(c.CommandTemplate)
	if len(fields) == 0 {
		return "", fmt.Errorf("empty command template")
	}

	fullPrompt := fmt.Sprintf("%s\n<untrusted-finding-context>\n%s\n</untrusted-finding-context>\n<code-context>\n%s\n</code-context>\n", prompt, findingMessage, contextCode)

	cmdName := fields[0]
	var args []string

	// If command contains "{{prompt_file}}", we use the temp file approach and do NOT pipe to stdin.
	// Otherwise, we pipe the prompt directly to stdin and avoid creating a temporary file.
	if strings.Contains(c.CommandTemplate, "{{prompt_file}}") {
		tmpFile, err := os.CreateTemp("", "swazz-prompt-*.txt")
		if err != nil {
			return "", fmt.Errorf("failed to create temp file: %w", err)
		}
		defer os.Remove(tmpFile.Name())

		if _, err := tmpFile.WriteString(fullPrompt); err != nil {
			_ = tmpFile.Close()
			return "", fmt.Errorf("failed to write to temp file: %w", err)
		}
		_ = tmpFile.Close()

		for _, arg := range fields[1:] {
			args = append(args, strings.ReplaceAll(arg, "{{prompt_file}}", tmpFile.Name()))
		}

		// #nosec G204 -- The command array is intentionally constructed from user configuration in a controlled runner environment
		cmd := exec.Command(cmdName, args...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			return string(out), fmt.Errorf("command execution failed: %w", err)
		}
		return string(out), nil
	}

	// Stdin-based command execution (e.g. vibe)
	for _, arg := range fields[1:] {
		args = append(args, arg)
	}

	// #nosec G204 -- The command array is intentionally constructed from user configuration in a controlled runner environment
	cmd := exec.Command(cmdName, args...)
	cmd.Stdin = strings.NewReader(fullPrompt)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("command execution failed: %w", err)
	}

	return string(out), nil
}
