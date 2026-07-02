# Dynamic Analytics Dashboard (Task 77) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a Dynamic Analytics Dashboard providing visual insights into fuzzing history, vulnerability trends, and runner utilization metrics in the Web UI.

**Architecture:** 
- Expose a new project analytics endpoint `GET /api/projects/:id/analytics` on the Edge coordinator querying D1 databases (`scans`, `findings`) and Durable Object runners status.
- Add an `analytics` activeTab in the Zustand store and main workspace layout.
- Build a custom SVG-based `AnalyticsDashboard` component styling with CSS class layout constraints (no inline styles).

**Tech Stack:** React 19, TypeScript, Hono, Cloudflare Workers/D1/Durable Objects.

## Global Constraints
- PR Merges: NEVER merge a PR without explicit user approval. Do NOT run `gh pr merge` or use the `--auto` flag.
- Go URL Parameters: (N/A for this task, but follow standard net/url in Go if any changes are made).
- Frontend Styles: No inline layout styles (e.g. `padding`, `margin`, `width`, `height`, `display`) in React component files. Define them in a CSS stylesheet instead.
- E2E Test Usernames: Username registration length must be 3 to 20 characters matching `^[a-zA-Z0-9_\-]{3,20}$`.

---

### Task 1: Extend Durable Object and Edge Coordinator Routes

**Files:**
- Modify: `packages/edge/src/Coordinator.ts`
- Modify: `packages/edge/src/routes/projects.ts`
- Test: `packages/edge/src/index.test.ts`

**Interfaces:**
- Consumes: `getDB`, `checkPermission`
- Produces: `GET /api/projects/:id/analytics` JSON payload

- [ ] **Step 1: Modify `Coordinator.ts` to include `activeJobs` in the `/runners` response**

In `packages/edge/src/Coordinator.ts` near line 337:
```typescript
        let connectionId = null;
        let activeJobs: string[] = [];
        try {
          const attachment = ws.deserializeAttachment() as { connectionId?: string; activeJobs?: string[] } | null;
          if (attachment) {
            if (attachment.connectionId) {
              connectionId = attachment.connectionId;
            }
            if (attachment.activeJobs) {
              activeJobs = attachment.activeJobs;
            }
          }
        } catch {}

        runnerList.push({
          connectionId,
          name,
          publicKey: pubKey,
          status: isPending ? 'authenticating' : 'connected',
          isShared: !pubKey,
          version,
          activeJobs,
        });
```

- [ ] **Step 2: Add `/api/projects/:id/analytics` endpoint in `projects.ts`**

Register the endpoint in `packages/edge/src/routes/projects.ts`:
```typescript
  app.get('/api/projects/:id/analytics', async (c) => {
    const projectId = c.req.param('id');
    const userId = await getUserIdFromRequest(c);
    if (c.env.AUTH_ENABLED === 'true' && userId) {
      const hasAccess = await checkPermission(c.env, userId, projectId, 'get:/api/projects/:id/scans');
      if (!hasAccess) return c.json({ error: 'Forbidden' }, 403);
    }

    const db = getDB(c.env);

    // 1. Scan stats query
    const statsQuery = await db.prepare(`
      SELECT 
        COUNT(*) as total_scans,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_scans,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_scans,
        AVG(strftime('%s', completed_at) - strftime('%s', created_at)) as avg_duration_seconds
      FROM scans 
      WHERE project_id = ?
    `).bind(projectId).first<{ total_scans: number; completed_scans: number; failed_scans: number; avg_duration_seconds: number | null }>();

    // 2. Scan history query (last 30 days)
    const historyQuery = await db.prepare(`
      SELECT 
        DATE(created_at) as date, 
        COUNT(*) as count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count
      FROM scans 
      WHERE project_id = ? AND created_at >= datetime('now', '-30 days')
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `).bind(projectId).all<{ date: string; count: number; completed_count: number; failed_count: number }>();

    // 3. Findings by level and category
    const findingsQuery = await db.prepare(`
      SELECT 
        f.level as severity,
        f.rule_id as category,
        COUNT(*) as count
      FROM findings f
      JOIN scans s ON f.scan_id = s.id
      WHERE s.project_id = ?
      GROUP BY f.level, f.rule_id
    `).bind(projectId).all<{ severity: string; category: string; count: number }>();

    // 4. Findings history over time (daily)
    const findingsHistoryQuery = await db.prepare(`
      SELECT 
        DATE(f.created_at) as date,
        f.level as severity,
        COUNT(*) as count
      FROM findings f
      JOIN scans s ON f.scan_id = s.id
      WHERE s.project_id = ? AND f.created_at >= datetime('now', '-30 days')
      GROUP BY DATE(f.created_at), f.level
      ORDER BY date ASC
    `).bind(projectId).all<{ date: string; severity: string; count: number }>();

    // 5. Runner metrics
    let totalConnected = 0;
    let totalBusy = 0;
    let runnersList: any[] = [];
    try {
      const doId = c.env.COORDINATOR_DO.idFromName('global-coordinator');
      const stub = c.env.COORDINATOR_DO.get(doId);
      const doRes = await stub.fetch(new Request('http://do/runners'));
      if (doRes.ok) {
        const data = await doRes.json() as { runners: any[] };
        runnersList = (data.runners || []).map(r => {
          const isBusy = !!(r.activeJobs && r.activeJobs.length > 0);
          return {
            name: r.name,
            isShared: !!r.isShared,
            isBusy
          };
        });
        totalConnected = runnersList.length;
        totalBusy = runnersList.filter(r => r.isBusy).length;
      }
    } catch (e) {
      console.error("Failed to query runners from Coordinator DO:", e);
    }

    const utilization = totalConnected > 0 ? (totalBusy / totalConnected) * 100 : 0;

    return c.json({
      scanStats: {
        total: statsQuery?.total_scans || 0,
        completed: statsQuery?.completed_scans || 0,
        failed: statsQuery?.failed_scans || 0,
        avgDuration: Math.round(statsQuery?.avg_duration_seconds || 0)
      },
      scanHistory: historyQuery.results || [],
      findingsStats: findingsQuery.results || [],
      findingsHistory: findingsHistoryQuery.results || [],
      runnerMetrics: {
        totalConnected,
        totalBusy,
        utilization,
        runners: runnersList
      }
    });
  });
```

