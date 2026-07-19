# Code Review: Mistral Vibe Integration

**Reviewer:** Mistral Vibe (Senior Code Reviewer)  
**Date:** 2026-07-19  
**Base Commit:** c8582fbd7e48d7d5bfc17f615fd30c0c83cd2ec8  
**HEAD Commit:** 7d8d9f34  
**Commits Reviewed:** 6

---

## Summary

These changes add comprehensive support for Mistral Vibe CLI as an AI tool option in Swazz, including both stdin piping capability and UI integration. The feature spans 6 commits across the feature branch:

1. **42bf39b**: Enable stdin piping in CLIAnalyzer to support vibe agent
2. **ee0c470**: Add Mistral Vibe option to Preferred AI Tool in Settings UI
3. **25212df**: Document Mistral Vibe CLI support, update Dockerfile.ai, and fix CLIAnalyzer stdin redundancy
4. **06c0f9e**: Refactor CLIAnalyzer to deduplicate command execution logic
5. **54dec9c**: Add Mistral Vibe integration code review documentation
6. **7d8d9f3**: Remove inline layout style from Preferred AI Tool label and add to index.css

### Files Modified

| File | Changes | Lines | Type |
|------|---------|-------|------|
| `packages/container/internal/ai/client.go` | Refactored stdin vs temp file execution | +23 | Backend |
| `packages/container/internal/ai/client_test.go` | Added stdin-based test cases | +39 | Tests |
| `packages/web/src/components/ProjectSettings/AiRemediationTab.tsx` | Added Vibe UI option | +19 | Frontend |
| `packages/web/src/components/ProjectSettings/AiRemediationTab.test.tsx` | Added Vibe test | +15 | Tests |
| `packages/container/Dockerfile.ai` | Added mistral-vibe installation | +1 | DevOps |
| `docs/ai_remediation.md` | Updated documentation | +4 | Documentation |
| `packages/web/src/index.css` | Added settings-label margin style | +4 | Styles |
| `.gitignore` | Removed docs/reviews/ from ignore | -1 | Config |

---

## Critical Rules Verification

### Rule 1: Go URL Parameter Formatting
**Status:** PASS

**Verification:** No URL parameter formatting was introduced in any of the changed files. The Go modifications in `client.go` focus solely on command execution (stdin vs temp file) and do not involve HTTP URL construction or query parameter manipulation.

**Note:** A pre-existing violation remains in `packages/container/internal/graphql/parser.go:252` which uses `fmt.Sprintf("%s?%s=%s", basePath, opQueryParam, field.Name)`. This was not introduced by this PR and should be addressed separately in a dedicated cleanup PR.

### Rule 2: React Inline Layout Styles
**Status:** PASS (with improvement!)

**Verification:** The changes actually **improved** compliance with this rule. Commit 7d8d9f3 specifically addressed an inline style issue:

- **Before (commit 25212df):** Line 395 had `style={{ margin: 0 }}` on the Preferred AI Tool label
- **After (commit 7d8d9f3):** The inline style was removed and moved to CSS class `.settings-field-group .settings-label { margin: 0; }` in `index.css`

This is **exactly the correct approach** - moving layout styles from inline to stylesheets. The codebase now has better compliance than before this PR.

**Pre-existing:** The file still contains other inline styles (lines 394, 423, 483, 493, 520, 553, 556) that were present in the base commit and remain unchanged. These should be addressed in a separate cleanup PR.

### Rule 3: E2E Test Username Length
**Status:** PASS

**Verification:** No E2E test files were modified in these changes. All existing E2E tests use the pattern `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}` which generates usernames of 9-11 characters (well under the 20 character limit). The scheduler.spec.ts even includes a comment explicitly noting compliance with the 3-20 character requirement.

### Rule 4: Git Tracking of docs/superpowers/
**Status:** PASS

