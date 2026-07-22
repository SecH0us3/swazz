package generator

import (
	"net/mail"
	"net/url"
	"testing"
)

func TestWrapEmail(t *testing.T) {
	vector := "' OR '1'='1"
	wrapped := WrapEmail(vector)
	if len(wrapped) == 0 {
		t.Fatalf("expected non-empty wrapped email payloads")
	}
	valid := false
	for _, email := range wrapped {
		if _, err := mail.ParseAddress(email); err == nil {
			valid = true
			break
		}
	}
	if !valid {
		t.Errorf("expected at least one email payload to be valid RFC email, got %v", wrapped)
	}
}

func TestWrapURL(t *testing.T) {
	vector := "<script>alert(1)</script>"
	wrapped := WrapURL(vector)
	if len(wrapped) == 0 {
		t.Fatalf("expected non-empty wrapped URL payloads")
	}
	for _, uStr := range wrapped {
		if _, err := url.Parse(uStr); err != nil {
			t.Errorf("failed to parse wrapped URL %s: %v", uStr, err)
		}
	}
}

func TestWrapDateTime(t *testing.T) {
	vector := "' OR '1'='1"
	wrapped := WrapDateTime(vector)
	if len(wrapped) == 0 {
		t.Fatalf("expected non-empty wrapped date-time payloads")
	}
}

func TestWrapUUID(t *testing.T) {
	vector := "' OR 1=1"
	wrapped := WrapUUID(vector)
	if len(wrapped) == 0 {
		t.Fatalf("expected non-empty wrapped UUID payloads")
	}
}

func TestWrapPhone(t *testing.T) {
	vector := "12345"
	wrapped := WrapPhone(vector)
	if len(wrapped) == 0 {
		t.Fatalf("expected non-empty wrapped phone payloads")
	}
}

func BenchmarkWrapEmail(b *testing.B) {
	vector := "' OR '1'='1"
	for i := 0; i < b.N; i++ {
		_ = WrapEmail(vector)
	}
}
