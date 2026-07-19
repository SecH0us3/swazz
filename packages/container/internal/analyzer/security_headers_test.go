package analyzer

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSecurityHeadersAnalyzer(t *testing.T) {
	a := &SecurityHeadersAnalyzer{}

	t.Run("nil input or nil headers", func(t *testing.T) {
		assert.Nil(t, a.Analyze(nil))
		assert.Nil(t, a.Analyze(&AnalysisInput{}))
	})

	t.Run("missing all headers", func(t *testing.T) {
		headers := make(http.Header)
		// Set Content-Type HTML to check X-Frame-Options
		headers.Set("Content-Type", "text/html")
		
		input := &AnalysisInput{
			ResponseHeaders: headers,
		}
		findings := a.Analyze(input)

		var ruleIDs []string
		for _, f := range findings {
			ruleIDs = append(ruleIDs, f.RuleID)
		}

		assert.Contains(t, ruleIDs, "swazz/hsts-missing")
		assert.Contains(t, ruleIDs, "swazz/x-frame-options-missing")
		assert.Contains(t, ruleIDs, "swazz/x-content-type-options-missing")
	})

	t.Run("secure headers configured correctly", func(t *testing.T) {
		headers := make(http.Header)
		headers.Set("Content-Type", "text/html")
		headers.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		headers.Set("X-Frame-Options", "DENY")
		headers.Set("X-Content-Type-Options", "nosniff")
		headers.Set("Server", "Cloudflare") // No version leakage

		input := &AnalysisInput{
			ResponseHeaders: headers,
		}
		findings := a.Analyze(input)
		assert.Empty(t, findings)
	})

	t.Run("insecure configs and verbose server disclosures", func(t *testing.T) {
		headers := make(http.Header)
		headers.Set("Content-Type", "application/xhtml+xml")
		headers.Set("Strict-Transport-Security", "includeSubdomains")
		headers.Set("X-Frame-Options", "ALLOWALL") // Insecure
		headers.Set("X-Content-Type-Options", "sniff") // Insecure
		headers.Set("Server", "nginx/1.21.6") // Verbose version leakage
		headers.Set("X-Powered-By", "PHP/8.1")
		headers.Set("X-AspNet-Version", "4.0.30319")

		input := &AnalysisInput{
			ResponseHeaders: headers,
		}
		findings := a.Analyze(input)

		var ruleIDs []string
		for _, f := range findings {
			ruleIDs = append(ruleIDs, f.RuleID)
		}

		assert.Contains(t, ruleIDs, "swazz/hsts-insecure")
		assert.Contains(t, ruleIDs, "swazz/x-frame-options-insecure")
		assert.Contains(t, ruleIDs, "swazz/x-content-type-options-insecure")
		assert.Contains(t, ruleIDs, "swazz/server-header-leak")
		assert.Contains(t, ruleIDs, "swazz/x-powered-by-leak")
		assert.Contains(t, ruleIDs, "swazz/x-aspnet-version-leak")
	})
}
