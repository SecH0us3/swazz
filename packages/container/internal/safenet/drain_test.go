// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz

package safenet

import (
	"io"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

// endless is a body that never ends.
type endless struct{ read int64 }

func (e *endless) Read(p []byte) (int, error) {
	e.read += int64(len(p))
	return len(p), nil
}

func TestDrainBody(t *testing.T) {
	assert.EqualValues(t, 0, DrainBody(strings.NewReader(""), 10))
	assert.EqualValues(t, 5, DrainBody(strings.NewReader("hello"), 10))

	exact := strings.NewReader("0123456789")
	assert.EqualValues(t, 10, DrainBody(exact, 10))
	_, err := exact.Read(make([]byte, 1))
	assert.Equal(t, io.EOF, err, "a body of exactly the limit is read to its end")

	long := strings.NewReader("0123456789abc")
	assert.EqualValues(t, 11, DrainBody(long, 10), "past the limit it stops one byte over")
	assert.Equal(t, 2, long.Len(), "and leaves the rest unread")

	e := &endless{}
	assert.EqualValues(t, MaxDrainBytes+1, DrainBody(e, MaxDrainBytes))
	assert.LessOrEqual(t, e.read, int64(MaxDrainBytes+32*1024), "an endless body is not read on")

	assert.EqualValues(t, 1, DrainBody(strings.NewReader("abc"), -5), "a negative limit counts as zero")
}
