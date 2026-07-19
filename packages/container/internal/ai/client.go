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
	fields, err := splitCommand(c.CommandTemplate)
	if err != nil {
		return "", fmt.Errorf("failed to parse command template: %w", err)
	}
	if len(fields) == 0 {
		return "", fmt.Errorf("empty command template")
	}

	fullPrompt := fmt.Sprintf("%s\n<untrusted-finding-context>\n%s\n</untrusted-finding-context>\n<code-context>\n%s\n</code-context>\n", prompt, findingMessage, contextCode)

	cmdName := fields[0]
	var args []string
	var stdin *strings.Reader

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
	} else {
		// Stdin-based command execution (e.g. vibe)
		args = fields[1:]
		stdin = strings.NewReader(fullPrompt)
	}

	// #nosec G204 -- The command array is intentionally constructed from user configuration in a controlled runner environment
	cmd := exec.Command(cmdName, args...)
	if stdin != nil {
		cmd.Stdin = stdin
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("command execution failed: %w", err)
	}

	return string(out), nil
}

// splitCommand splits a command string into words, respecting single and double quotes, and backslash escapes.
func splitCommand(template string) ([]string, error) {
	var parts []string
	var current strings.Builder
	inDoubleQuotes := false
	inSingleQuotes := false
	escaped := false

	for i := 0; i < len(template); i++ {
		r := template[i]

		if escaped {
			current.WriteByte(r)
			escaped = false
			continue
		}

		if r == '\\' {
			if inSingleQuotes {
				current.WriteByte(r)
			} else {
				escaped = true
			}
			continue
		}

		if r == '"' {
			if inSingleQuotes {
				current.WriteByte(r)
			} else {
				inDoubleQuotes = !inDoubleQuotes
			}
			continue
		}

		if r == '\'' {
			if inDoubleQuotes {
				current.WriteByte(r)
			} else {
				inSingleQuotes = !inSingleQuotes
			}
			continue
		}

		if (r == ' ' || r == '\t' || r == '\n' || r == '\r') && !inDoubleQuotes && !inSingleQuotes {
			if current.Len() > 0 {
				parts = append(parts, current.String())
				current.Reset()
			}
			continue
		}

		current.WriteByte(r)
	}

	if inDoubleQuotes || inSingleQuotes {
		return nil, fmt.Errorf("unclosed quotes in command template")
	}
	if escaped {
		return nil, fmt.Errorf("trailing backslash escape in command template")
	}

	if current.Len() > 0 {
		parts = append(parts, current.String())
	}

	return parts, nil
}