- [ ] **Step 3: Write tests for the analytics API endpoint**

In `packages/edge/src/index.test.ts`, add a test block:
```typescript
  describe("GET /api/projects/:id/analytics", () => {
    it("returns correct project analytics data structure", async () => {
      const projectId = "test-analytics-project";
      await testEnv.DB.prepare(
        "INSERT INTO scans (id, project_id, target_url, profile, status, created_at, completed_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now', '+30 seconds'))"
      ).bind("scan-1", projectId, "http://target.com", "default", "completed").run();

      await testEnv.DB.prepare(
        "INSERT INTO findings (id, scan_id, rule_id, level, message) VALUES (?, ?, ?, ?, ?)"
      ).bind("finding-1", "scan-1", "swazz/xss", "High", "Reflected XSS").run();

      const res = await appFetchWrapper(new Request(`http://localhost/api/projects/${projectId}/analytics`), {
        env: testEnv
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.scanStats).toBeDefined();
      expect(data.scanStats.total).toBe(1);
      expect(data.scanStats.completed).toBe(1);
      expect(data.scanHistory.length).toBeGreaterThan(0);
      expect(data.findingsStats.length).toBe(1);
      expect(data.findingsStats[0].severity).toBe("High");
    });
  });
```

- [ ] **Step 4: Run backend test suite**

Run: `rtk npm run test -w packages/edge` or test scripts
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add packages/edge/src/Coordinator.ts packages/edge/src/routes/projects.ts packages/edge/src/index.test.ts
git commit -m "feat(backend): implement project analytics api endpoint"
```

---

### Task 2: Define Store States and UI Navigation Tabs

**Files:**
- Modify: `packages/web/src/store/appStore.ts`
- Modify: `packages/web/src/components/MainWorkspace.tsx`

**Interfaces:**
- Consumes: Zustand store `activeTab` states
- Produces: Visual tab button, routing container integration

- [ ] **Step 1: Update Zustand UISlice types in `appStore.ts`**

In `packages/web/src/store/appStore.ts`:
```typescript
export interface UISlice {
    activeTab: 'heatmap' | 'logs' | 'findings' | 'owasp' | 'settings' | 'project_settings' | 'history' | 'compare' | 'about' | 'analytics';
...
```

- [ ] **Step 2: Add "Analytics" tab inside the Workspace navigation bar**

In `packages/web/src/components/MainWorkspace.tsx`, insert tab button near line 215:
```typescript
                        <button
                            className={`tab-bar-btn ${activeTab === 'analytics' ? 'active' : ''}`}
                            onClick={() => useAppStore.setState({ activeTab: 'analytics' })}
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="20" x2="18" y2="10"></line>
                                <line x1="12" y1="20" x2="12" y2="4"></line>
                                <line x1="6" y1="20" x2="6" y2="14"></line>
                            </svg>
                            Analytics
                        </button>
```

- [ ] **Step 3: Import and render `AnalyticsDashboard` component when activeTab is `'analytics'`**

