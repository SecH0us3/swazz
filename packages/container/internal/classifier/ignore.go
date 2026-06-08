package classifier

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
	"sync"
)

var regexCache sync.Map

// IgnoreRule defines matching criteria to suppress false positive or noise findings.
type IgnoreRule struct {
	RuleID   string `json:"rule_id,omitempty"`
	Endpoint string `json:"endpoint,omitempty"`
	Method   string `json:"method,omitempty"`
	Payload  string `json:"payload,omitempty"`
}

// LoadIgnoreRules reads and parses ignore rules from a JSON file.
// If the file does not exist, it returns an empty slice and no error.
func LoadIgnoreRules(path string) ([]IgnoreRule, error) {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil, nil
	}

	data, err := os.ReadFile(path) // #nosec G304 -- config path is caller-specified
	if err != nil {
		return nil, fmt.Errorf("failed to read ignore file: %w", err)
	}

	var rules []IgnoreRule
	if err := json.Unmarshal(data, &rules); err != nil {
		return nil, fmt.Errorf("failed to parse ignore rules: %w", err)
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

	// 3. Endpoint match with wildcard support
	if r.Endpoint != "" {
		if strings.HasSuffix(r.Endpoint, "*") {
			prefix := r.Endpoint[:len(r.Endpoint)-1]
			if !strings.HasPrefix(f.Endpoint, prefix) {
				return false
			}
		} else {
			if r.Endpoint != f.Endpoint {
				return false
			}
		}
	}

	// 4. Payload match (regex or substring)
	if r.Payload != "" {
		if !payloadMatches(f.Payload, r.Payload) {
			return false
		}
	}

	return true
}

func payloadMatches(payload any, pattern string) bool {
	if pattern == "" {
		return true
	}
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

	// Try compiling as regex with caching
	var rx *regexp.Regexp
	if val, ok := regexCache.Load(pattern); ok {
		rx = val.(*regexp.Regexp)
	} else {
		var err error
		rx, err = regexp.Compile(pattern)
		if err == nil {
			regexCache.Store(pattern, rx)
		}
	}

	if rx != nil {
		return rx.MatchString(str)
	}

	// Fallback to substring
	return strings.Contains(str, pattern)
}
