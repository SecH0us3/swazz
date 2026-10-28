// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"bytes"
	"fmt"
	"net/http"
	"strings"
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
	// of one Analyze call. An input belongs to one response and one goroutine at a time; use
	// AcquireInput and ReleaseInput to pool instances across responses.
	lowered     *[]byte // from loweredPool; returned by release
	loweredDone bool
	sent        []string
	sentDone    bool
	payloadStr  string
	payloadDone bool
	bigrams      *bigramIndex // from bigramPool; returned by release
	bigramsDone  bool
	needleChecks int
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
	if in.bigrams != nil {
		bigramPool.Put(in.bigrams)
		in.bigrams = nil
	}
	in.bigramsDone = false
	in.needleChecks = 0
}

var analysisInputPool = sync.Pool{
	New: func() any {
		return new(AnalysisInput)
	},
}

// AcquireInput retrieves a pooled AnalysisInput.
func AcquireInput() *AnalysisInput {
	return analysisInputPool.Get().(*AnalysisInput)
}

// ReleaseInput cleans up internal views and returns in to the pool.
func ReleaseInput(in *AnalysisInput) {
	if in == nil {
		return
	}
	in.release()
	*in = AnalysisInput{}
	analysisInputPool.Put(in)
}

// bigramIndex is a 65,536-bit set (8 KiB) tracking all 2-byte bigrams present in the response body.
type bigramIndex [1024]uint64

func (bg *bigramIndex) set(a, b byte) {
	pair := uint16(a)<<8 | uint16(b)
	bg[pair>>6] |= uint64(1) << (pair & 63)
}

func (bg *bigramIndex) has(a, b byte) bool {
	pair := uint16(a)<<8 | uint16(b)
	return bg[pair>>6]&(uint64(1)<<(pair&63)) != 0
}

var bigramPool = sync.Pool{
	New: func() any {
		return new(bigramIndex)
	},
}

// bodyBigrams populates and returns the 2-byte bigram index of the lowercased response body.
func (in *AnalysisInput) bodyBigrams() *bigramIndex {
	if !in.bigramsDone {
		bg := bigramPool.Get().(*bigramIndex)
		*bg = bigramIndex{}
		body := in.lowerBody()
		limit := len(body) - 1
		for i := 0; i < limit; i++ {
			bg.set(body[i], body[i+1])
		}
		in.bigrams = bg
		in.bigramsDone = true
	}
	return in.bigrams
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

// payloadContains reports whether any string value or map key in SentPayload contains any of needles.
// It walks standard JSON payload types (string, maps, slices) without allocating, inspecting
// individual keys and string leaves rather than matching across fmt.Sprintf("%v") formatting
// delimiters; for unrecognized types it falls back to payloadText().
func (in *AnalysisInput) payloadContains(needles ...string) bool {
	if in == nil || in.SentPayload == nil || len(needles) == 0 {
		return false
	}
	return valContains(in.SentPayload, needles, in)
}

func valContains(val any, needles []string, in *AnalysisInput) bool {
	switch v := val.(type) {
	case nil:
		return false
	case string:
		for _, n := range needles {
			if strings.Contains(v, n) {
				return true
			}
		}
		return false
	case map[string]any:
		for k, item := range v {
			for _, n := range needles {
				if strings.Contains(k, n) {
					return true
				}
			}
			if valContains(item, needles, in) {
				return true
			}
		}
		return false
	case map[string]string:
		for k, s := range v {
			for _, n := range needles {
				if strings.Contains(k, n) || strings.Contains(s, n) {
					return true
				}
			}
		}
		return false
	case map[any]any:
		for k, item := range v {
			if valContains(k, needles, in) || valContains(item, needles, in) {
				return true
			}
		}
		return false
	case []any:
		for _, item := range v {
			if valContains(item, needles, in) {
				return true
			}
		}
		return false
	case []string:
		for _, s := range v {
			for _, n := range needles {
				if strings.Contains(s, n) {
					return true
				}
			}
		}
		return false
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64, bool:
		return false
	default:
		text := in.payloadText()
		for _, n := range needles {
			if strings.Contains(text, n) {
				return true
			}
		}
		return false
	}
}

// ResponseAnalyzer is the interface implemented by each specific vulnerability scanner.
type ResponseAnalyzer interface {
	Analyze(input *AnalysisInput) []swagger.AnalysisFinding
}
