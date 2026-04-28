package generator

import (
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestIntRange(t *testing.T) {
	for i := 0; i < 100; i++ {
		val := IntRange(10, 20)
		if val < 10 || val > 20 {
			t.Errorf("IntRange(10, 20) generated out-of-bounds value: %d", val)
		}
	}

	// Edge case: min == max
	val := IntRange(5, 5)
	if val != 5 {
		t.Errorf("IntRange(5, 5) expected 5, got %d", val)
	}

	// Edge case: min > max (this actually panics in Go's math/rand/v2 IntN if max-min+1 <= 0,
	// so we'll skip this unless IntRange explicitly handles it)
}

func TestFloatRange(t *testing.T) {
	for i := 0; i < 100; i++ {
		val := FloatRange(1.5, 5.5)
		if val < 1.5 || val > 5.5 {
			t.Errorf("FloatRange(1.5, 5.5) generated out-of-bounds value: %f", val)
		}
	}
}

func TestRandomString(t *testing.T) {
	for i := 0; i < 50; i++ {
		str := RandomString(10)
		if len(str) != 10 {
			t.Errorf("RandomString(10) generated string of length %d", len(str))
		}
		
		matched, _ := regexp.MatchString("^[a-zA-Z0-9]+$", str)
		if !matched {
			t.Errorf("RandomString contains invalid characters: %s", str)
		}
	}
}

func TestRandomDate(t *testing.T) {
	for i := 0; i < 50; i++ {
		d := RandomDate()
		year := d.Year()
		if year < 2020 || year > time.Now().UTC().Year() {
			t.Errorf("RandomDate() year out of reasonable bounds (2020-Now): %d", year)
		}
	}
}

func TestFullName(t *testing.T) {
	for i := 0; i < 50; i++ {
		name := FullName()
		parts := strings.Split(name, " ")
		if len(parts) != 2 {
			t.Errorf("FullName() did not generate exactly two parts: %s", name)
		}
	}
}

func TestHashStr(t *testing.T) {
	h1 := HashStr("hello world")
	h2 := HashStr("hello world")
	if h1 != h2 {
		t.Errorf("HashStr is not deterministic: %d != %d", h1, h2)
	}

	h3 := HashStr("hello world!")
	if h1 == h3 {
		t.Errorf("HashStr collision or too weak: %d == %d", h1, h3)
	}
}
