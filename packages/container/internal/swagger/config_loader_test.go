package swagger

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadWordlists(t *testing.T) {
	// Ensure wordlists directory exists for tests
	os.MkdirAll("wordlists", 0755)
	defer os.RemoveAll("wordlists")

	// Create test wordlists in the allowed directory
	list1Path := "list1.txt"
	list2Path := "list2.txt"
	
	list1Abs := filepath.Join("wordlists", list1Path)
	list2Abs := filepath.Join("wordlists", list2Path)

	err := os.WriteFile(list1Abs, []byte("admin\nroot\n \ntestuser\n"), 0644)
	if err != nil {
		t.Fatalf("failed to write list1: %v", err)
	}

	err = os.WriteFile(list2Abs, []byte("123456\npassword\n"), 0644)
	if err != nil {
		t.Fatalf("failed to write list2: %v", err)
	}

	config := &Config{
		WordlistFiles: map[string]string{
			"usernames": list1Path,
			"passwords": list2Path,
		},
		Dictionaries: map[string][]any{
			"usernames": {"defaultUser"},
		},
	}

	err = LoadWordlists(config)
	if err != nil {
		t.Fatalf("LoadWordlists returned error: %v", err)
	}

	// Verify usernames
	usernames, ok := config.Dictionaries["usernames"]
	if !ok {
		t.Fatalf("usernames category missing")
	}
	if len(usernames) != 4 {
		t.Errorf("expected 4 usernames, got %d", len(usernames))
	}
	if usernames[0] != "defaultUser" || usernames[1] != "admin" || usernames[2] != "root" || usernames[3] != "testuser" {
		t.Errorf("usernames contents incorrect: %v", usernames)
	}

	// Verify passwords
	passwords, ok := config.Dictionaries["passwords"]
	if !ok {
		t.Fatalf("passwords category missing")
	}
	if len(passwords) != 2 {
		t.Errorf("expected 2 passwords, got %d", len(passwords))
	}
	if passwords[0] != "123456" || passwords[1] != "password" {
		t.Errorf("passwords contents incorrect: %v", passwords)
	}
}

func TestLoadWordlists_FileNotFound(t *testing.T) {
	config := &Config{
		WordlistFiles: map[string]string{
			"missing": "nonexistent_file_path.txt",
		},
	}

	err := LoadWordlists(config)
	if err == nil {
		t.Errorf("expected error for nonexistent file, got nil")
	}
}

func TestLoadWordlists_NilWordlistFiles(t *testing.T) {
	config := &Config{}
	err := LoadWordlists(config)
	if err != nil {
		t.Errorf("expected no error for nil WordlistFiles, got %v", err)
	}
}
