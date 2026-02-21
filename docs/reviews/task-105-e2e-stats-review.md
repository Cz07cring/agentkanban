# Adversarial Code Review: task-105 (E2E-统计测试)

**Reviewer**: task-106 (automated adversarial review)
**Prior review**: task-071-review.md (reviewed same codebase area)
**Branch reviewed**: main (HEAD `d0164ae`)

**Files in scope**:
- `frontend/e2e/advanced-api.spec.ts` — Stats Endpoints tests (lines 929-976)
- `frontend/e2e/api-e2e.spec.ts` — Meta statistics test (lines 486-512)
- `frontend/e2e/console-pages.spec.ts` — Dashboard stats card UI tests
- `frontend/e2e/full-flow.spec.ts` — Cleanup and project-scoped helpers
- `backend/main.py` — `/api/stats`, `/api/stats/daily`, `/api/projects/{pid}/stats`, `write_tasks()` meta calculation
- `frontend/src/app/(console)/dashboard/page.tsx` — Stats display logic
- `frontend/src/lib/api.ts` — `fetchStats()` type definition

---

## Severity Legend
- **P0-Critical**: Causes test flakiness, false passes, or data corruption
- **P1-High**: Logic errors, missing coverage, or robustness gaps
- **P2-Medium**: Maintainability, style, or minor correctness issues
- **P3-Low**: Nit-picks and suggestions

---

## P0 — Critical Issues

### 1. Stats assertions are tautological — cannot detect real regressions (advanced-api.spec.ts:947-961)

```ts
expect(typeof data.total_tasks).toBe("number");
expect(data.by_status).toBeDefined();
expect(data.by_type).toBeDefined();
expect(data.by_engine).toBeDefined();
expect(data.by_priority).toBeDefined();
```

The `/api/stats` test creates one task (`ADV-统计测试`) then only checks that response fields **exist** and are the correct **type**. It never asserts:
- `total_tasks >= 1` (verifying the task was counted)
- `by_status.pending >= 1` (verifying status breakdown is correct)
- `by_engine` contains the correct routed engine for the test task
- `by_type` classifies the task correctly

A backend bug that returns `{ total_tasks: 0, by_status: {}, by_type: {}, by_engine: {}, by_priority: {} }` regardless of data would still pass every assertion. **This is a false-green test that provides zero regression protection.**

**Fix**: After creating the task, assert:
```ts
expect(data.total_tasks).toBeGreaterThanOrEqual(1);
expect(data.by_status.pending).toBeGreaterThanOrEqual(1);
expect(data.by_engine[task.routed_engine]).toBeGreaterThanOrEqual(1);
```

### 2. `/api/stats/daily` timezone boundary flake (advanced-api.spec.ts:963-975)

```ts
const today = new Date().toISOString().split("T")[0];
expect(data.date).toBe(today);
```

The test constructs `today` in the Node.js process using `new Date().toISOString()` (always UTC), while the backend uses `datetime.now(timezone.utc).date().isoformat()`. Both are UTC, **but** there is a TOCTOU race: if the clock rolls past midnight UTC between the API response and the `new Date()` call in the assertion, `data.date` will be yesterday's date while `today` will be the new date. This is a **latent midnight-boundary flake** that will fail ~1/86400 runs, or more frequently in CI with slow backends.

**Fix**: Compare against the date returned from the API itself, or use a range check:
```ts
const apiDate = new Date(data.date + "T00:00:00Z");
const now = new Date();
const diffMs = Math.abs(now.getTime() - apiDate.getTime());
expect(diffMs).toBeLessThan(24 * 60 * 60 * 1000); // within 24h
```

### 3. Dashboard stats card tests rely on `.first()` masking duplicate-element bugs (console-pages.spec.ts:87-93)

```ts
await expect(page.getByText("总任务").first()).toBeVisible();
await expect(page.getByText("待执行").first()).toBeVisible();
await expect(page.getByText("进行中").first()).toBeVisible();
await expect(page.getByText("成功率").first()).toBeVisible();
```

Using `.first()` on text selectors makes these assertions **unfalsifiable** for duplicate-rendering bugs. If the Dashboard renders the stats section twice (e.g., due to a React double-mount in development strict mode, or a stale state merge), these tests will still pass by silently picking the first copy. The test never verifies that exactly 1 "总任务" card exists or that the displayed **value** is correct.

