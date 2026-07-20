# Code Review: Feature/Adaptive Rate Limiting

**Reviewer**: Mistral Vibe CLI Agent  
**Date**: 2026-07-20  
**Base Commit**: 96daa50944b6a020b042e33df7e243a8fb93f0ed  
**Target Commit**: b32ead7e (HEAD -> feature/adaptive-rate-limiting)  

---

## Summary of Changes

This PR adds WAF evasion and proxy configuration capabilities to the Swazz fuzzing platform. The changes introduce three new settings:

1. **ProxyList**: Array of proxy URLs (HTTP/SOCKS5) for request routing
2. **RandomizeUserAgent**: Boolean to randomize User-Agent headers per request
3. **EnableAdaptiveRateLimit**: Boolean to automatically pause requests on 429 responses

### Files Modified

| File | Change Type | Lines Changed |
|------|-------------|----------------|
| `packages/container/internal/swagger/types.go` | Modified | +3 lines |
| `packages/container/internal/swagger/types_test.go` | Modified | +19 lines |
| `packages/web/src/types.ts` | Modified | +3 lines |
| `packages/web/src/components/ProjectSettings/PerformanceTab.tsx` | Modified | +49 lines |
| `packages/web/src/components/ProjectSettings/PerformanceTab.test.tsx` | Added | +59 lines |

---

## Critical Rules Verification

### Rule 1: Go URL Parameter Formatting

**Rule**: NEVER format URL parameters using fmt.Sprintf or string concatenation. Use net/url and Query() API.

**Status**: COMPLIANT

All URL handling in the codebase properly uses the `net/url` package:
- `packages/container/internal/runner/http_executor.go`: Uses `url.Parse()` and `parsedURL.Query()`
- `packages/container/internal/swagger/validation.go`: Uses `url.Parse()`
- No instances of `fmt.Sprintf` for URL construction with parameters were found

The only use of `fmt.Sprintf` with "http" is in test/mock code which generates random test data, not actual URLs for API calls.

**Conclusion**: PASS - No violations introduced by this PR.

---

### Rule 2: React Inline Layout Styles

**Rule**: No inline layout styles (padding, margin, width, height, display) in React files. Define them in stylesheets.

**Status**: VIOLATION FOUND

**File**: `packages/web/src/components/ProjectSettings/PerformanceTab.tsx`

The new WAF Evasion & Proxies section (lines 171-217) contains multiple inline style violations:

```tsx
// Line 171: display, flexDirection, gap, borderTop, paddingTop
<div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>

// Line 172: margin, fontSize, fontWeight, color
<h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>

// Line 175: display, marginBottom, fontSize, color
<label htmlFor="proxyList" style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>

// Line 185: width, minHeight, fontFamily
style={{ width: '100%', minHeight: '80px', fontFamily: 'monospace' }}

// Line 189: borderTop, paddingTop
style={{ borderTop: 'none', paddingTop: 0 }}

// Line 198: fontSize
<strong style={{ fontSize: '13px' }}>Randomize User-Agent per request</strong>

// Line 202: borderTop, paddingTop
style={{ borderTop: 'none', paddingTop: 0 }}

// Line 211: fontSize
<strong style={{ fontSize: '13px' }}>Enable Adaptive Rate Limiting</strong>

// Line 213: fontSize, color, marginLeft, lineHeight
style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '24px', lineHeight: '1.4' }}
```

**Note**: The entire file has 40+ inline style attributes that pre-exist. While this PR only adds violations, new code must comply with the rule.

**Conclusion**: FAIL - 9+ new inline style violations introduced.

---

### Rule 3: E2E Test Registration Username Length

**Rule**: Registration username must be 3 to 20 characters. Ensure test usernames are < 20 chars.

**Status**: COMPLIANT

The existing E2E test in `tests/e2e/login-ux.spec.ts` generates usernames using:
```typescript
const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
```

This format produces usernames like: `u123456_789` (maximum 11 characters)

No new E2E tests involving registration were added in this PR. The new test file (`PerformanceTab.test.tsx`) is a unit test for the React component and does not involve user registration.

**Conclusion**: PASS - All usernames are well under the 20-character limit.

---

### Rule 4: Git Tracking of docs/superpowers/

**Rule**: Never track docs/superpowers/ directory.

**Status**: COMPLIANT

- The `docs/superpowers/` directory exists on disk but is not tracked in git
- It is properly excluded in `.gitignore` (line 86: `docs/superpowers/`)
- No files from this directory appear in `git ls-files`
- This PR does not modify `.gitignore` or add any files to `docs/superpowers/`

**Conclusion**: PASS - Directory remains untracked.

---

## Detailed Analysis

### Backend Changes

#### `packages/container/internal/swagger/types.go`

**Changes**:
- Added `ProxyList []string` field to `Settings` struct
- Added `RandomizeUserAgent bool` field to `Settings` struct
- Added `EnableAdaptiveRateLimit bool` field to `Settings` struct
- Initialized defaults in `DefaultSettings()` function

Good:
- Proper Go types (slice, bool)
- JSON tags use camelCase for frontend compatibility
- Default values are sensible (empty slice, false)

