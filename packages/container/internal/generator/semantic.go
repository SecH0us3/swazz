package generator

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/google/uuid"
)

// WrapEmail wraps an injection vector into valid RFC 5322 email formats (using quoted-string local part).
func WrapEmail(vector string) []string {
	cleanVec := strings.ReplaceAll(vector, "\r", "")
	cleanVec = strings.ReplaceAll(cleanVec, "\n", "")
	escapedVec := strings.ReplaceAll(cleanVec, "\\", "\\\\")
	escapedVec = strings.ReplaceAll(escapedVec, "\"", "\\\"")
	return []string{
		fmt.Sprintf("\"%s\"@example.com", escapedVec),
		fmt.Sprintf("user+%s@example.org", url.QueryEscape(cleanVec)),
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

// WrapDateTime wraps an injection vector into valid ISO 8601 / RFC 3339 date-time strings.
func WrapDateTime(vector string) []string {
	cleanVec := url.QueryEscape(strings.ReplaceAll(strings.ReplaceAll(vector, "\r", ""), "\n", ""))
	return []string{
		fmt.Sprintf("2026-01-01T12:00:00.%sZ", cleanVec),
		fmt.Sprintf("2026-01-01T12:00:00Z#%s", url.QueryEscape(vector)),
	}
}

// WrapPhone wraps an injection vector into valid E.164 phone formats.
func WrapPhone(vector string) []string {
	// Extract numeric digits from vector or append clean query params
	var digits strings.Builder
	for _, ch := range vector {
		if ch >= '0' && ch <= '9' {
			digits.WriteRune(ch)
		}
	}
	digStr := digits.String()
	if digStr == "" {
		digStr = "1234567"
	}
	if len(digStr) > 10 {
		digStr = digStr[:10]
	}
	return []string{
		fmt.Sprintf("+1555%s;ext=%s", digStr, url.QueryEscape(vector)),
		fmt.Sprintf("+44207946%s", digStr),
	}
}

// WrapUUID embeds a vector into a valid RFC 4122 UUID layout without destructive payload loss.
func WrapUUID(vector string) []string {
	u := uuid.New().String()
	return []string{
		fmt.Sprintf("%s#%s", u, url.QueryEscape(vector)),
		u, // baseline: valid UUID without injection vector, for differential comparison
	}
}

