package payloads

import (
	"strings"
	"testing"
)

func TestRandomPayloads(t *testing.T) {
	// 1. UUID
	uuidStr := UUID()
	if len(uuidStr) != 36 {
		t.Errorf("expected UUID length 36, got %d", len(uuidStr))
	}

	// 2. Word & Words
	w := Word()
	if len(w) == 0 {
		t.Error("expected non-empty word")
	}
	ws := Words(3)
	if len(strings.Split(ws, " ")) != 3 {
		t.Errorf("expected 3 words, got: %s", ws)
	}

	// 3. Email
	emailStr := Email()
	if !strings.Contains(emailStr, "@") || !strings.Contains(emailStr, ".") {
		t.Errorf("invalid email format generated: %s", emailStr)
	}

	// 4. IPv4
	ipStr := IPv4()
	if len(strings.Split(ipStr, ".")) != 4 {
		t.Errorf("invalid IPv4 generated: %s", ipStr)
	}

	// 5. URI
	uriStr := URI()
	if !strings.HasPrefix(uriStr, "https://") {
		t.Errorf("expected https prefix for URI, got %s", uriStr)
	}

	// 5b. FloatRange & RandomDate
	fVal := FloatRange(1.5, 9.5)
	if fVal < 1.5 || fVal >= 9.5 {
		t.Errorf("FloatRange returned value out of bounds: %f", fVal)
	}
	rDate := RandomDate()
	if rDate.Year() < 2020 {
		t.Errorf("expected RandomDate to be after 2020, got: %v", rDate)
	}

	// 6. HashBytes
	b := []byte("hello world")
	h1 := HashBytes(b)
	h2 := HashStr("hello world")
	if h1 != h2 {
		t.Errorf("expected HashBytes and HashStr to match for same string, got %d and %d", h1, h2)
	}

	// 7. FullName
	fn := FullName()
	if len(strings.Split(fn, " ")) != 2 {
		t.Errorf("expected full name to have space-separated first and last name, got %s", fn)
	}

	// 8. RandomString
	rs := RandomString(10)
	if len(rs) != 10 {
		t.Errorf("expected random string of length 10, got length %d", len(rs))
	}
}
