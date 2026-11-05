// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package safenet

import (
	"bytes"
	"io"
	"strings"
	"unicode"
	"unicode/utf8"
)

// MaxErrorBodyBytes is how much of an error response's body goes into an error message.
const MaxErrorBodyBytes = 4096

// ReadErrorBody returns the start of an error response's body for an error message: at most
// MaxErrorBodyBytes, trimmed, not ending mid-character, with control characters (CR, LF, ESC and
// the rest) replaced by spaces so the text cannot forge log lines or drive a terminal. The sender
// controls the body, so no more of it is read than that.
//
// Non-goals: it does not escape HTML or redact secrets the body may carry; callers that render
// the message as markup or forward it elsewhere still have to treat it as untrusted text.
func ReadErrorBody(body io.Reader) string {
	b, _ := io.ReadAll(io.LimitReader(body, MaxErrorBodyBytes+utf8.UTFMax))
	s := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, string(bytes.TrimSpace(b)))
	return Truncate(strings.TrimSpace(s), MaxErrorBodyBytes)
}

// Truncate cuts s to at most n bytes without splitting a UTF-8 character. On invalid UTF-8 it
// backs off at most utf8.UTFMax-1 bytes, so it never cuts more than a character's worth.
func Truncate(s string, n int) string {
	if n < 0 {
		n = 0
	}
	if len(s) <= n {
		return s
	}
	for i := 0; i < utf8.UTFMax-1 && n > 0 && !utf8.RuneStart(s[n]); i++ {
		n--
	}
	return s[:n]
}
