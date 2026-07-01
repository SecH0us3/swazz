# Multi-Scan Comparison Mode (Task 108) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a dedicated "Compare" workspace tab allowing users to check exactly 2 scans from the history list and perform a side-by-side comparison of statistics, coverage, status distributions, and a diff (new/fixed/common) of vulnerability findings.

**Architecture:** Extend Zustand store state to track selection. Implement a schema-based diff utility comparing findings. Build a Compare tab workspace component rendering custom SVG bar charts, metrics, search filters, and expandable vulnerability details.

**Tech Stack:** React 19, TypeScript, Vitest, Playwright, Vanilla CSS.

## Global Constraints

- **No inline layout styles**: Never write inline layout styles (such as `padding`, `margin`, `width`, `height`, `display`, etc.) in React component files. Define them in `index.css`.
- **E2E Username constraint**: Usernames generated in tests must be 3-20 characters long.
- **1Password Modal ignore**: Mark sensitive inputs with `data-1p-ignore`.

---

### Task 1: Comparison Logic Helper

**Files:**
- Create: `packages/web/src/utils/compare.ts`
- Create: `packages/web/src/utils/compare.test.ts`

**Interfaces:**
- Consumes: `ResultSummary` type from `packages/web/src/hooks/useRunner.ts`
- Produces: `compareScans(runAResults: ResultSummary[], runBResults: ResultSummary[])` returning the findings diff sets and metrics shift.

