package remediation

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestGitPatcher_LocalGitOperations(t *testing.T) {
	// Create a temp directory for a fake repo
	tempDir, err := os.MkdirTemp("", "git-repo-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Initialize git repo
	runGit(t, tempDir, "init")
	runGit(t, tempDir, "config", "user.email", "test@example.com")
	runGit(t, tempDir, "config", "user.name", "Test User")
	runGit(t, tempDir, "config", "commit.gpgsign", "false")
	runGit(t, tempDir, "branch", "-M", "master")

	// Create a file and commit to establish 'master' branch
	testFile := filepath.Join(tempDir, "test.txt")
	err = os.WriteFile(testFile, []byte("initial content\n"), 0644)
	if err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	runGit(t, tempDir, "add", ".")
	runGit(t, tempDir, "commit", "-m", "initial commit")

	// Create patch content for test.txt
	patchContent := `--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-initial content
+patched content
`

	findingID := "test-123"
	worktreePath := tempDir + "-fix-" + findingID
	branchName := "swazz/fix-" + findingID

	// Test worktree creation
	worktreeCmd := exec.Command("git", "worktree", "add", "-b", branchName, worktreePath, "master")
	worktreeCmd.Dir = tempDir
	if out, err := worktreeCmd.CombinedOutput(); err != nil {
		t.Fatalf("failed to create worktree: %v, output: %s", err, out)
	}
	defer func() {
		cleanupCmd := exec.Command("git", "worktree", "remove", "--force", worktreePath)
		cleanupCmd.Dir = tempDir
		_ = cleanupCmd.Run()
		os.RemoveAll(worktreePath)
	}()

	// Write patch
	patchFile, err := os.CreateTemp("", "patch-*.diff")
	if err != nil {
		t.Fatalf("failed to create temp patch file: %v", err)
	}
	defer os.Remove(patchFile.Name())

	_, err = patchFile.WriteString(patchContent)
	if err != nil {
		t.Fatalf("failed to write patch file: %v", err)
	}
	patchFile.Close()

	// Apply patch
	applyCmd := exec.Command("git", "apply", patchFile.Name())
	applyCmd.Dir = worktreePath
	if out, err := applyCmd.CombinedOutput(); err != nil {
		t.Fatalf("failed to apply patch: %v, output: %s", err, out)
	}

	// Verify patch applied
	patchedContent, err := os.ReadFile(filepath.Join(worktreePath, "test.txt"))
	if err != nil {
		t.Fatalf("failed to read patched file: %v", err)
	}
	if string(patchedContent) != "patched content\n" {
		t.Errorf("patch was not applied correctly, got: %q", string(patchedContent))
	}
}

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v failed: %v\nOutput: %s", args, err, out)
	}
}
