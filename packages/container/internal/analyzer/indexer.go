package analyzer

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var errFound = errors.New("handler found")

// RepoIndexer scans a repository to extract context for handlers.
type RepoIndexer struct {
	RootDir string
}

// NewRepoIndexer creates a new RepoIndexer.
func NewRepoIndexer(rootDir string) *RepoIndexer {
	return &RepoIndexer{RootDir: rootDir}
}

// FindHandlerContext finds the file and context for a given HTTP method and route path.
func (idx *RepoIndexer) FindHandlerContext(httpMethod, routePath string) (filePath string, codeContext string, err error) {
	validExts := map[string]bool{
		".go": true, ".ts": true, ".js": true, ".py": true, ".java": true, ".rb": true,
	}

	escapedPath := regexp.QuoteMeta(routePath)
	methodLower := strings.ToLower(httpMethod)

	// Pattern to match method, mapping, path, route etc. followed by the routePath in quotes.
	patternStr := fmt.Sprintf(`(?i)(%s|mapping|path|route|endpoint).*?['"]%s['"]`, methodLower, escapedPath)
	re, err := regexp.Compile(patternStr)
	if err != nil {
		return "", "", fmt.Errorf("failed to compile regex: %w", err)
	}

	var foundPath string
	var foundLineNum int
	var foundLines []string

	walkErr := filepath.WalkDir(idx.RootDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if name == "node_modules" || name == "vendor" || name == ".git" || name == "dist" || name == "build" || name == "target" {
				return fs.SkipDir
			}
			return nil
		}

		ext := filepath.Ext(path)
		if !validExts[ext] {
			return nil
		}

		// #nosec G304 G122 -- Path is constructed safely from filepath.WalkDir starting from a trusted repository root
		content, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil
		}

		lines := strings.Split(string(content), "\n")
		for i, line := range lines {
			if strings.Contains(line, routePath) {
				if re.MatchString(line) {
					foundPath = path
					foundLineNum = i
					foundLines = lines
					return errFound
				}
			}
		}
		return nil
	})

	if walkErr != nil {
		if errors.Is(walkErr, errFound) {
			startLine := foundLineNum - 50
			if startLine < 0 {
				startLine = 0
			}
			endLine := foundLineNum + 50
			if endLine > len(foundLines)-1 {
				endLine = len(foundLines) - 1
			}

			contextLines := foundLines[startLine : endLine+1]
			
			relPath, err := filepath.Rel(idx.RootDir, foundPath)
			if err != nil {
				relPath = foundPath
			}
			
			return relPath, strings.Join(contextLines, "\n"), nil
		}
		return "", "", fmt.Errorf("failed to walk directory: %w", walkErr)
	}

	return "", "", fmt.Errorf("handler for %s %s not found", httpMethod, routePath)
}
