# Grouped Errors UI Improvements Design

## 1. Goal
Improve the "Grouped Errors" tab usability by:
1. Removing the header text "Detected Vulnerability Findings" to clean up the layout.
2. Querying all findings immediately from IndexedDB (by passing `limit: 100000` on queries where `findingsOnly` is true) so that all groups/categories of errors are populated instantly without needing to click the bottom "Load More" button.
3. Keep the browser performance fast by dynamically rendering endpoints in the DOM only when the group is expanded.

## 2. Requirements & Constraints
* **Header modification**: Remove the text label "Detected Vulnerability Findings" and its icon from the top of the Inspector component when in `findingsOnly` mode.
* **IndexedDB Querying**:
  * Set IndexedDB query `limit` to 100,000 for findings queries. Since the query engine loads all matching scan results from IndexedDB for filtering anyway, this will not cause any extra disk read overhead but will return all findings in the current scan run.
* **Group Rendering**:
  * Keep the existing grouping and dynamic DOM rendering logic (which slices group items to `groupLimits` and only mounts them when expanded).
* **Bottom Load More**: Hide the bottom "Load More (showing X of Y)" button when `findingsOnly` is true.
* **Top Right Count Label**: Display `{total} findings` instead of `{total} reqs` in the top right corner of the tab when `findingsOnly` is true.

## 3. Architecture & Data Flow
When the "Grouped Errors" tab is active:
1. `Inspector` loads with `findingsOnly = true`.
2. `loadResults()` triggers `queryResults()` with `limit: 100000`.
3. The returned list of findings is saved in `rows` state.
4. `groupedFindings` memoized value computes the grouped structure of all findings.
5. In the UI, the groups are rendered as collapsed by default.
6. When a group is clicked, `expandedGroups` toggles the group's visibility and only then are the corresponding endpoint rows rendered (using `groupLimits` for local pagination of 50 items at a time).

## 4. Test Strategy
* Run Vitest unit tests in `packages/web/src/components/Inspector/Inspector.test.tsx` to verify grouping and sorting of findings remains correct.
* Add or update tests as necessary.