**Fix**: Scope selectors to a `data-testid` container or assert count:
```ts
const statsSection = page.locator('[data-testid="stats-cards"]');
await expect(statsSection.getByText("总任务")).toBeVisible();
```

### 4. `success_rate` calculation in `write_tasks()` excludes cancelled/reviewing tasks from denominator (backend/main.py:207-213)

```python
completed = sum(1 for x in tasks if x.get("status") == "completed")
failed = sum(1 for x in tasks if x.get("status") == "failed")
data["meta"]["success_rate"] = round(completed / max(completed + failed, 1), 2)
```

Only `completed` and `failed` tasks are counted. A project with 1 completed task and 99 cancelled tasks shows `success_rate = 1.0` (100%). The E2E test (`api-e2e.spec.ts:508`) only checks `success_rate >= 0 && <= 1` — it never validates the formula with known inputs (e.g., create 2 completed + 1 failed, assert `success_rate == 0.67`).

Meanwhile, the **frontend** Dashboard (`dashboard/page.tsx:70-76`) independently recalculates success rate from `stats.by_status` using the same formula — but this means the `meta.success_rate` from the backend and the frontend-computed value could diverge if the frontend fetches stale `meta` with fresh `by_status`. **Neither the backend meta value nor the frontend recalculation is tested against known input data.**

---

## P1 — High Severity

### 5. Frontend `fetchStats` return type has phantom `workers_idle` field (api.ts:229)

```ts
export async function fetchStats(projectId?: string): Promise<{
  // ...
  engines: Record<string, {
    healthy: boolean;
    workers_total: number;
    workers_busy: number;
    workers_idle: number;       // <-- not returned by backend
    total_completed?: number;
  }>;
}> {
```

The backend `/api/stats` endpoint returns `{ healthy, workers_total, workers_busy }` — it does NOT return `workers_idle` or `total_completed`. The TypeScript type declares `workers_idle: number` (non-optional), making it a lie. Any code that reads `stats.engines.claude.workers_idle` will get `undefined` at runtime but TypeScript won't flag it. The Dashboard component (`dashboard/page.tsx`) doesn't use `workers_idle` directly, but `EngineCard` accepts `workers_idle?` in its type — a latent bug waiting for the next developer to trust the types.

### 6. `/api/stats` and `/api/projects/{pid}/stats` are identical 30-line copy-pastes (backend/main.py:2048-2084 vs 2476-2512)

Both endpoints:
1. Read tasks
2. Build `by_status`, `by_type`, `by_engine`, `by_priority` dicts with identical loops
3. Build the same `engines` dict with workers counts
4. Return the same shape

Any bug fix applied to one will be missed in the other. This was noted in the task-071 review (P2-11) but has not been addressed. It should now be **elevated to P1** because the project-scoped stats endpoint is actively used by the Dashboard via `fetchStats(projectId)`.

### 7. Meta statistics test has no cleanup, counts are unpredictable (api-e2e.spec.ts:486-512)

The `beforeEach` cleanup only removes tasks prefixed with `"E2E-"`. But the meta statistics (`total_completed`, `success_rate`) are computed over **all** tasks in the data file. If other test suites or manual testing leave behind non-E2E tasks, the counts will include them. The assertion `data.meta.total_completed >= 1` will pass even if the test's own task completion was silently ignored.

**Fix**: Before the test, snapshot the meta counts; after completing the task, verify counts increased by exactly 1.

### 8. Dashboard recalculates `successRate` client-side but never displays `meta.success_rate` (dashboard/page.tsx:70-76)

```ts
const successRate = stats
  ? (stats.by_status?.completed ?? 0) + (stats.by_status?.failed ?? 0) > 0
    ? Math.round(
        ((stats.by_status?.completed ?? 0) /
          ((stats.by_status?.completed ?? 0) + (stats.by_status?.failed ?? 0))) *
          100
      )
    : 0
  : 0;
```

The backend pre-computes `meta.success_rate` on every `write_tasks()` call, but the Dashboard ignores it and recalculates from `by_status`. This means:
1. The backend `meta.success_rate` is dead code — never consumed, never tested in the UI
2. The two calculations can diverge (backend rounds to 2 decimal places as a ratio 0-1; frontend rounds to integer percentage 0-100)
3. The console-pages E2E test checks that "成功率" text is visible but never verifies the displayed **value**

### 9. Missing negative test: stats with empty task list

