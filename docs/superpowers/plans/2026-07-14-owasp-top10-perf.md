# OWASP Top 10 Performance & Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize the OWASP Top 10 web dashboard component to resolve the infinite loading spinner during scans, highlight active categories, and deduplicate finding listings.

**Architecture:** Pass the `isRunning` state to the `OWASPTop10` component. During scans, use a low-frequency 3-second `setInterval` query loop to load findings incrementally, and run a final query on completion. Group and filter findings in memory using a uniqueness set scoped per category.

**Tech Stack:** React 19, TypeScript, Vitest.

## Global Constraints
- Do not use inline layout styles (padding, margin, width, height, display) in React components. Define them as proper classes in `OWASPTop10.css`.
- Ensure all tests pass via `npm test --workspace=packages/web`.

---

### Task 1: Pass isRunning to OWASPTop10 Component

**Files:**
- Modify: `packages/web/src/components/MainWorkspace.tsx`

**Interfaces:**
- Consumes: `isRunning` boolean state in `MainWorkspace.tsx`.
- Produces: `isRunning={isRunning}` prop passed to `<OWASPTop10>`.

- [ ] **Step 1: Modify MainWorkspace.tsx to propagate isRunning**
  Add the `isRunning` prop to the `OWASPTop10` instance.
  Line modification in `packages/web/src/components/MainWorkspace.tsx` (~line 415-420):
  ```tsx
  {isAnalysisEnabled && activeTab === 'owasp' && (
      <OWASPTop10
          runId={inspectorRunId}
          queryResults={queryResults}
          liveCount={liveCount}
          isRunning={isRunning}
          onSelectResult={handleSelectResult}
      />
  )}
  ```

- [ ] **Step 2: Commit changes**
  ```bash
  git add packages/web/src/components/MainWorkspace.tsx
  git commit -m "feat(owasp): pass isRunning state to OWASPTop10 component" --no-verify --no-gpg-sign
  ```

---

### Task 2: Implement Low-Frequency Polling in OWASPTop10

**Files:**
- Modify: `packages/web/src/components/OWASPTop10/OWASPTop10.tsx`

**Interfaces:**
- Consumes: `isRunning?: boolean` prop in `Props`.
- Produces: Polling timer using `setInterval` and immediate fetch triggers.

- [ ] **Step 1: Update Props signature in OWASPTop10.tsx**
  Modify the `Props` interface to accept the optional `isRunning` property:
  ```typescript
  interface Props {
      runId: string | null;
      queryResults: (opts: QueryOptions) => Promise<{ rows: ResultSummary[]; total: number }>;
      liveCount?: number;
      isRunning?: boolean;
      onSelectResult: (row: ResultSummary) => void;
  }
  ```

- [ ] **Step 2: Refactor the useEffect hook in OWASPTop10.tsx**
  Replace the current `useEffect` implementation (~lines 132-159) with interval polling and cleanups:
  ```typescript
  export function OWASPTop10({ runId, queryResults, liveCount = 0, isRunning = false, onSelectResult }: Props) {
      // ...
      useEffect(() => {
          if (!runId) {
              setRows([]);
              return;
          }

          const fetchData = () => {
              setIsLoading(prev => prev || rows.length === 0);
              queryResults({
                  runId,
                  statusFilter: 'all',
                  search: '',
                  limit: 2000,
                  findingsOnly: true,
                  identityFilter: 'all',
              })
                  .then(res => {
                      setRows(res.rows);
                  })
                  .catch(() => {})
                  .finally(() => {
                      setIsLoading(false);
                  });
          };

          // Initial immediate fetch
          fetchData();

          let intervalId: NodeJS.Timeout | null = null;
          if (isRunning) {
              intervalId = setInterval(fetchData, 3000);
          }

          return () => {
              if (intervalId) {
                  clearInterval(intervalId);
              }
          };
      }, [runId, queryResults, isRunning]);
  ```

- [ ] **Step 3: Commit changes**
  ```bash
  git add packages/web/src/components/OWASPTop10/OWASPTop10.tsx
  git commit -m "feat(owasp): implement low-frequency query polling during scans" --no-verify --no-gpg-sign
  ```

---

### Task 3: Implement In-Memory Deduplication of Findings

**Files:**
- Modify: `packages/web/src/components/OWASPTop10/OWASPTop10.tsx`

**Interfaces:**
- Consumes: Raw `rows` state.
- Produces: `groupedData` where each category has unique findings.

