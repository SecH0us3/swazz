package generator

import (
	"net/mail"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
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
	for _, dt := range wrapped {
		if !strings.HasPrefix(dt, "2026-01-01T12:00:00") {
			t.Errorf("expected valid ISO 8601 prefix, got %s", dt)
		}
	}
}

func TestWrapUUID(t *testing.T) {
	vector := "' OR 1=1"
	wrapped := WrapUUID(vector)
	if len(wrapped) == 0 {
		t.Fatalf("expected non-empty wrapped UUID payloads")
	}
	for _, uStr := range wrapped {
		parts := strings.Split(uStr, "#")
		if _, err := uuid.Parse(parts[0]); err != nil {
			t.Errorf("expected valid UUID base, got %s: %v", parts[0], err)
		}
	}
}

func TestWrapPhone(t *testing.T) {
	vector := "12345"
	wrapped := WrapPhone(vector)
	if len(wrapped) == 0 {
		t.Fatalf("expected non-empty wrapped phone payloads")
	}
	for _, p := range wrapped {
		if !strings.HasPrefix(p, "+") {
			t.Errorf("expected E.164 phone prefix (+), got %s", p)
		}
	}
}

func BenchmarkWrapEmail(b *testing.B) {
	vector := "' OR '1'='1"
	for i := 0; i < b.N; i++ {
		_ = WrapEmail(vector)
	}
}