#### `packages/container/internal/swagger/types_test.go`

**Changes**:
- Added `TestSettingsSerialization` test function

Good:
- Tests JSON marshaling and unmarshaling round-trip
- Validates all three new fields
- Uses testify/assert for clear assertions

Suggestion: Add test for deserialization from raw JSON string to ensure backward compatibility.

---

### Frontend Changes

#### `packages/web/src/types.ts`

**Changes**:
- Added `proxyList?: string[]` to `SwazzSettings` interface
- Added `randomizeUserAgent?: boolean` to `SwazzSettings` interface
- Added `enableAdaptiveRateLimit?: boolean` to `SwazzSettings` interface
- Added defaults to `DEFAULT_SETTINGS` constant

Good:
- Optional fields marked with `?` for backward compatibility
- Types match Go backend exactly
- Default values match Go defaults

#### `packages/web/src/components/ProjectSettings/PerformanceTab.tsx`

**Changes**: Added WAF Evasion & Proxies section with:
- Textarea for proxy list input
- Checkbox for User-Agent randomization
- Checkbox for adaptive rate limiting
- Descriptive labels and help text

Good:
- All three new settings integrated into UI
- Proxy list properly handles newline splitting and trimming
- Boolean toggles use controlled components
- Help text is descriptive and useful

Issues:
1. **Inline styles violation** - See Critical Rules section above
2. **Missing client-side validation** for proxy URLs
3. **Accessibility**: Textarea could use `rows` attribute instead of `minHeight` in style

#### `packages/web/src/components/ProjectSettings/PerformanceTab.test.tsx`

**New file**: Unit tests for PerformanceTab component

Good:
- Tests all three new UI controls
- Verifies `updateSettings` is called with correct values
- Tests proxy list parsing (newline splitting, trimming, filtering empty lines)
- Uses proper mocking with vi
- Tests toggle functionality for booleans

Suggestions:
- Add test for empty proxy list
- Add test for proxy URLs with excessive whitespace
- Add test for non-boolean values (edge case)

---

## Additional Observations

### Type Safety

EXCELLENT - All new fields are properly typed across the stack with matching types between Go and TypeScript. The serialization test confirms data flows correctly.

### Test Coverage

GOOD - Go serialization round-trip test, TypeScript UI interaction tests.

### JSON Tag Consistency

CONSISTENT - Both Go and TypeScript use camelCase for JSON fields.

---

## Potential Issues & Recommendations

### 1. Proxy URL Validation (Medium Priority)

The `ProxyList` field accepts any string without validation.

**Recommendation**: Add validation in Go backend when settings are updated, return clear errors to UI.

### 2. Security Considerations for Proxies (High Priority)

Allowing custom proxies introduces risks: malicious proxies, misconfigured proxies, no authentication.

**Recommendation**: Add security warning in UI, consider proxy authentication support, document security implications.

### 3. Adaptive Rate Limiting Algorithm (Critical)

Implementation details unclear: backoff calculation, max backoff time, multiple 429 handling, state persistence.

**Recommendation**: Document algorithm in UI help text, add max backoff configuration, consider circuit breaker pattern.

### 4. User-Agent Randomization (Low Priority)

**Recommendation**: Document source of User-Agent strings, consider allowing custom lists.

### 5. Proxy List UI/UX (Medium Priority)

**Recommendation**: Add UI feedback for proxy status and selection strategy.

---

## Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Go URL parameter formatting | PASS | Uses net/url.Query() API |
| React inline styles | FAIL | 9+ new inline style violations |
| E2E username length | PASS | All usernames < 20 chars |
| Git tracking docs/superpowers | PASS | Properly excluded in .gitignore |
| Type safety | PASS | Consistent types Go/TS |
| Test coverage | PASS | New tests added |
| JSON serialization | PASS | Tested in both languages |

---

## Blocking Issues

**1. Inline Styles in PerformanceTab.tsx (CRITICAL)**

The new code adds multiple inline style attributes, violating the project's style guidelines.

**Required Action**: Extract all inline styles to CSS classes before merging.

---

## Non-Blocking Recommendations

1. Add proxy URL validation (backend and frontend)
2. Document adaptive rate limiting algorithm
3. Add security warnings for proxy usage
4. Consider proxy authentication support
5. Add edge case tests for new settings
6. Document User-Agent string sources

---

## Conclusion

**Overall Assessment**: The feature implementation is solid with good type safety and test coverage. However, the inline style violations in the React component are blocking and must be addressed before this PR can be merged.

The new WAF evasion and proxy features add valuable functionality for security testing, but need proper style compliance and additional validation before production deployment.

**Recommendation**: Request Changes - Fix inline styles, then approve.

---

## Files Changed

```
packages/container/internal/swagger/types.go
packages/container/internal/swagger/types_test.go
packages/web/src/components/ProjectSettings/PerformanceTab.test.tsx (NEW)
packages/web/src/components/ProjectSettings/PerformanceTab.tsx
packages/web/src/types.ts
```

---

*Generated by Mistral Vibe CLI Agent*