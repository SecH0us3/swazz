package classifier

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"

	"swazz-engine/internal/swagger"
)

// endpointGlobToRegex converts a glob pattern into a full-match regular
// expression string.  Semantics mirror the glob engine in utils.go:
//
//	** – matches any characters including path separators (/)
//	*  – matches any characters within a single path segment (no /)
//	all other characters are treated as regex literals (QuoteMeta)
func endpointGlobToRegex(p string) string {
	runes := []rune(p)
	var b strings.Builder
	b.WriteString("^")
	for i := 0; i < len(runes); i++ {
		switch {
		case runes[i] == '*' && i+1 < len(runes) && runes[i+1] == '*':
			b.WriteString(".*") // ** → cross-segment wildcard
			i++
		case runes[i] == '*':
			b.WriteString("[^/]*") // * → single-segment wildcard
		default:
			b.WriteString(regexp.QuoteMeta(string(runes[i])))
		}
	}
	b.WriteString("$")
	return b.String()
}

// endpointMatches reports whether a glob pattern matches an endpoint string.
func endpointMatches(pattern, endpoint string) bool {
	matched, _ := regexp.MatchString(endpointGlobToRegex(pattern), endpoint)
	return matched
}

// IgnoreRule defines matching criteria to suppress false positive or noise findings.
type IgnoreRule = swagger.IgnoreRule

// LoadIgnoreRules reads and parses ignore rules from a JSON file.
// If the file does not exist, it returns an empty slice and no error.
func LoadIgnoreRules(path string) ([]IgnoreRule, error) {
	data, err := os.ReadFile(path) // #nosec G304 -- config path is caller-specified
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to read ignore file: %w", err)
	}
	data = swagger.StripJSONC(data)

	var rules []IgnoreRule
	if err := json.Unmarshal(data, &rules); err != nil {
		return nil, fmt.Errorf("failed to parse ignore rules: %w", err)
	}

	for i := range rules {
		if rules[i].Payload != "" {
			if rx, err := regexp.Compile(rules[i].Payload); err == nil {
				rules[i].PayloadRx = rx
			}
		}
	}

	return rules, nil
}

// IsIgnored returns true if the finding matches the criteria of any ignore rule.
// A rule matches a finding if and only if all non-empty fields of the rule match the finding.
func IsIgnored(f *Finding, rules []IgnoreRule) bool {
	if f == nil || len(rules) == 0 {
		return false
	}

	for _, rule := range rules {
		if ruleMatches(f, &rule) {
			return true
		}
	}

	return false
}

func ruleMatches(f *Finding, r *IgnoreRule) bool {
	// 1. RuleID match
	if r.RuleID != "" && r.RuleID != f.RuleID {
		return false
	}

	// 2. Method match (case-insensitive)
	if r.Method != "" && !strings.EqualFold(r.Method, f.Method) {
		return false
	}

	// 3. Endpoint match — full glob semantics (* single-segment, ** cross-segment).
	if r.Endpoint != "" && !endpointMatches(r.Endpoint, f.Endpoint) {
		return false
	}

	// 4. Payload match (regex or substring)
	if r.Payload != "" {
		if !payloadMatches(f.Payload, r) {
			return false
		}
	}

	return true
}

func payloadMatches(payload any, r *IgnoreRule) bool {
	if payload == nil {
		return false
	}

	var str string
	switch p := payload.(type) {
	case []byte:
		str = string(p)
	case string:
		str = p
	default:
		if j, err := json.Marshal(p); err == nil {
			str = string(j)
		} else {
			str = fmt.Sprintf("%v", p)
		}
	}

	if r.PayloadRx != nil {
		return r.PayloadRx.MatchString(str)
	}

	// Fallback to substring
	return strings.Contains(str, r.Payload)
}
