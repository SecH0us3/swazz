# Design Specification: OWASP Top 10 Performance Optimization and Findings Deduplication

## Status
- **Date**: 2026-07-14
- **Feature**: OWASP Top 10 tab performance optimization & deduplication
- **Status**: Approved

## 1. Problem Statement
The current implementation of the OWASP Top 10 tab in the React web dashboard exhibits two major issues:
1. **Infinite Loading State during Active Scans**: The component relies on a `useEffect` hook that triggers on every `liveCount` change with a 1-second debounce (`setTimeout`). Because `liveCount` updates rapidly during active scans, the debounce timer is repeatedly cleared and rescheduled, preventing database queries from completing. Consequently, the loading spinner is displayed indefinitely until the scan stops.
2. **Duplicate Findings Pollution**: The findings list under each category renders every single failing request, resulting in massive redundancy (e.g. hundreds of entries representing the same vulnerability on the same path with slightly different fuzz payloads).

## 2. Goals
- Eliminate the infinite loading state, ensuring that findings load incrementally and update smoothly in real time during active scans.
- Highlight categories with matching findings instantly as they are discovered.
- Deduplicate findings within categories based on Method, Endpoint/Path, and Vulnerability Type (or Status Code).
- Keep all unit and integration tests green.

## 3. Proposed Changes

### A. Frontend Props update
Update `<OWASPTop10>` component inside `packages/web/src/components/MainWorkspace.tsx` to receive the `isRunning` scan state.

### B. Polling & Loading Logic
Refactor the loading hook inside `packages/web/src/components/OWASPTop10/OWASPTop10.tsx`:
- On mount or when `runId` changes, run a single query immediately.
- If `isRunning` is `true`, establish a low-frequency polling interval (`setInterval`) of 3 seconds to fetch database updates incrementally.
- When `isRunning` transitions to `false` (the scan completes), perform a final immediate query to guarantee all latest findings are captured, and clear the polling interval.
- Show the loading spinner *only* during the first initial query, avoiding UI disruption on subsequent background polling ticks.

### C. Deduplication Logic
Deduplicate the grouped findings within each category:
- Unique key formula: `${categoryName}:${row.method}:${row.resolvedPath || row.endpoint}:${finding?.ruleId || 'status-' + row.status}`
- Inside the `groupedData` `useMemo` block, check unique keys via a set and only push unique entries. This will automatically keep the banners, cards, and accordion items aligned.

### D. CSS/Styling Enhancements
In `OWASPTop10.css`, style active and highlighted states:
- Enhancing `.owasp-card.has-findings` to make it visually premium.
- Support smooth transitions for cards when they transition from zero to more findings.

---

## 4. Verification Plan

### Automated Tests
- Run `npm test --workspace=packages/web` to verify Vitest tests.
- Update `packages/web/src/components/OWASPTop10/OWASPTop10.test.tsx` to check:
  - Correct render with `isRunning` prop.
  - Proper deduplication logic.
- Run `bash tests/e2e/run-e2e.sh` to ensure E2E integration test suite continues to pass.
