# Walkthrough — Grouped Errors UI Improvements

We have completed the improvements to the **Grouped Errors** tab to solve the issue where not all findings were fitting, and the user had to click "Load More" repeatedly while only ~20 groups were shown.

## Changes

### 1. Header Cleanup
- Removed the text label `"Detected Vulnerability Findings"` and its warning icon from the top of the Inspector component when in `findingsOnly` mode.
- Left the **Expand All** and **Collapse All** buttons intact to preserve manual control.

### 2. IndexedDB Query Limit & Dynamic Loading
- When the `findingsOnly` option is enabled, the query `limit` is set to `100000` (instead of the previous `1000`). This ensures that *all* findings for the run are retrieved, grouped, and categorised immediately, so no groups are omitted.
- The endpoints/requests under each group are only rendered dynamically when the user expands the group (collapsed by default). This keeps browser rendering lightweight and fast.

### 3. Suffix & Loader Adjustments
- Replaced the suffix `{total} reqs` with `{total} findings` in `findingsOnly` mode.
- Hid the top right "(showing X of Y) show all" pagination label and the bottom "Load More (showing X of Y)" button when displaying grouped findings.

## Verification
- Added a new unit test in [Inspector.test.tsx](file:///Users/alex/src/swazz/packages/web/src/components/Inspector/Inspector.test.tsx) to verify the finding count string format.
- Ran Vitest unit tests in `packages/web`: `vitest run src/components/Inspector/Inspector.test.tsx` (Passed).
- Ran targeted Playwright E2E test `triage-and-history.spec.ts` (Passed).