Neither `/api/stats` nor `/api/stats/daily` nor `/api/projects/{pid}/stats` is tested with zero tasks. The aggregation dicts would be empty `{}`, `total_tasks` would be `0`, and `meta.success_rate` would be `0.0` — but this edge case is never explicitly verified. If the backend throws on empty data (e.g., division by zero without the `max()` guard), no test would catch it.

### 10. `cleanTestTasks` race in full-flow.spec.ts (lines 56-101)

The cleanup queries both global and project-scoped endpoints, deduplicates, then deletes. Between the query and the delete, the dispatcher could create new tasks or modify state. The `deleted === 0` early-return on line 100 will bail out even if tasks remain but failed to delete (e.g., blocked by dependency). The correct check should verify `unique.length === 0` rather than `deleted === 0`.

---

## P2 — Medium Severity

### 11. Hard-coded API URLs differ across test files

| File | URL |
|------|-----|
| `console-pages.spec.ts` | `http://localhost:8000/api` |
| `advanced-api.spec.ts` | `http://127.0.0.1:8000` |
| `api-e2e.spec.ts` | `http://127.0.0.1:8000` |
| `full-flow.spec.ts` | `http://localhost:8000/api` |

Mixing `localhost` (may resolve to IPv6 `::1`) and `127.0.0.1` (IPv4 only) is fragile. The `/api` suffix inconsistency means some tests use `${API}/api/tasks` while others use `${API}/tasks`. Should use a single shared constant from playwright config or an environment variable.

### 12. `waitForTimeout` anti-pattern used 15+ times across test suite

`page.waitForTimeout(1000)`, `page.waitForTimeout(2000)`, `page.waitForTimeout(3000)` appear extensively. Playwright docs explicitly warn this causes slow, flaky tests. In stats-related tests, the Dashboard auto-refreshes every 10s (`setInterval(() => load(), 10000)` in dashboard/page.tsx:63) — a 3s `waitForTimeout` has no guarantee the data has loaded. Should use `waitForResponse` or `expect().toBeVisible()` with appropriate timeouts.

### 13. `waitForPage` retry loop swallows all errors (console-pages.spec.ts:20-30)

```ts
} catch {
  await page.waitForTimeout(500);
}
```

All exceptions during the 3-attempt retry (including assertion failures, network errors, wrong page content) are silently discarded. If the page loads with an error screen, the test wastes 45+ seconds before timing out with a generic message that hides the real cause.

### 14. `/api/stats/daily` does not handle empty `created_at` or malformed timestamps (backend/main.py:2092)

```python
created_today = sum(1 for t in data.get("tasks", []) if t.get("created_at", "").startswith(today))
```

If `created_at` is `None` (not string), `str(t.get("completed_at", "")).startswith(today)` handles it via `str(None)` -> `"None"` which won't match. But `t.get("created_at", "")` returns the actual `None` value (since the key exists but is null), causing `.startswith()` to throw `AttributeError`. The `_ensure_task_shape()` function sets `created_at` on creation, but tasks imported from external sources or corrupted data files could have `None` values. The E2E test never exercises this path.

### 15. Console page tests don't verify stats card **values**, only **labels**

All Dashboard/Dispatch stats card tests only check that labels ("总任务", "待执行", "进行中", "成功率") are visible. They never check that the displayed number corresponds to reality. A Dashboard that shows `总任务: 0` when there are 50 tasks would pass. This is especially problematic for the "成功率" card which involves non-trivial computation.

---

## P3 — Low Severity / Nit-picks

### 16. Screenshot files committed to repository bloat git history

The test suite captures 90+ screenshots (40-160KB each) and commits them. Git stores binary diffs inefficiently, so each test run that changes any visual detail (timestamp, random task ID) will grow the repo. Consider adding `e2e/screenshots/` to `.gitignore` and only generating screenshots in CI artifacts.

### 17. `eslint-disable @typescript-eslint/no-explicit-any` in cleanup functions

Both `cleanTestTasks` (console-pages.spec.ts) and `cleanupAdvTasks` (advanced-api.spec.ts) use `any` types for task objects. Since the `Task` type is defined in `frontend/src/lib/types.ts`, the cleanup functions should import and use it instead of suppressing lint.

### 18. `by_status`/`by_type` aggregation uses `.get()` with default values, masking missing fields

```python
by_status[task.get("status", "pending")] = by_status.get(task.get("status", "pending"), 0) + 1
```

