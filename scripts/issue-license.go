// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)

// issue-license.go generates a signed Swazz Enterprise License Key (JWT with EdDSA).
//
// The generated token is verified by packages/container/internal/license.Verifier
// using Ed25519 public key signature verification.
//
// Usage:
//   go run scripts/issue-license.go \
//     -key swazz_master_private.pem \
//     -company "Acme Corporation" \
//     -days 365 \
//     -features "sso,rbac,compliance_reports,ai_remediation_pro" \
//     -max-users 50

package main

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"
)

// License mirrors the License struct in packages/container/internal/license/license.go.
// Fields must match exactly for VerifyToken() to deserialize correctly.
type License struct {
	Company        string    `json:"company"`
	ExpiresAt      time.Time `json:"expires_at"`
	Features       []string  `json:"features"`
	MaxUsers       int       `json:"max_users,omitempty"`
	MaxConcurrency int       `json:"max_concurrency,omitempty"`
}

func main() {
	keyFileFlag := flag.String("key", "", "Path to Ed25519 PEM private key file (required)")
	companyFlag := flag.String("company", "", "Company / organization name (required)")
	daysFlag := flag.Int("days", 365, "License validity duration in days")
	featuresFlag := flag.String("features", "*", "Comma-separated feature list (use '*' for unlimited)")
	maxUsersFlag := flag.Int("max-users", 0, "Maximum users (0 = unlimited)")
	maxConcurrencyFlag := flag.Int("max-concurrency", 0, "Maximum concurrency ceiling (0 = free default of 5)")
	tokenOnlyFlag := flag.Bool("token-only", false, "Output raw license token string only (useful for CI/automation)")
	outFileFlag := flag.String("out", "", "Path to write license token string to file")

	flag.Parse()

	// --- Validate required flags ---
	if *keyFileFlag == "" {
		fmt.Fprintln(os.Stderr, "Error: -key flag is required (path to Ed25519 PEM private key)")
		fmt.Fprintln(os.Stderr, "")
		fmt.Fprintln(os.Stderr, "Generate a keypair first:")
		fmt.Fprintln(os.Stderr, "  openssl genpkey -algorithm ed25519 -out swazz_master_private.pem")
		fmt.Fprintln(os.Stderr, "  openssl pkey -in swazz_master_private.pem -pubout -out swazz_master_public.pem")
		os.Exit(1)
	}
	if *companyFlag == "" {
		fmt.Fprintln(os.Stderr, "Error: -company flag is required")
		os.Exit(1)
	}

	// --- Load Ed25519 private key from PEM ---
	privKey, pubKey, err := loadEd25519PrivateKey(*keyFileFlag)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading private key: %v\n", err)
		os.Exit(1)
	}

	// --- Build license payload ---
	now := time.Now().UTC()
	exp := now.AddDate(0, 0, *daysFlag)

	features := parseFeatures(*featuresFlag)

	lic := &License{
		Company:        *companyFlag,
		ExpiresAt:      exp,
		Features:       features,
		MaxUsers:       *maxUsersFlag,
		MaxConcurrency: *maxConcurrencyFlag,
	}

	// --- Generate JWT token (EdDSA) matching GenerateToken() in license.go ---
	token, err := generateToken(privKey, lic)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error generating token: %v\n", err)
		os.Exit(1)
	}

	// --- Derive the public key hex for embedding ---
	pubKeyHex := hex.EncodeToString(pubKey)

	// --- Save to file if -out is specified ---
	if *outFileFlag != "" {
		if err := os.WriteFile(*outFileFlag, []byte(strings.TrimSpace(token)+"\n"), 0600); err != nil {
			fmt.Fprintf(os.Stderr, "Error writing token to file %s: %v\n", *outFileFlag, err)
			os.Exit(1)
		}
	}

	// --- Output ---
	if *tokenOnlyFlag {
		fmt.Println(token)
		return
	}

	fmt.Println("=========================================================")
	fmt.Println("🔑 SWAZZ ENTERPRISE LICENSE KEY GENERATED SUCCESSFULLY")
	fmt.Println("=========================================================")
	fmt.Printf("Company:           %s\n", lic.Company)
	fmt.Printf("Issued At:         %s\n", now.Format(time.RFC3339))
	fmt.Printf("Expires At:        %s (%d days)\n", exp.Format(time.RFC3339), *daysFlag)
	fmt.Printf("Features:          %s\n", strings.Join(lic.Features, ", "))
	if lic.MaxUsers > 0 {
		fmt.Printf("Max Users:         %d\n", lic.MaxUsers)
	} else {
		fmt.Printf("Max Users:         unlimited\n")
	}
	if lic.MaxConcurrency > 0 {
		fmt.Printf("Max Concurrency:   %d\n", lic.MaxConcurrency)
	} else {
		fmt.Printf("Max Concurrency:   free default (5)\n")
	}
	fmt.Println("---------------------------------------------------------")
	fmt.Println("SWAZZ_LICENSE_KEY:")
	fmt.Println(token)
	fmt.Println("---------------------------------------------------------")
	fmt.Println("Public Key (hex, for DefaultPublicKeyHex / SWAZZ_LICENSE_PUBKEY):")
	fmt.Println(pubKeyHex)
	if *outFileFlag != "" {
		fmt.Printf("Token saved to:    %s\n", *outFileFlag)
	}
	fmt.Println("=========================================================")
}

// loadEd25519PrivateKey reads a PEM file and extracts the Ed25519 private + public key.
func loadEd25519PrivateKey(path string) (ed25519.PrivateKey, ed25519.PublicKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, fmt.Errorf("reading key file: %w", err)
	}

	block, _ := pem.Decode(data)
	if block == nil {
		return nil, nil, fmt.Errorf("no PEM block found in %s (expected PKCS#8 PRIVATE KEY)", path)
	}

	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, nil, fmt.Errorf("parsing PKCS#8 private key: %w (ensure key was generated via openssl genpkey -algorithm ed25519)", err)
	}

	privKey, ok := key.(ed25519.PrivateKey)
	if !ok {
		return nil, nil, fmt.Errorf("key is not Ed25519 (got %T)", key)
	}

	pubKey := privKey.Public().(ed25519.PublicKey)
	return privKey, pubKey, nil
}

// generateToken creates a JWT-like token with EdDSA signature.
// This logic mirrors GenerateToken() in packages/container/internal/license/license.go exactly.
func generateToken(privKey ed25519.PrivateKey, lic *License) (string, error) {
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

func parseFeatures(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "*" {
		return []string{"*"}
	}
	parts := strings.Split(raw, ",")
	features := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			features = append(features, p)
		}
	}
	return features
}