In `packages/web/src/components/MainWorkspace.tsx`, conditionally render the dashboard:
```typescript
                            {activeTab === 'analytics' && (
                                <AnalyticsDashboard projectId={config.projectId || activeProject?.id} />
                            )}
```

- [ ] **Step 4: Commit navigation integration**

```bash
git add packages/web/src/store/appStore.ts packages/web/src/components/MainWorkspace.tsx
git commit -m "feat(frontend): integrate analytics tab in navigation store"
```

---

### Task 3: Create Custom SVG Analytics Dashboard Component

**Files:**
- Create: `packages/web/src/components/Dashboard/AnalyticsDashboard.tsx`
- Modify: `packages/web/src/index.css`

**Interfaces:**
- Consumes: `projectId` prop
- Produces: Visual KPI cards, SVG line charts, SVG donut charts, SVG bar charts

- [ ] **Step 1: Create `AnalyticsDashboard.tsx`**

Write `packages/web/src/components/Dashboard/AnalyticsDashboard.tsx` displaying loaded analytics, SVG lines with curves, donut slices, and runner logs.
*Implementation Details*: Calculate Line Chart paths using proportional `x` and `y` points computed from raw values. Render segmented donut rings using stroke dash properties.
Use only CSS class names (no inline layout tags like margin/padding).

- [ ] **Step 2: Add styles to `index.css`**

Add class styles in `packages/web/src/index.css`:
```css
.analytics-dashboard {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-4);
  color: var(--text-default);
  overflow-y: auto;
  height: 100%;
}
.analytics-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-4);
}
.analytics-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
  position: relative;
  overflow: hidden;
}
.analytics-chart-row {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: var(--space-4);
}
@media (max-width: 1024px) {
  .analytics-chart-row {
    grid-template-columns: 1fr;
  }
}
.svg-chart-container {
  min-height: 300px;
  width: 100%;
}
.svg-line-path {
  fill: none;
  stroke: var(--accent-light);
  stroke-width: 3;
}
.svg-area-path {
  fill: url(#chart-gradient);
  opacity: 0.15;
}
.svg-grid-line {
  stroke: var(--border-default);
  stroke-width: 1;
  stroke-dasharray: 4 4;
}
.svg-donut-segment {
  fill: none;
  stroke-width: 12;
  transition: stroke-dashoffset 0.3s ease;
}
```

- [ ] **Step 3: Commit component**

```bash
git add packages/web/src/components/Dashboard/AnalyticsDashboard.tsx packages/web/src/index.css
git commit -m "feat(frontend): implement custom svg analytics dashboard"
```

---

### Task 4: UI Unit Testing and Playwright E2E Verification

**Files:**
- Create: `packages/web/src/components/Dashboard/AnalyticsDashboard.test.tsx`
- Create: `tests/e2e/analytics.spec.ts`

**Interfaces:**
- Consumes: Vitest component rendering, Playwright page selectors
- Produces: Validated test suites

- [ ] **Step 1: Create Vitest component test**

Create `packages/web/src/components/Dashboard/AnalyticsDashboard.test.tsx`:
```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { AnalyticsDashboard } from './AnalyticsDashboard';
import { vi, describe, it, expect } from 'vitest';

describe('AnalyticsDashboard Component', () => {
  it('renders loading state initially and then shows charts', async () => {
    // Mock global fetch
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          scanStats: { total: 10, completed: 8, failed: 2, avgDuration: 15 },
          scanHistory: [{ date: '2026-07-01', count: 2, completed_count: 2, failed_count: 0 }],
          findingsStats: [{ severity: 'High', category: 'swazz/xss', count: 1 }],
          findingsHistory: [{ date: '2026-07-01', severity: 'High', count: 1 }],
          runnerMetrics: { totalConnected: 2, totalBusy: 1, utilization: 50, runners: [] }
        }),
      })
    );

    render(<AnalyticsDashboard projectId="test-project" />);

    // Wait for the data to load and render
    await waitFor(() => {
      expect(screen.getByText('10')).toBeInTheDocument(); // Total scans
      expect(screen.getByText('50%')).toBeInTheDocument(); // Utilization
    });
  });
});
```

- [ ] **Step 2: Create Playwright E2E test**

Create `tests/e2e/analytics.spec.ts` checking the navigation to Analytics tab, asserting visual charts presence and stats verification.

- [ ] **Step 3: Verify the full branch verification script**

Run: `rtk bash scripts/verify-all.sh` (Runs edge builder, container testing, frontend builds, and E2E checks in one go)
Expected: SUCCESS

- [ ] **Step 4: Commit tests**

```bash
git add packages/web/src/components/Dashboard/AnalyticsDashboard.test.tsx tests/e2e/analytics.spec.ts
git commit -m "test: add unit and e2e integration tests for analytics dashboard"
```
