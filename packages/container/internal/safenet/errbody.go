// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package safenet

import (
	"bytes"
	"io"
	"unicode/utf8"
)

// MaxErrorBodyBytes is how much of an error response's body goes into an error message.
const MaxErrorBodyBytes = 4096

// ReadErrorBody returns the start of an error response's body for an error message: at most
// MaxErrorBodyBytes, trimmed, and not ending mid-character. The sender controls the body, so no
// more of it is read than that.
func ReadErrorBody(body io.Reader) string {
	b, _ := io.ReadAll(io.LimitReader(body, MaxErrorBodyBytes+utf8.UTFMax))
	return Truncate(string(bytes.TrimSpace(b)), MaxErrorBodyBytes)
}

// Truncate cuts s to at most n bytes without splitting a UTF-8 character.
func Truncate(s string, n int) string {
	if n < 0 {
		n = 0
	}
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}
