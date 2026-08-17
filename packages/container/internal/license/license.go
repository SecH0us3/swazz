// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package license

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

var (
	ErrInvalidTokenFormat = errors.New("license: invalid token format")
	ErrInvalidSignature   = errors.New("license: invalid signature")
	ErrLicenseExpired     = errors.New("license: expired license")
	ErrNoPublicKey        = errors.New("license: public key not configured")
)

// DefaultPublicKeyHex is the embedded default Ed25519 public key for Swazz Enterprise license verification.
// Can be overridden via SWAZZ_LICENSE_PUBKEY environment variable.
var DefaultPublicKeyHex = "a84976722d515a815a4a5ebcebf7ffecaa2d9735d10ea354ef3ddc45dfba8314"

type License struct {
	Company        string    `json:"company"`
	ExpiresAt      time.Time `json:"expires_at"`
	Features       []string  `json:"features"`
	MaxUsers       int       `json:"max_users,omitempty"`
	MaxConcurrency int       `json:"max_concurrency,omitempty"`
}

func (l *License) HasFeature(feature string) bool {
	if l == nil {
		return false
	}
	if !l.ExpiresAt.IsZero() && time.Now().After(l.ExpiresAt) {
		return false
	}
	featureLower := strings.ToLower(feature)
	for _, f := range l.Features {
		fLower := strings.ToLower(f)
		if fLower == "*" || fLower == "all" || fLower == featureLower {
			return true
		}
	}
	return false
}

// DaysRemaining returns the number of whole days remaining until the license expires.
// Returns -1 if the license does not expire, or 0 if it is already expired.
func (l *License) DaysRemaining() int {
	if l == nil || l.ExpiresAt.IsZero() {
		return -1
	}
	remaining := time.Until(l.ExpiresAt)
	if remaining <= 0 {
		return 0
	}
	days := int((remaining + 24*time.Hour - time.Nanosecond) / (24 * time.Hour))
	return days
}

// IsExpiringSoon returns true if the license expires within thresholdDays (and is not already expired).
func (l *License) IsExpiringSoon(thresholdDays int) bool {
	if l == nil || l.ExpiresAt.IsZero() {
		return false
	}
	remaining := time.Until(l.ExpiresAt)
	if remaining <= 0 {
		return false
	}
	days := l.DaysRemaining()
	return days <= thresholdDays
}

type Verifier struct {
	PublicKey ed25519.PublicKey
}

func NewVerifier(pubKeyInput string) (*Verifier, error) {
	if pubKeyInput == "" {
		pubKeyInput = os.Getenv("SWAZZ_LICENSE_PUBKEY")
	}
	if pubKeyInput == "" {
		pubKeyInput = DefaultPublicKeyHex
	}

	var keyBytes []byte
	var err error

	// Try hex decoding first
	keyBytes, err = hex.DecodeString(pubKeyInput)
	if err != nil || len(keyBytes) != ed25519.PublicKeySize {
		// Fallback to base64 decoding
		keyBytes, err = base64.RawURLEncoding.DecodeString(pubKeyInput)
		if err != nil {
			keyBytes, err = base64.StdEncoding.DecodeString(pubKeyInput)
		}
	}

	if len(keyBytes) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("%w: public key must be 32 bytes (got %d)", ErrNoPublicKey, len(keyBytes))
	}

	return &Verifier{
		PublicKey: ed25519.PublicKey(keyBytes),
	}, nil
}

func (v *Verifier) VerifyToken(tokenStr string) (*License, error) {
	tokenStr = strings.TrimSpace(tokenStr)
	if idx := strings.Index(tokenStr, "SWAZZ_LICENSE_KEY:"); idx != -1 {
		tokenStr = strings.TrimSpace(tokenStr[idx+len("SWAZZ_LICENSE_KEY:"):])
	}
	for _, line := range strings.Split(tokenStr, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "eyJ") && len(strings.Split(line, ".")) == 3 {
			tokenStr = line
			break
		}
	}
	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return nil, ErrInvalidTokenFormat
	}

	headerB64, payloadB64, sigB64 := parts[0], parts[1], parts[2]

	sigBytes, err := base64Decode(sigB64)
	if err != nil || len(sigBytes) != ed25519.SignatureSize {
		return nil, ErrInvalidSignature
	}

	signedMessage := []byte(headerB64 + "." + payloadB64)
	if !ed25519.Verify(v.PublicKey, signedMessage, sigBytes) {
		return nil, ErrInvalidSignature
	}

	payloadBytes, err := base64Decode(payloadB64)
	if err != nil {
		return nil, ErrInvalidTokenFormat
	}

	var lic License
	if err := json.Unmarshal(payloadBytes, &lic); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidTokenFormat, err)
	}

	if !lic.ExpiresAt.IsZero() && time.Now().After(lic.ExpiresAt) {
		return &lic, ErrLicenseExpired
	}

	return &lic, nil
}

func GenerateToken(privKey ed25519.PrivateKey, lic *License) (string, error) {
	header := map[string]string{
		"alg": "EdDSA",
		"typ": "JWT",
	}
	headerBytes, err := json.Marshal(header)
	if err != nil {
		return "", err
	}
	headerB64 := base64.RawURLEncoding.EncodeToString(headerBytes)

	payloadBytes, err := json.Marshal(lic)
	if err != nil {
		return "", err
	}
	payloadB64 := base64.RawURLEncoding.EncodeToString(payloadBytes)

	signedMessage := []byte(headerB64 + "." + payloadB64)
	sigBytes := ed25519.Sign(privKey, signedMessage)
	sigB64 := base64.RawURLEncoding.EncodeToString(sigBytes)

	return fmt.Sprintf("%s.%s.%s", headerB64, payloadB64, sigB64), nil
}

func base64Decode(str string) ([]byte, error) {
	if b, err := base64.RawURLEncoding.DecodeString(str); err == nil {
		return b, nil
	}
	if b, err := base64.URLEncoding.DecodeString(str); err == nil {
		return b, nil
	}
	return base64.StdEncoding.DecodeString(str)
}
