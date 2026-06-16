package main

import (
	"crypto/ed25519"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadPrivateKey(t *testing.T) {
	// Generate a valid key
	_, priv, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	validHex := hex.EncodeToString(priv)

	// Test case 1: Load directly from hex string
	loaded, err := loadPrivateKey(validHex)
	if err != nil {
		t.Errorf("expected no error loading valid hex, got: %v", err)
	}
	if loaded == nil || hex.EncodeToString(loaded) != validHex {
		t.Errorf("loaded key does not match original")
	}

	// Test case 2: Load from file containing hex
	tmpDir, err := os.MkdirTemp("", "swazz-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	keyFile := filepath.Join(tmpDir, "test.key")
	if err := os.WriteFile(keyFile, []byte(validHex+"\n"), 0600); err != nil {
		t.Fatalf("failed to write key file: %v", err)
	}

	loadedFile, err := loadPrivateKey(keyFile)
	if err != nil {
		t.Errorf("expected no error loading from file, got: %v", err)
	}
	if loadedFile == nil || hex.EncodeToString(loadedFile) != validHex {
		t.Errorf("key loaded from file does not match")
	}

	// Test case 3: Invalid hex characters
	_, err = loadPrivateKey("invalidhexcharacters")
	if err == nil {
		t.Error("expected error for invalid hex, got nil")
	}

	// Test case 4: Invalid key size
	_, err = loadPrivateKey(hex.EncodeToString([]byte("shortkey")))
	if err == nil {
		t.Error("expected error for invalid key size, got nil")
	}
}