**Verification:** 
- No files in the `docs/superpowers/` directory were added, modified, or tracked
- The directory is properly listed in `.gitignore` (line 86)
- One change to `.gitignore` was made: `docs/reviews/` was removed from the ignore list (line 93 in base commit, removed in HEAD). This is appropriate as review documents should be tracked.

---

## Detailed Findings

### High Priority Issues
**None identified.**

### Medium Priority Issues
**None identified.**

### Low Priority Issues / Improvements

#### 1. Minor Inconsistency in Documentation (ai_remediation.md)
**Location:** Lines 38-40  
**Issue:** The documentation uses backticks for the Vibe command but `<code v-pre>` for the agy example.  
**Suggestion:** Standardize on `<code v-pre>` for consistency:
```markdown
- For tools using prompt files: The runner replaces <code v-pre>{{prompt_file}}</code> with the path to the secure temporary prompt file. Example: <code v-pre>agy -p {{prompt_file}}</code>
- For Mistral Vibe: Set the command to <code v-pre>vibe -p - --auto-approve --trust</code>. The runner will automatically pipe the prompt content into standard input.
```

### Code Quality Observations

#### Backend Changes (client.go)
**Excellent refactoring.** Commit `06c0f9e` significantly improved the code structure:

**Before (25212df):** The code had redundant temp file creation that occurred regardless of execution mode, leading to unnecessary file I/O for stdin-based commands.

**After (06c0f9e):** Proper branching logic with clean separation of concerns:
- Commands containing `{{prompt_file}}` → temp file approach (Claude, agy)
- Commands without `{{prompt_file}}` → stdin piping (Vibe)

**Code Structure (lines 36-74):**
```go
// If command contains "{{prompt_file}}", we use the temp file approach and do NOT pipe to stdin.
// Otherwise, we pipe the prompt directly to stdin and avoid creating a temporary file.
if strings.Contains(c.CommandTemplate, "{{prompt_file}}") {
    tmpFile, err := os.CreateTemp("", "swazz-prompt-*.txt")
    if err != nil {
        return "", fmt.Errorf("failed to create temp file: %w", err)
    }
    defer os.Remove(tmpFile.Name())
    // ... write prompt to file, replace placeholder
    for _, arg := range fields[1:] {
        args = append(args, strings.ReplaceAll(arg, "{{prompt_file}}", tmpFile.Name()))
    }
} else {
    // Stdin-based command execution (e.g. vibe)
    args = fields[1:]
    stdin = strings.NewReader(fullPrompt)
}

cmd := exec.Command(cmdName, args...)
if stdin != nil {
    cmd.Stdin = stdin
}
```

**Security:** The implementation correctly uses `exec.Command` directly without shell interpretation (`/bin/sh -c`), preventing command injection. The `#nosec G204` comment is appropriate given the controlled runner environment.

**Testing:** New test cases in `client_test.go` cover both stdin scenarios:
- `TestCLIAnalyzer_AnalyzeStdin`: Tests basic stdin piping with `cat`
- `TestCLIAnalyzer_AnalyzeStdinWithHyphen`: Tests stdin with explicit `-` argument

Both tests validate that the prompt content is correctly passed through stdin.

#### Frontend Changes (AiRemediationTab.tsx)
**Clean integration.** The Mistral Vibe option is added consistently across:
- Type definition (line 139): `selectedTool` union type includes 'vibe'
- Detection logic (lines 162-163): Parses existing commands starting with 'vibe'
- Placeholder function (lines 338-340): Returns `vibe -p - --auto-approve --trust`
- Tool change handler (lines 358-363): Sets both pass1 and pass2 commands
- Select dropdown (line 404): `<option value="vibe">Mistral Vibe CLI</option>`

**UX:** The command `vibe -p - --auto-approve --trust` correctly uses stdin piping (`-` argument with auto-approve and trust flags for non-interactive mode).

**Accessibility:** The changes added `htmlFor` and `id` attributes for better accessibility (lines 395, 397).

**Style Compliance:** Commit 7d8d9f3 improved compliance by removing the inline `style={{ margin: 0 }}` that was temporarily added and moving it to the CSS class `.settings-field-group .settings-label { margin: 0; }` in index.css.

