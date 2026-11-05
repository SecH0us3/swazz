// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz

package safenet

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
)

func TestTruncate(t *testing.T) {
	assert.Equal(t, "abc", Truncate("abc", 10))
	assert.Equal(t, "ab", Truncate("abc", 2))
	assert.Equal(t, "", Truncate("abc", 0))
	assert.Equal(t, "", Truncate("abc", -1))
	// "я" is two bytes: a cut inside it drops it whole.
	assert.Equal(t, "a", Truncate("aяb", 2))
	assert.Equal(t, "aя", Truncate("aяb", 3))
}

func TestReadErrorBody(t *testing.T) {
	assert.Equal(t, "", ReadErrorBody(strings.NewReader("")))
	assert.Equal(t, `{"error":"bad"}`, ReadErrorBody(strings.NewReader("  {\"error\":\"bad\"}\n")))

	long := strings.NewReader(strings.Repeat("x", 3*MaxErrorBodyBytes))
	assert.Len(t, ReadErrorBody(long), MaxErrorBodyBytes)
	assert.Equal(t, 2*MaxErrorBodyBytes-utf8.UTFMax, long.Len(), "the rest of the body is not read")

	// Two-byte characters straddling the cap: the result is cut on a character boundary.
	got := ReadErrorBody(strings.NewReader("x" + strings.Repeat("я", MaxErrorBodyBytes)))
	assert.True(t, utf8.ValidString(got))
	assert.LessOrEqual(t, len(got), MaxErrorBodyBytes)
	assert.GreaterOrEqual(t, len(got), MaxErrorBodyBytes-1)
}

func TestTruncate_InvalidUTF8BacksOffAtMostOneCharacter(t *testing.T) {
	// A run of continuation bytes is not one character: the cut backs off at most UTFMax-1 bytes
	// instead of walking back to the start of the string.
	s := "ab" + strings.Repeat("\x80", 100)
	got := Truncate(s, 50)
	assert.GreaterOrEqual(t, len(got), 50-(utf8.UTFMax-1))
	assert.LessOrEqual(t, len(got), 50)
}

func TestReadErrorBody_ReplacesControlCharacters(t *testing.T) {
	got := ReadErrorBody(strings.NewReader("bad\r\nINFO forged line\x1b[31mred\x00end\n"))
	assert.Equal(t, "bad  INFO forged line [31mred end", got)
	for _, r := range got {
		assert.False(t, r < 0x20 || r == 0x7f, "control character %q left in %q", r, got)
	}
}
