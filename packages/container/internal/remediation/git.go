package remediation

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

type GitPatcher struct{}

func NewGitPatcher() *GitPatcher {
	return &GitPatcher{}
}

// CreateFixPR creates a branch, applies a patch, commits, pushes, and opens a PR.
func (p *GitPatcher) CreateFixPR(repoPath string, findingID string, patchContent string, title string, body string) (prUrl string, err error) {
	worktreePath := fmt.Sprintf("%s-fix-%s", repoPath, findingID)
	branchName := fmt.Sprintf("swazz/fix-%s", findingID)

	// Step F: Cleanup
	defer func() {
		cleanupCmd := exec.Command("git", "worktree", "remove", "--force", worktreePath)
		cleanupCmd.Dir = repoPath
		_ = cleanupCmd.Run()
	}()

	// Step A: Create worktree
	worktreeCmd := exec.Command("git", "worktree", "add", "-b", branchName, worktreePath, "master")
	worktreeCmd.Dir = repoPath
	if out, err := worktreeCmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("failed to create worktree: %v, output: %s", err, string(out))
	}

	// Write patch content to temp file
	patchFile, err := os.CreateTemp("", "patch-*.diff")
	if err != nil {
		return "", fmt.Errorf("failed to create temp patch file: %v", err)
	}
	patchFilePath := patchFile.Name()
	// Step F: Cleanup temp patch file
	defer os.Remove(patchFilePath)

	if _, err := patchFile.WriteString(patchContent); err != nil {
		return "", fmt.Errorf("failed to write patch file: %v", err)
	}
	patchFile.Close()

	// Step B: Apply the patch
	applyCmd := exec.Command("git", "apply", patchFilePath)
	applyCmd.Dir = worktreePath
	if out, err := applyCmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("failed to apply patch: %v, output: %s", err, string(out))
	}

	// Step C: Commit
	addCmd := exec.Command("git", "add", ".")
	addCmd.Dir = worktreePath
	if out, err := addCmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("failed to add files: %v, output: %s", err, string(out))
	}

	commitCmd := exec.Command("git", "commit", "-m", title)
	commitCmd.Dir = worktreePath
	if out, err := commitCmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("failed to commit: %v, output: %s", err, string(out))
	}

	// Step D: Push
	pushCmd := exec.Command("git", "push", "origin", branchName)
	pushCmd.Dir = worktreePath
	if out, err := pushCmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("failed to push: %v, output: %s", err, string(out))
	}

	// Step E: Detect Git provider and Create PR/MR
	remoteUrlCmd := exec.Command("git", "config", "--get", "remote.origin.url")
	remoteUrlCmd.Dir = repoPath
	remoteUrlBytes, _ := remoteUrlCmd.Output()
	remoteUrl := strings.ToLower(string(remoteUrlBytes))

	var prCmd *exec.Cmd
	if strings.Contains(remoteUrl, "gitlab") {
		prCmd = exec.Command("glab", "mr", "create", "--title", title, "--description", body, "--source-branch", branchName, "--target-branch", "master", "--yes")
	} else {
		prCmd = exec.Command("gh", "pr", "create", "--title", title, "--body", body, "--head", branchName, "--base", "master")
	}
	prCmd.Dir = worktreePath
	var stdout bytes.Buffer
	prCmd.Stdout = &stdout

	if err := prCmd.Run(); err != nil {
		return "Branch pushed: " + branchName, nil
	}

	return strings.TrimSpace(stdout.String()), nil
}
