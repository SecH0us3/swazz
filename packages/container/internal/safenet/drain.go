// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package safenet

import "io"

// MaxDrainBytes is how much of a target's response body is read only to keep its connection
// reusable.
const MaxDrainBytes = 1 << 20

// DrainBody reads and discards what is left of a response body, so its connection can be reused,
// but no more than limit bytes: the target controls the body, and an endless one would otherwise
// be read until the request times out. It returns how many bytes it read, at most limit+1; past
// limit the body is left unread and closing it closes its connection.
//
// It bounds the bytes read, not the time: a body that trickles in is still read until the
// request's own deadline.
func DrainBody(body io.Reader, limit int64) int64 {
	if limit < 0 {
		limit = 0
	}
	// One byte past the limit, so a body of exactly limit bytes is read to its EOF and its
	// connection kept.
	n, _ := io.Copy(io.Discard, io.LimitReader(body, limit+1))
	return n
}