- [ ] **Step 1: Write the failing tests**
  Create `packages/web/src/utils/compare.test.ts`:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { compareScans } from './compare.js';
  import type { ResultSummary } from '../hooks/useRunner.js';

  describe('compareScans', () => {
      it('calculates diffs correctly', () => {
          const runA: Partial<ResultSummary>[] = [
              { id: '1', method: 'GET', endpoint: '/api/users', analyzerFindings: [{ ruleId: 'swazz/sql-error-leak', level: 'error', message: 'leak' }] }
          ];
          const runB: Partial<ResultSummary>[] = [
              { id: '2', method: 'GET', endpoint: '/api/users', analyzerFindings: [{ ruleId: 'swazz/sql-error-leak', level: 'error', message: 'leak' }] },
              { id: '3', method: 'POST', endpoint: '/api/users', analyzerFindings: [{ ruleId: 'swazz/reflected-xss', level: 'error', message: 'xss' }] }
          ];

          const diff = compareScans(runA as ResultSummary[], runB as ResultSummary[]);
          expect(diff.newFindings.length).toBe(1);
          expect(diff.newFindings[0].endpoint).toBe('/api/users');
          expect(diff.newFindings[0].method).toBe('POST');
          expect(diff.fixedFindings.length).toBe(0);
          expect(diff.commonFindings.length).toBe(1);
      });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run packages/web/src/utils/compare.test.ts`
  Expected: FAIL with "compareScans is not defined" or similar.

- [ ] **Step 3: Write minimal implementation**
  Create `packages/web/src/utils/compare.ts`:
  ```typescript
  import type { ResultSummary } from '../hooks/useRunner.js';

  export interface ComparisonResult {
      newFindings: ResultSummary[];
      fixedFindings: ResultSummary[];
      commonFindings: ResultSummary[];
  }

  export function compareScans(runA: ResultSummary[], runB: ResultSummary[]): ComparisonResult {
      const getFindingKey = (r: ResultSummary, ruleId: string) => {
          return `${ruleId}|${r.method.toUpperCase()}|${r.endpoint}`;
      };

      const findingsA = new Map<string, ResultSummary>();
      const findingsB = new Map<string, ResultSummary>();

      for (const r of runA) {
          if (r.analyzerFindings) {
              for (const f of r.analyzerFindings) {
                  findingsA.set(getFindingKey(r, f.ruleId), r);
              }
          }
      }

      for (const r of runB) {
          if (r.analyzerFindings) {
              for (const f of r.analyzerFindings) {
                  findingsB.set(getFindingKey(r, f.ruleId), r);
              }
          }
      }

      const newFindings: ResultSummary[] = [];
      const fixedFindings: ResultSummary[] = [];
      const commonFindings: ResultSummary[] = [];

      findingsB.forEach((res, key) => {
          if (!findingsA.has(key)) {
              newFindings.push(res);
          } else {
              commonFindings.push(res);
          }
      });

      findingsA.forEach((res, key) => {
          if (!findingsB.has(key)) {
              fixedFindings.push(res);
          }
      });

      return { newFindings, fixedFindings, commonFindings };
  }
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run packages/web/src/utils/compare.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  Run: `rtk git add packages/web/src/utils/compare.ts packages/web/src/utils/compare.test.ts`
  Run: `rtk git commit -m "feat: add scan comparison diff helper and tests"`

---

### Task 2: App Store State Extensions

**Files:**
- Modify: `packages/web/src/store/appStore.ts`

**Interfaces:**
- Consumes: Zustand store slice setup.
- Produces: `compareRunIdA` and `compareRunIdB` properties in `FuzzingSlice`. Supports `'compare'` in `activeTab`.

- [ ] **Step 1: Write state tests or check compiler**
  Let's verify compiling works before changes.

- [ ] **Step 2: Modify appStore.ts**
  Add state properties `compareRunIdA: string | null` and `compareRunIdB: string | null` to the store slice definitions in `packages/web/src/store/appStore.ts`.
  Update the `UISlice` interface to support `'compare'` in `activeTab`:
  `activeTab: 'heatmap' | 'logs' | 'findings' | 'owasp' | 'settings' | 'project_settings' | 'history' | 'compare';`

- [ ] **Step 3: Run project build to verify type safety**
  Run: `npm run build` (or verify compilation)
  Expected: PASS

- [ ] **Step 4: Commit**
  Run: `rtk git add packages/web/src/store/appStore.ts`
  Run: `rtk git commit -m "feat: extend appStore to support multi-scan comparison state"`

---

### Task 3: HistoryPage Checkbox Selection

**Files:**
- Modify: `packages/web/src/components/HistoryPage.tsx`
- Modify: `packages/web/src/index.css`

**Interfaces:**
- Consumes: `runs: ScanRun[]`, `useAppStore` hook.
- Produces: Checkboxes on each history row, floating compare action bar when exactly 2 rows are selected.

- [ ] **Step 1: Modify HistoryPage.tsx**
  Add local state `selectedIds` for tracking checkbox state.
  Render checkbox inputs as the first column in the runs table.
  Add floating action bar matching CSS layout (e.g. `compare-bar` class) shown when `selectedIds.length === 2`.
  Implement click handler for "Compare Scans" button that updates store state:
  ```typescript
  useAppStore.setState({
      compareRunIdA: selectedIds[0],
      compareRunIdB: selectedIds[1],
      activeTab: 'compare'
  });
  ```

- [ ] **Step 2: Add styles in index.css**
  Define styles for `.compare-bar` (floating sticky action bar, glass effect, accent background). No inline layout styles.

- [ ] **Step 3: Verify build**
  Run: `npm run build`
  Expected: PASS

- [ ] **Step 4: Commit**
  Run: `rtk git add packages/web/src/components/HistoryPage.tsx packages/web/src/index.css`
  Run: `rtk git commit -m "feat: add scan selection checkboxes and action bar to HistoryPage"`

---

### Task 4: ComparePage Component

**Files:**
- Create: `packages/web/src/components/ComparePage.tsx`
- Modify: `packages/web/src/index.css`

**Interfaces:**
- Consumes: `compareRunIdA` and `compareRunIdB` from store, `queryResults` or `getRunResults` to fetch all findings.
- Produces: High-end side-by-side comparison dashboard.

- [ ] **Step 1: Create ComparePage.tsx**
  Create `packages/web/src/components/ComparePage.tsx`. Fetch scan results on mount using `getRunResults` or `queryResults`. Apply the `compareScans` helper.
  Render:
  - Meta overview cards.
  - Side-by-side severity shifts as custom SVG bars.
  - Status counts comparisons.
  - Findings list filtered by search query or severity level.

- [ ] **Step 2: Add CSS styles in index.css**
  Define `.compare-dashboard`, `.compare-metrics-row`, `.compare-chart-card`, etc., inside `packages/web/src/index.css` to match design mockups without inline layouts.

- [ ] **Step 3: Verify build**
  Run: `npm run build`
  Expected: PASS

- [ ] **Step 4: Commit**
  Run: `rtk git add packages/web/src/components/ComparePage.tsx packages/web/src/index.css`
  Run: `rtk git commit -m "feat: add ComparePage UI component with visual charts and diff list"`

---

### Task 5: MainWorkspace Integration

**Files:**
- Modify: `packages/web/src/components/MainWorkspace.tsx`
- Modify: `packages/web/src/App.tsx`

**Interfaces:**
- Consumes: `ComparePage` component.
- Produces: Integrated Comparison Workspace Tab.

- [ ] **Step 1: Register Compare Tab**
  Modify `packages/web/src/components/MainWorkspace.tsx` to import and render `<ComparePage />` when `activeTab === 'compare'`.
  Add a "Compare" tab button inside `MainWorkspace.tsx` tab-bar if `compareRunIdA` and `compareRunIdB` are active, allowing easy tab-swapping.

- [ ] **Step 2: Verify build**
  Run: `npm run build`
  Expected: PASS

- [ ] **Step 3: Commit**
  Run: `rtk git add packages/web/src/components/MainWorkspace.tsx packages/web/src/App.tsx`
  Run: `rtk git commit -m "feat: integrate ComparePage in MainWorkspace"`

---

### Task 6: E2E Integration Tests

**Files:**
- Create: `tests/e2e/compare.spec.ts`

**Interfaces:**
- Consumes: Playwright browser tests runner.
- Produces: Automatic validation of multi-scan comparison workflow.

- [ ] **Step 1: Write E2E Test**
  Create `tests/e2e/compare.spec.ts` checking checkboxes on Scan History, clicking Compare button, verifying SVG charts and Diff findings listing.

- [ ] **Step 2: Run E2E Test**
  Run: `bash tests/e2e/run-e2e.sh` (or `npx playwright test`)
  Expected: PASS

- [ ] **Step 3: Commit**
  Run: `rtk git add tests/e2e/compare.spec.ts`
  Run: `rtk git commit -m "test: add E2E test for multi-scan comparison"`

---

### Task 7: Documentation & Roadmap

**Files:**
- Modify: `ROADMAP.md`
- Modify: `README.md`

- [ ] **Step 1: Update ROADMAP.md**
  Mark Task 108 as in progress: `[/] Task 108: Multi-Scan Comparison Mode`

- [ ] **Step 2: Update README.md**
  Add a brief note in features explaining "Multi-Scan Comparison Mode".

- [ ] **Step 3: Commit**
  Run: `rtk git add ROADMAP.md README.md`
  Run: `rtk git commit -m "docs: document multi-scan comparison mode feature"`
