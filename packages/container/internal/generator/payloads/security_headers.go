package payloads

// HostInjection contains payloads for Host header manipulation.
var HostInjection = []string{
	"evil.com", "evil.com:443", "127.0.0.1", "169.254.169.254",
	"[::1]", "localhost", "0177.0.0.1", "0x7f.0.0.1",
}

// CORSOrigins contains payloads for testing CORS misconfiguration.
var CORSOrigins = []string{
	"https://evil.com", "null", "https://evil.com.target.com",
	"https://target.com.evil.com", "https://targetcom.evil.com",
}

// IPSpoofing contains payloads for IP spoofing header manipulation.
var IPSpoofing = []string{
	"127.0.0.1", "::1", "10.0.0.1", "192.168.1.1",
	"169.254.169.254", "0.0.0.0", "172.16.0.1",
}

// JWTManipulation contains payloads for Authorization header fuzzing.
var JWTManipulation = []string{
	"", "invalid", "null",
	"eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxIn0.", // alg:none
	"Bearer ", "Bearer null", "Bearer undefined",
}

// SecurityHeaderDef maps a payload category to header name → fuzz values.
type SecurityHeaderDef struct {
	Category string
	Headers  map[string][]string
}

// SecurityHeaderPayloads defines the complete set of security headers to fuzz.
var SecurityHeaderPayloads = []SecurityHeaderDef{
	{Category: CatHostInjection, Headers: map[string][]string{"Host": HostInjection}},
	{Category: CatCORSMisconfig, Headers: map[string][]string{"Origin": CORSOrigins}},
	{Category: CatIPSpoofing, Headers: map[string][]string{
		"X-Forwarded-For": IPSpoofing,
		"X-Real-IP":       IPSpoofing,
		"X-Original-URL":  IPSpoofing,
	}},
	{Category: CatJWTManipulation, Headers: map[string][]string{"Authorization": JWTManipulation}},
}