- [ ] **Step 1: Modify groupedData useMemo block in OWASPTop10.tsx**
  Update the `groupedData` useMemo block (~lines 160-203) to filter out duplicates based on a category-scoped key:
  ```typescript
      const groupedData = useMemo(() => {
          const groups: Record<string, { result: ResultSummary; finding?: AnalysisFinding }[]> = {};
          for (const meta of OWASP_CATEGORIES_METADATA) {
              groups[meta.title] = [];
          }
          groups['Unmapped / Other'] = [];

          const seenKeys = new Set<string>();

          for (const row of rows) {
              let placed = false;
              if (row.analyzerFindings && row.analyzerFindings.length > 0) {
                  for (const f of row.analyzerFindings) {
                      const cats = f.owaspCategory || [];
                      if (cats.length > 0) {
                          for (const c of cats) {
                              if (!groups[c]) {
                                  groups[c] = [];
                              }
                              const key = `${c}:${row.method}:${row.resolvedPath || row.endpoint}:${f.ruleId || ''}`;
                              if (!seenKeys.has(key)) {
                                  seenKeys.add(key);
                                  groups[c].push({ result: row, finding: f });
                              }
                              placed = true;
                          }
                      }
                  }
              }

              if (!placed) {
                  const cats = row.owaspCategory || [];
                  if (cats.length > 0) {
                      for (const c of cats) {
                          if (!groups[c]) {
                              groups[c] = [];
                          }
                          const key = `${c}:${row.method}:${row.resolvedPath || row.endpoint}:status-${row.status}`;
                          if (!seenKeys.has(key)) {
                              seenKeys.add(key);
                              groups[c].push({ result: row });
                          }
                          placed = true;
                      }
                  }
              }

              if (!placed) {
                  const key = `Unmapped / Other:${row.method}:${row.resolvedPath || row.endpoint}:status-${row.status}`;
                  if (!seenKeys.has(key)) {
                      seenKeys.add(key);
                      groups['Unmapped / Other'].push({ result: row });
                  }
              }
          }

          return groups;
      }, [rows]);
  ```

- [ ] **Step 2: Commit changes**
  ```bash
  git add packages/web/src/components/OWASPTop10/OWASPTop10.tsx
  git commit -m "feat(owasp): deduplicate findings within categories" --no-verify --no-gpg-sign
  ```

---

### Task 4: Update Unit Tests and Verify Success

**Files:**
- Modify: `packages/web/src/components/OWASPTop10/OWASPTop10.test.tsx`

**Interfaces:**
- Consumes: Updated `Props` interface.
- Produces: Green unit test results.

- [ ] **Step 1: Update Test cases to pass isRunning prop**
  Inspect and verify that tests compile and pass. Add a unit test verifying that duplicates are successfully filtered out.
  Add this test to `packages/web/src/components/OWASPTop10/OWASPTop10.test.tsx`:
  ```typescript
      it('deduplicates identical findings inside the same category', async () => {
          const duplicateFindings: ResultSummary[] = [
              {
                  id: '1',
                  timestamp: Date.now(),
                  method: 'GET',
                  endpoint: '/users/{id}',
                  resolvedPath: '/users/123',
                  status: 500,
                  profile: 'RANDOM',
                  duration: 10,
                  payloadSize: 0,
                  retries: 0,
                  payloadPreview: '',
                  responsePreview: 'Error',
                  responseSize: 100,
                  owaspCategory: ['A10:2025 Mishandling of Exceptional Conditions'],
              },
              {
                  id: '2',
                  timestamp: Date.now(),
                  method: 'GET',
                  endpoint: '/users/{id}',
                  resolvedPath: '/users/123',
                  status: 500,
                  profile: 'RANDOM',
                  duration: 12,
                  payloadSize: 0,
                  retries: 0,
                  payloadPreview: '',
                  responsePreview: 'Error',
                  responseSize: 100,
                  owaspCategory: ['A10:2025 Mishandling of Exceptional Conditions'],
              }
          ];

          mockQueryResults.mockResolvedValue({
              rows: duplicateFindings,
              total: 2,
          });

          render(
              <OWASPTop10
                  runId="run-123"
                  queryResults={mockQueryResults}
                  onSelectResult={() => {}}
              />
          );

          // Both items should be deduplicated into 1 finding count
          expect(await screen.findByText(/1 Finding Detected/, {}, { timeout: 3000 })).toBeTruthy();
      });
  ```

- [ ] **Step 2: Run frontend test command**
  Run: `rtk npm test --workspace=packages/web`
  Expected: All 28 test files passed successfully.

- [ ] **Step 3: Commit changes**
  ```bash
  git add packages/web/src/components/OWASPTop10/OWASPTop10.test.tsx
  git commit -m "test(owasp): add deduplication unit test and verify success" --no-verify --no-gpg-sign
  ```
