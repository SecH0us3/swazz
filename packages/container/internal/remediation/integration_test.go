package remediation

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"swazz-engine/internal/ai"
	"swazz-engine/internal/analyzer"
)

func TestAI_Remediation_Integration(t *testing.T) {
	// 1. Create a temp directory for our project repo
	repoDir, err := os.MkdirTemp("", "integration-repo-*")
	if err != nil {
		t.Fatalf("failed to create temp repo dir: %v", err)
	}
	defer os.RemoveAll(repoDir)

	// Initialize git repo
	runGit(t, repoDir, "init")
	runGit(t, repoDir, "config", "user.email", "test@example.com")
	runGit(t, repoDir, "config", "user.name", "Test User")
	runGit(t, repoDir, "branch", "-M", "master")

	// 2. Create a vulnerable controller file in the repo
	controllerCode := `package main

import "github.com/gin-gonic/gin"

func main() {
	r := gin.Default()
	r.GET("/users/:id", func(c *gin.Context) {
		id := c.Param("id")
		// Vulnerable BOLA: returns user details without verifying owner!
		c.JSON(200, gin.H{"user_id": id, "email": "user@example.com"})
	})
}
`
	controllerFile := filepath.Join(repoDir, "controller.go")
	if err := os.WriteFile(controllerFile, []byte(controllerCode), 0644); err != nil {
		t.Fatalf("failed to write controller file: %v", err)
	}

	// Commit the controller file to establish git history
	runGit(t, repoDir, "add", ".")
	runGit(t, repoDir, "commit", "-m", "initial commit")

	// 3. Instantiate RepoIndexer and locate code context
	indexer := analyzer.NewRepoIndexer(repoDir)
	filePath, codeContext, err := indexer.FindHandlerContext("GET", "/users/:id")
	if err != nil {
		t.Fatalf("failed to find handler context: %v", err)
	}

	if filePath != "controller.go" {
		t.Errorf("expected filePath to be 'controller.go', got: %q", filePath)
	}

	if !strings.Contains(codeContext, "Vulnerable BOLA") {
		t.Errorf("expected codeContext to contain vulnerable BOLA comment, got:\n%s", codeContext)
	}

	// 4. Create a mock CLI Analyzer that acts as the LLM client
	// The mock CLI analyzer just echoes the unified patch we expect to standard output.
	expectedPatch := strings.ReplaceAll(`--- a/controller.go
+++ b/controller.go
@@ -7,6 +7,11 @@
 \tr.GET("/users/:id", func(c *gin.Context) {
 \t\tid := c.Param("id")
 \t\t// Vulnerable BOLA: returns user details without verifying owner!
-\t\tc.JSON(200, gin.H{"user_id": id, "email": "user@example.com"})
+\t\tcurrentUser := c.MustGet("currentUser").(string)
+\t\tif currentUser != id {
+\t\t\tc.JSON(403, gin.H{"error": "Forbidden"})
+\t\t\treturn
+\t\t}
+\t\tc.JSON(200, gin.H{"user_id": id, "email": "user@example.com"})
 \t})
 }
`, "\\t", "\t")

	// Build a temporary shell script/executable for the CLI analyzer
	cliStubDir, err := os.MkdirTemp("", "cli-analyzer-stub-*")
	if err != nil {
		t.Fatalf("failed to create cli stub dir: %v", err)
	}
	defer os.RemoveAll(cliStubDir)

	cliStubPath := filepath.Join(cliStubDir, "mock-analyzer")
	// On Unix we can write a simple shell script
	cliScriptContent := fmt.Sprintf("#!/bin/sh\ncat << 'EOF'\n%s\nEOF\n", expectedPatch)
	if err := os.WriteFile(cliStubPath, []byte(cliScriptContent), 0755); err != nil {
		t.Fatalf("failed to write mock analyzer script: %v", err)
	}

	// Instantiate CLIAnalyzer pointing to our mock analyzer executable
	analyzerCmdTemplate := cliStubPath + " {{prompt_file}}"
	aiClient := ai.NewCLIAnalyzer(analyzerCmdTemplate)

	// Call AI client to generate the proposed patch
	patchResult, err := aiClient.Analyze("swazz/bola-idor", codeContext, "Please fix this BOLA vulnerability.")
	if err != nil {
		t.Fatalf("AI analysis failed: %v", err)
	}

	// Trim whitespace to compare cleanly
	if strings.TrimSpace(patchResult) != strings.TrimSpace(expectedPatch) {
		t.Errorf("expected patch result:\n%s\ngot:\n%s", expectedPatch, patchResult)
	}

	// 5. Mock the Git CLI Provider (gh)
	// We stub the "gh" command by placing a mock "gh" executable in a directory on the PATH.
	mockPrUrl := "https://github.com/SecH0us3/swazz/pull/42"
	ghStubPath := filepath.Join(cliStubDir, "gh")
	ghScriptContent := fmt.Sprintf("#!/bin/sh\necho '%s'\n", mockPrUrl)
	if err := os.WriteFile(ghStubPath, []byte(ghScriptContent), 0755); err != nil {
		t.Fatalf("failed to write mock gh script: %v", err)
	}

	// Mock git config remote.origin.url to bypass pushes during the test, or mock "git push"
	// We can configure remote.origin.url to be a local path so "git push" succeeds locally!
	remoteRepoDir, err := os.MkdirTemp("", "remote-repo-*")
	if err != nil {
		t.Fatalf("failed to create remote repo dir: %v", err)
	}
	defer os.RemoveAll(remoteRepoDir)
	runGit(t, remoteRepoDir, "init", "--bare")

	runGit(t, repoDir, "remote", "add", "origin", remoteRepoDir)
	// Push master to the bare remote so origin/master ref exists, then set origin/HEAD
	runGit(t, repoDir, "push", "origin", "master")
	runGit(t, repoDir, "remote", "set-head", "origin", "master")

	// Prepend the stub directory to the system PATH so our custom "gh" is invoked
	oldPath := os.Getenv("PATH")
	os.Setenv("PATH", cliStubDir+string(os.PathListSeparator)+oldPath)
	defer os.Setenv("PATH", oldPath)

	// 6. Run GitPatcher to create branch, apply patch, and open PR
	patcher := NewGitPatcher()
	prUrl, err := patcher.CreateFixPR(repoDir, "finding-123", expectedPatch, "fix(security): resolve BOLA vulnerability", "This PR fixes the BOLA vulnerability detected by Swazz.")
	if err != nil {
		t.Fatalf("failed to create fix PR: %v", err)
	}

	if prUrl != mockPrUrl {
		t.Errorf("expected PR URL %q, got: %q", mockPrUrl, prUrl)
	}

	// 7. Verification: check that the branch was pushed and contains the patch!
	// We check out the created branch swazz/fix-finding-123 in the local repository
	runGit(t, repoDir, "fetch", "origin")
	runGit(t, repoDir, "checkout", "swazz/fix-finding-123")

	patchedCode, err := os.ReadFile(controllerFile)
	if err != nil {
		t.Fatalf("failed to read patched file: %v", err)
	}

	if !strings.Contains(string(patchedCode), "currentUser :=") {
		t.Errorf("patched code does not contain the fix! Code:\n%s", string(patchedCode))
	}
}
