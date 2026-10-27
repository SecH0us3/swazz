// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"bytes"
	"fmt"
	"net/http"
	"swazz-engine/internal/swagger"
	"sync"
)

// AnalysisInput represents the input payload and response metadata used for body analysis.
type AnalysisInput struct {
	SentPayload     any
	ResponseBody    []byte
	ResponseHeaders http.Header
	Duration        int64
	Profile         swagger.FuzzingProfile
	Endpoint        string
	Method          string
	ResponseSize    int64
	BaselineSize    int64
	SizeMultiplier  float64
	BaselineTimeMs  int64
	TimeThresholdMs int
	Settings        swagger.Settings

	// Views derived from the fields above, computed on first use and shared by every analyzer
	// of one Analyze call. An input belongs to one response and one goroutine: build a new one
	// per response rather than reusing or sharing it.
	lowered     *[]byte // from loweredPool; returned by release
	loweredDone bool
	sent        []string
	sentDone    bool
	payloadStr  string
	payloadDone bool
}

// lowerBody returns ResponseBody with ASCII letters lowercased, index for index. Only ASCII is
// folded, so a lowercase ASCII needle is found in it exactly where containsFoldASCII would find
// it. The bytes are valid until release: do not keep them.
func (in *AnalysisInput) lowerBody() []byte {
	if !in.loweredDone {
		in.lowered = lowerASCIIInto(getLoweredBuf(len(in.ResponseBody)), in.ResponseBody)
		in.loweredDone = true
	}
	return *in.lowered
}

// release returns the pooled views to their pool. The input stays usable: a later call
// computes them again.
func (in *AnalysisInput) release() {
	if in.lowered != nil {
		putLoweredBuf(in.lowered)
		in.lowered = nil
	}
	in.loweredDone = false
}

// loweredPool holds the buffers lowerBody lowercases bodies into, so analyzing a response does
// not leave a body-sized copy behind for the garbage collector.
var loweredPool = sync.Pool{New: func() any { return new([]byte) }}

// maxPooledLowered is the largest buffer kept for reuse; a rare huge body is not held onto.
const maxPooledLowered = 1 << 20

func getLoweredBuf(n int) *[]byte {
	buf := loweredPool.Get().(*[]byte)
	if cap(*buf) < n {
		*buf = make([]byte, n)
	}
	*buf = (*buf)[:n]
	return buf
}

func putLoweredBuf(buf *[]byte) {
	if cap(*buf) > maxPooledLowered {
		return
	}
	loweredPool.Put(buf)
}

// hasUnicodeFoldRunes reports whether the body holds a rune that Go's (?i) folds onto an ASCII
// letter: U+017F LATIN SMALL LETTER LONG S (s) or U+212A KELVIN SIGN (k). The ASCII-only fast
// paths cannot see those spellings, so callers fall back to the plain regex when it is true.
func (in *AnalysisInput) hasUnicodeFoldRunes() bool {
	return bytes.Contains(in.ResponseBody, longS) || bytes.Contains(in.ResponseBody, kelvinSign)
}

var (
	longS      = []byte("\u017f")
	kelvinSign = []byte("\u212a")
)

// sentStrings returns the string leaves of SentPayload (see extractStrings).
func (in *AnalysisInput) sentStrings() []string {
	if !in.sentDone {
		in.sent = extractStrings(in.SentPayload)
		in.sentDone = true
	}
	return in.sent
}

// payloadText returns SentPayload formatted with %v, map keys included.
func (in *AnalysisInput) payloadText() string {
	if !in.payloadDone {
		in.payloadStr = fmt.Sprintf("%v", in.SentPayload)
		in.payloadDone = true
	}
	return in.payloadStr
}

// ResponseAnalyzer is the interface implemented by each specific vulnerability scanner.
type ResponseAnalyzer interface {
	Analyze(input *AnalysisInput) []swagger.AnalysisFinding
}
