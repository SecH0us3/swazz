package generator

import (
	"fmt"
	"net/url"
	"strings"
)

// WrapEmail wraps an injection vector into valid RFC email formats.
func WrapEmail(vector string) []string {
	cleanVec := strings.ReplaceAll(vector, "\n", "")
	cleanVec = strings.ReplaceAll(cleanVec, "\r", "")
	return []string{
		fmt.Sprintf("user+%s@example.com", url.QueryEscape(cleanVec)),
		fmt.Sprintf("\"%s\"@example.com", strings.ReplaceAll(cleanVec, "\"", "\\\"")),
		fmt.Sprintf("admin@%s.example.com", strings.ReplaceAll(strings.ToLower(cleanVec), " ", "-")),
	}
}

// WrapURL wraps an injection vector into valid URL formats using net/url API.
func WrapURL(vector string) []string {
	u, err := url.Parse("https://example.com/api/v1/test")
	if err != nil {
		return []string{"https://example.com/?q=" + url.QueryEscape(vector)}
	}
	q := u.Query()
	q.Set("q", vector)
	u.RawQuery = q.Encode()
	return []string{
		u.String(),
		fmt.Sprintf("https://example.com/path/%s", url.PathEscape(vector)),
	}
}

// WrapDateTime wraps an injection vector into valid ISO 8601 date-time strings.
func WrapDateTime(vector string) []string {
	return []string{
		fmt.Sprintf("2026-01-01T12:00:00.%sZ", url.QueryEscape(vector)),
		fmt.Sprintf("2026-01-01 %s", vector),
	}
}

// WrapPhone wraps an injection vector into valid E.164 phone formats.
func WrapPhone(vector string) []string {
	return []string{
		fmt.Sprintf("+1555%s", vector),
		fmt.Sprintf("+44207946%s", vector),
	}
}

// WrapUUID wraps an injection vector into valid UUID hex structures.
func WrapUUID(vector string) []string {
	hexVec := fmt.Sprintf("%x", vector)
	if len(hexVec) > 12 {
		hexVec = hexVec[:12]
	} else if len(hexVec) < 12 {
		hexVec = hexVec + strings.Repeat("0", 12-len(hexVec))
	}
	return []string{
		fmt.Sprintf("00000000-0000-4000-8000-%s", hexVec),
	}
}
