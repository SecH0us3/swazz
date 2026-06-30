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

// defaultBranch detects the default branch from origin/HEAD.
// Falls back to "main" if detection fails.
func defaultBranch(repoPath string) string {
	// #nosec G204 -- command uses no user-supplied input
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "origin/HEAD")
	cmd.Dir = repoPath
	out, err := cmd.Output()
	if err == nil {
		// output is e.g. "origin/main\n" — strip the "origin/" prefix
		branch := strings.TrimSpace(string(out))
		if after, ok := strings.CutPrefix(branch, "origin/"); ok {
			return after
		}
		return branch
	}
	return "main"
}

// CreateFixPR creates a branch, applies a patch, commits, pushes, and opens a PR.
func (p *GitPatcher) CreateFixPR(repoPath string, findingID string, patchContent string, title string, body string) (prUrl string, err error) {
	worktreePath := fmt.Sprintf("%s-fix-%s", repoPath, findingID)
	branchName := fmt.Sprintf("swazz/fix-%s", findingID)

	// Step F: Cleanup
	defer func() {
		// #nosec G204 -- The command is intentionally constructed from safe variables
		cleanupCmd := exec.Command("git", "worktree", "remove", "--force", worktreePath)
		cleanupCmd.Dir = repoPath
		_ = cleanupCmd.Run()
	}()

	// Step A: Create worktree
	baseBranch := defaultBranch(repoPath)
	// #nosec G204 -- The command is intentionally constructed from safe variables
	worktreeCmd := exec.Command("git", "worktree", "add", "-b", branchName, worktreePath, baseBranch)
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
		_ = patchFile.Close()
		return "", fmt.Errorf("failed to write patch file: %v", err)
	}
	_ = patchFile.Close()

	// Step B: Apply the patch
	// #nosec G204 -- The command is intentionally constructed from safe variables
	applyCmd := exec.Command("git", "apply", patchFilePath)
	applyCmd.Dir = worktreePath
	if out, err := applyCmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("failed to apply patch: %v, output: %s", err, string(out))
	}

	// Step C: Commit
	// #nosec G204 -- The command is intentionally constructed from safe variables
	addCmd := exec.Command("git", "add", ".")
	addCmd.Dir = worktreePath
	if out, err := addCmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("failed to add files: %v, output: %s", err, string(out))
	}

	// #nosec G204 -- The command is intentionally constructed from safe variables
	commitCmd := exec.Command("git", "commit", "-m", title)
	commitCmd.Dir = worktreePath
	if out, err := commitCmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("failed to commit: %v, output: %s", err, string(out))
	}

	// Step D: Push
	// #nosec G204 -- The command is intentionally constructed from safe variables
	pushCmd := exec.Command("git", "push", "origin", branchName)
	pushCmd.Dir = worktreePath
	if out, err := pushCmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("failed to push: %v, output: %s", err, string(out))
	}

	// Step E: Detect Git provider and Create PR/MR
	// #nosec G204 -- The command is intentionally constructed from safe variables
	remoteUrlCmd := exec.Command("git", "config", "--get", "remote.origin.url")
	remoteUrlCmd.Dir = repoPath
	remoteUrlBytes, _ := remoteUrlCmd.Output()
	remoteUrl := strings.ToLower(string(remoteUrlBytes))

	var prCmd *exec.Cmd
	if strings.Contains(remoteUrl, "gitlab") {
		// #nosec G204 -- The command is intentionally constructed from safe variables
		prCmd = exec.Command("glab", "mr", "create", "--title", title, "--description", body, "--source-branch", branchName, "--target-branch", baseBranch, "--yes")
	} else {
		// #nosec G204 -- The command is intentionally constructed from safe variables
		prCmd = exec.Command("gh", "pr", "create", "--title", title, "--body", body, "--head", branchName, "--base", baseBranch)
	}
	prCmd.Dir = worktreePath
	var stdout bytes.Buffer
	prCmd.Stdout = &stdout

	if err := prCmd.Run(); err != nil {
		return "", fmt.Errorf("failed to create pull request: %w", err)
	}

	return strings.TrimSpace(stdout.String()), nil
}
