# Design Spec: Multi-Scan Comparison Mode (Task 108)

This design specification details the architecture, UI/UX structure, and comparison algorithms for adding a multi-scan comparison mode inside the Swazz web dashboard.

---

## 🎯 Goals & Success Criteria

1. **Scan Selection**: Allow users to select exactly 2 scans from the `HistoryPage` via checkboxes.
2. **Dashboard Tab**: Implement a dedicated "Compare" workspace tab (alongside Heatmap, Logs, etc.) showing:
   - Side-by-side run metadata (date, total requests, duration).
   - Severity distribution shift (Error, Warning, Note shifts) rendered via clean SVG charts.
   - Endpoint coverage delta and HTTP status code comparison.
3. **Findings Diff**: Calculate and present categorized lists:
   - **New Findings**: Present in the target scan (Scan B) but not in the base scan (Scan A).
   - **Fixed Findings**: Present in Scan A but not in Scan B.
   - **Common Findings**: Present in both scans.
4. **Resilient Matching**: Implement a schema-based diff matching algorithm using `Rule ID + Method + Endpoint Path` to compare findings robustly across scans.
5. **Filters & Export**: Provide in-list filters (by severity or search text) and generate markdown/HTML exports for the comparison.

---

## 🏗 System Architecture & Components

### 1. State Management (`appStore.ts`)
We will extend the Zustand `UISlice` and `FuzzingSlice`:
- **`activeTab`**: Add `'compare'` to the allowed tabs list.
- **`compareRunIdA` / `compareRunIdB`**: Reference two `ScanRun` IDs currently being compared.

```typescript
export interface FuzzingSlice {
    // ... existing fields
    compareRunIdA: string | null;
    compareRunIdB: string | null;
}
```

### 2. Checkbox Selection in `HistoryPage.tsx`
- Add checkbox selection state inside `HistoryPage.tsx` (`selectedRunIds: string[]`).
- When exactly 2 checkboxes are selected, a floating bar slides in with a **"Compare Scans"** action button.
- Clicking "Compare Scans" will:
  1. Set `compareRunIdA` and `compareRunIdB` in `useAppStore`.
  2. Redirect `activeTab` to `'compare'`.

### 3. Comparison View Page (`ComparePage.tsx`)
A new component under `packages/web/src/components/ComparePage.tsx`:
- **Run Header Details**: Displays metadata comparing Scan A and Scan B.
- **Metrics Dashboard**:
  - **Findings Shift**: Lightweight SVG bar chart showing side-by-side Errors, Warnings, and Notes count.
  - **Coverage Delta**: Bar representing fuzzed endpoints coverage and status codes.
- **Diff Tab System**:
  - **New Findings Tab**: Displays findings with a red `NEW` badge.
  - **Fixed Findings Tab**: Displays resolved items with a green `FIXED` badge.
  - **Common Findings Tab**: Displays persistent items with a neutral badge.
  - **Search & Filters**: Input field and dropdown to search endpoints and filter by severity within the current list.

### 4. Matching Algorithm (Diff Utility)
A helper in `packages/web/src/utils/compare.ts`:
- Match findings between two scans by generating a unique key:
  `key = finding.ruleId + '|' + finding.method.toUpperCase() + '|' + finding.endpoint`
- For Scan A (base) and Scan B (target), construct maps of findings:
  - If key is in Map B but not Map A &rarr; **New Finding**
  - If key is in Map A but not Map B &rarr; **Fixed Finding**
  - If key is in both &rarr; **Common Finding**

---

## 🔒 Security & RBAC Constraints
- Ensure the user has permissions for both compared scans' project.
- Enforce guest-policy (read-only in comparison views, no triage updates for guest role).

---

## 🧪 Testing Plan
- **Unit Tests**: Add tests in `packages/web/src/utils/compare.test.ts` for the matching logic (mocking different scan findings, checking output sets).
- **E2E Tests**: Add an E2E test in `tests/e2e/compare.spec.ts` that imports two CLI reports, checks their checkboxes in Scan History, hits the compare button, and asserts that the comparison dashboard renders correctly.
