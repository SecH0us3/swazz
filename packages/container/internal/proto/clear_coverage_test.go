// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package proto

import "testing"

func TestClearMethodDescriptors(t *testing.T) {
	methodInputDesc.Store("/svc/Method", struct{}{})
	methodOutputDesc.Store("/svc/Method", struct{}{})

	ClearMethodDescriptors()

	if _, ok := methodInputDesc.Load("/svc/Method"); ok {
		t.Error("input descriptors should be cleared")
	}
	if _, ok := methodOutputDesc.Load("/svc/Method"); ok {
		t.Error("output descriptors should be cleared")
	}
}
