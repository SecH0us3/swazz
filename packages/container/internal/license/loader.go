// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package license

import (
	"os"
)

// LoadAndVerify attempts to load and verify a license key.
// If keyStr is empty, it checks the SWAZZ_LICENSE_KEY environment variable.
// If still empty, it returns (nil, nil) indicating community mode.
// Otherwise, it verifies the token using the default public key configuration.
func LoadAndVerify(keyStr string) (*License, error) {
	if keyStr == "" {
		keyStr = os.Getenv("SWAZZ_LICENSE_KEY")
	}
	if keyStr == "" {
		return nil, nil
	}

	verifier, err := NewVerifier("")
	if err != nil {
		return nil, err
	}

	return verifier.VerifyToken(keyStr)
}