Tasks without a `status` field are silently counted as `"pending"`. Tasks without a `task_type` are counted as `"feature"`. This is a design choice but it means the stats can overcount `pending`/`feature` tasks. Neither the backend logic nor the E2E tests document or validate this behavior.

### 19. Dispatch page stats cards test duplicates Dashboard stats test (console-pages.spec.ts:151-160)

The Dispatch page test checks the same "总任务", "待执行", "进行中" labels as the Dashboard test. Both are pure label-visibility checks with no value assertions. The duplication adds test runtime without additional coverage.

---

## Previously Reported Issues (from task-071 review) — Status Check

| # | Issue | Status |
|---|-------|--------|
| P0-1 | `/api/stats/daily` timezone mismatch | **Still present** (this review P0-2) |
| P0-2 | Stats test tautological assertions | **Still present** (this review P0-1) |
| P0-3 | `waitForPage` error swallowing | **Still present** (this review P2-13) |
| P1-4 | `.first()` masking duplicates | **Still present** (this review P0-3) |
| P1-5 | `success_rate` excludes cancelled tasks | **Still present** (this review P0-4) |
| P1-6 | `cleanTestTasks` race condition | **Still present** (this review P1-10) |
| P1-7 | Console tests don't reset backend state | **Still present** |
| P1-8 | Missing zero-task stats test | **Still present** (this review P1-9) |
| P2-9 | Hard-coded API URLs | **Still present** (this review P2-11) |
| P2-10 | `waitForTimeout` anti-pattern | **Still present** (this review P2-12) |
| P2-11 | Stats endpoint code duplication | **Still present**, elevated to P1 (this review P1-6) |
| P2-12 | Worker card weak else branch | **Still present** |
| P2-13 | Missing error boundary for project context | **Still present** |
| P3-14 | Screenshot bloat | **Still present** (this review P3-16) |
| P3-15 | eslint-disable for `any` types | **Still present** (this review P3-17) |
| P3-16 | Review test has no assertion | **Still present** |
| P3-17 | Fix commit lacks root-cause comment | **Still present** |

**None of the 17 issues from the prior review have been addressed.**

---

## New Issues Not in Prior Review

| # | Severity | Summary |
|---|----------|---------|
| P1-5 | High | `fetchStats` TypeScript type declares phantom `workers_idle` field not returned by backend |
| P1-8 | High | Dashboard recalculates `successRate` client-side, ignoring backend `meta.success_rate` — dead code path |
| P2-14 | Medium | `/api/stats/daily` may throw `AttributeError` on `None` `created_at` values |
| P2-15 | Medium | Stats card tests verify labels but not values — can't detect computation bugs |
| P3-18 | Low | `by_status` aggregation silently maps missing status to "pending" |
| P3-19 | Low | Dispatch page stats test duplicates Dashboard stats test |

---

## Summary

| Severity | Count | Key Themes |
|----------|-------|------------|
| P0       | 4     | Tautological assertions, timezone flake, `.first()` masking, success_rate formula untested |
| P1       | 6     | Type lies, dead code, copy-pasted endpoints, unpredictable counts, race conditions, missing edge cases |
| P2       | 5     | URL inconsistency, `waitForTimeout`, error swallowing, `None` crash, label-only checks |
| P3       | 4     | Screenshot bloat, `any` types, silent defaults, test duplication |

**Overall Assessment**: The E2E test suite for statistics endpoints provides **structural verification** (fields exist, types are correct) but **zero value-correctness verification**. Every stats assertion is of the form `typeof x === "number"` or `x >= 0`, which cannot detect:
- Off-by-one counting errors
- Wrong aggregation keys
- Formula bugs in success rate
- Stale or missing data

The frontend Dashboard independently recalculates success rate from `by_status` data while ignoring the backend-computed `meta.success_rate`, creating an untested divergence path. The `fetchStats` TypeScript return type includes fields the backend never provides (`workers_idle`), creating type-safety lies.

**All 17 issues from the prior task-071 review remain unresolved.**

**Recommendation**:
1. **P0 must-fix before merge**: Add value-correctness assertions to stats tests (assert specific counts after creating known tasks); fix or acknowledge timezone boundary risk.
2. **P1 high-priority**: Extract shared stats aggregation helper; fix `fetchStats` TypeScript type; decide on single source of truth for success rate (backend meta vs frontend calculation).
3. **P2 track**: Consolidate API base URLs; replace `waitForTimeout` with event-based waits.