#### CSS Changes (index.css)
**Proper separation of concerns.** Commit 7d8d9f3 added the CSS rule:
```css
.settings-field-group .settings-label {
    margin: 0;
}
```
This is the correct approach to handle the margin styling that was previously inline, improving code maintainability.

#### Dockerfile Changes (Dockerfile.ai)
**Simple and correct:** Added `&& pipx install mistral-vibe` to the existing pipx installation line. This ensures Vibe CLI is available in the container environment alongside agy.

#### Documentation Changes (ai_remediation.md)
**Clear and helpful:** Documentation was updated in two places:
1. Line 18: Added `or vibe` to the AI Agent CLI section
2. Lines 38-40: Added dedicated section explaining stdin-based execution for Mistral Vibe

## Testing Coverage

| Test File | New Tests | Coverage |
|-----------|-----------|----------|
| `client_test.go` | 2 | Stdin execution paths |
| `AiRemediationTab.test.tsx` | 1 | Vibe option rendering and defaults |

**Gap:** No integration test that exercises the full Vibe CLI workflow end-to-end. This is acceptable given the external dependency on Mistral Vibe installation, but a mock-based integration test could be added in the future.

---

## Security Considerations

- The Go code uses `exec.Command` with user-provided command templates
- The existing `#nosec G204` comment (line 60) acknowledges this is intentional in a controlled runner environment
- The new stdin piping doesn't introduce additional security concerns beyond what already exists
- The stdin content is controlled by the application (fullPrompt is constructed from internal strings)
- Temp file handling remains unchanged and secure for commands with `{{prompt_file}}`
- No shell injection risk: `exec.Command` is used directly without `/bin/sh -c`

---

## Recommendations

### Must Fix
**None.** All critical rules are satisfied.

### Should Fix
**None.** All issues have been addressed in the current commits.

### Nice to Have
1. Standardize code formatting in documentation (use `<code v-pre>` consistently for all command examples)
2. Consider adding an integration test with mocked Vibe CLI execution
3. Consider addressing pre-existing inline styles in AiRemediationTab.tsx in a follow-up PR

---

## Conclusion

**Overall Assessment:** EXCELLENT

The Mistral Vibe integration is well-designed, properly tested, and follows project conventions. The development process demonstrated good engineering practices:

1. **Incremental development:** Features were added in logical stages (backend first, then UI, then docs)
2. **Refactoring:** Code quality was improved during the process (commit 06c0f9e cleaned up redundancy)
3. **Compliance improvement:** The inline style issue was actually fixed (commit 7d8d9f3)
4. **Comprehensive testing:** New tests cover all new functionality

**Ready for merge:** Yes, absolutely. This PR not only adds the requested feature but also improves code quality.

**Key Improvements:**
- Backend: Refactored CLIAnalyzer with proper branching between file-based and stdin execution
- Backend: Added test coverage for stdin functionality (2 new tests)
- Frontend: Added Vibe CLI option to UI with proper type safety
- Frontend: Added test coverage for Vibe CLI option (1 new test)
- Styles: Fixed inline style violation by moving to CSS (commit 7d8d9f3)
- DevOps: Added mistral-vibe installation to Dockerfile
- Documentation: Updated to include Vibe usage instructions
- Accessibility: Added htmlFor/id attributes for better accessibility

**Quality Indicators:**
- All critical rules satisfied (with Rule 2 actually improved)
- No new security issues introduced
- Type-safe implementation (Go and TypeScript)
- Appropriate test coverage added (+3 tests)
- Clean, maintainable code design
- Follows existing patterns and conventions

**Pre-existing Issues (Out of Scope):**
- Inline styles in React files (multiple locations in AiRemediationTab.tsx) - should be addressed separately
- URL parameter formatting in graphql/parser.go:252 - should be addressed separately
- These should be addressed in dedicated cleanup PRs
