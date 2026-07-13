# Grouped Errors UI Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve usability of the Grouped Errors tab by removing the warning label, loading all findings, and rendering/loading them in the DOM dynamically only when groups are expanded.

**Architecture:** Modify the `Inspector` component so that in `findingsOnly` mode it requests `limit: 100000` (thus querying all findings), removes the "Detected Vulnerability Findings" header, hides the bottom load more button, and displays "findings" instead of "reqs" in the status indicator.

**Tech Stack:** React, Vitest, Testing Library

## Global Constraints
- None

---

### Task 1: Update Inspector Component

**Files:**
- Modify: `packages/web/src/components/Inspector/Inspector.tsx`

- [ ] **Step 1: Modify query limit for findingsOnly**
  In the `loadResults` function, change the `limit` parameter passed to `queryResults` so that it uses `100000` if `findingsOnly` is true:
  ```typescript
  limit: findingsOnly ? 100000 : limit,
  ```

- [ ] **Step 2: Remove the "Detected Vulnerability Findings" header**
  In the JSX rendering of the component, remove the div containing the "Detected Vulnerability Findings" text and SVG icon when `findingsOnly` is true. Keep the "Expand All" and "Collapse All" buttons.

- [ ] **Step 3: Update count suffix and hide bottom load more**
  - Update the count suffix label to show "finding" / "findings" in `findingsOnly` mode instead of always saying "reqs".
  - Hide the `total > limit` text and its button in the top right.
  - Hide the bottom "Load More" button when `findingsOnly` is true.

- [ ] **Step 4: Verify Vitest tests pass**
  Run the test suite for the Inspector component to verify existing tests pass.
  Run: `rtk npm run test -- packages/web/src/components/Inspector/Inspector.test.tsx`
  Expected: All tests pass.

- [ ] **Step 5: Add a new test case for findings count formatting**
  Verify the finding count label matches findings instead of reqs. Add a test in `packages/web/src/components/Inspector/Inspector.test.tsx`.

- [ ] **Step 6: Commit changes**
  Run:
  ```bash
  rtk git add packages/web/src/components/Inspector/Inspector.tsx packages/web/src/components/Inspector/Inspector.test.tsx
  rtk git commit -m "feat(ui): improve Grouped Errors tab by loading all findings and updating headers"
  ```
