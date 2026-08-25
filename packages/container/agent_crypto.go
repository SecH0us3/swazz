// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
)

// loadPrivateKey loads an ed25519 private key or seed from a file path or raw hex/base64 string.
func loadPrivateKey(keyArg string) (ed25519.PrivateKey, error) {
	var keyStr string
	if _, err := os.Stat(keyArg); err == nil { // #nosec G304 G703
		data, err := os.ReadFile(keyArg) // #nosec G304 G703
		if err != nil {
			return nil, fmt.Errorf("failed to read key file %s: %w", keyArg, err)
		}
		keyStr = strings.TrimSpace(string(data))
	} else {
		keyStr = strings.TrimSpace(keyArg)
	}

	keyBytes, err := hex.DecodeString(keyStr)
	if err != nil {
		// Fallback to base64 decoding if hex decode fails
		var b64Err error
		keyBytes, b64Err = base64.StdEncoding.DecodeString(keyStr)
		if b64Err != nil {
			keyBytes, b64Err = base64.RawStdEncoding.DecodeString(keyStr)
			if b64Err != nil {
				return nil, fmt.Errorf("failed to decode private key (hex or base64): %w", err)
			}
		}
	}

	if len(keyBytes) == ed25519.SeedSize {
		return ed25519.NewKeyFromSeed(keyBytes), nil
	}

	if len(keyBytes) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("invalid private key size: expected %d (seed) or %d (private key) bytes, got %d", ed25519.SeedSize, ed25519.PrivateKeySize, len(keyBytes))
	}

	return ed25519.PrivateKey(keyBytes), nil
}

// signChallenge signs a challenge nonce string with an ed25519 private key and returns the hex-encoded signature.
func signChallenge(privKey ed25519.PrivateKey, nonce string) string {
	signatureBytes := ed25519.Sign(privKey, []byte(nonce))
	return hex.EncodeToString(signatureBytes)
}
