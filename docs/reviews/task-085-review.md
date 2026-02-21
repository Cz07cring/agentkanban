# Adversarial Code Review: task-085 (E2E-统计测试)

**Reviewer**: task-086 (automated adversarial review)
**Prior review**: task-071-review.md (reviewed by task-073)
**Scope**: Re-review of statistics-related E2E tests, focusing on issues NOT fixed since task-071 review, NEW issues found, and cross-cutting concerns between frontend/backend statistics.

**Files in scope**:
- `frontend/e2e/advanced-api.spec.ts` — Stats Endpoints (lines 929-976)
- `frontend/e2e/api-e2e.spec.ts` — Meta statistics test (lines 486-512)
- `frontend/e2e/console-pages.spec.ts` — Dashboard statistics UI (lines 85-170)
- `frontend/e2e/full-flow.spec.ts` — Kanban board stats area (line 208)
- `frontend/src/app/(console)/dashboard/page.tsx` — Dashboard stats component
- `frontend/src/lib/api.ts` — `fetchStats` type definition (lines 217-237)
- `backend/main.py` — `/api/stats`, `/api/stats/daily`, `write_tasks` meta (lines 198-215, 2048-2097)

---

## Severity Legend
- **P0-Critical**: False passes, data correctness, or test flakiness
- **P1-High**: Logic errors, missing coverage, or API contract violations
- **P2-Medium**: Maintainability, correctness gaps, or robustness
- **P3-Low**: Nit-picks and suggestions

---

## P0 — Critical Issues

### 1. Frontend `fetchStats` expects `workers_idle` — backend never returns it

**File**: `frontend/src/lib/api.ts:228`, `backend/main.py:2077-2082`

The `fetchStats` return type declares:
```ts
engines: Record<string, {
  healthy: boolean;
  workers_total: number;
  workers_busy: number;
  workers_idle: number;    // <-- expected
  total_completed?: number; // <-- expected
}>
```

But the backend `/api/stats` endpoint only returns:
```python
{
    "healthy": ENGINE_HEALTH["claude"],
    "workers_total": ...,
    "workers_busy": ...,
    # NO workers_idle, NO total_completed
}
```

**Impact**: The `EngineCard` component in `dashboard/page.tsx:251` accesses `stats?.workers_idle` and `stats?.total_completed` — these will always be `undefined`, rendering `0` via `?? 0`. The UI silently shows wrong data. **No E2E test catches this because no test asserts the actual numeric values displayed in the engine cards.** The console-pages test at line 123 only checks `page.getByText(/活跃/).first().toBeVisible()` — it never validates the number.

**Fix**: Backend should return `workers_idle` (computed as `workers_total - workers_busy`) and `total_completed` in the stats response, OR the frontend type should mark them truly optional and tests should validate the rendered numbers.

### 2. Dashboard `successRate` calculation differs from backend `meta.success_rate`

**File**: `frontend/src/app/(console)/dashboard/page.tsx:72-80`, `backend/main.py:213`

The frontend calculates success rate from `stats.by_status`:
```ts
const successRate = Math.round(
  (completed / (completed + failed)) * 100
);
```

The backend calculates `meta.success_rate` in `write_tasks`:
```python
data["meta"]["success_rate"] = round(completed / max(completed + failed, 1), 2)
```

These are **two independent calculations of the same metric** with subtle differences:
- Frontend uses `by_status` from the current `/api/stats` response (which includes ALL tasks including E2E leftovers)
- Backend uses `meta.success_rate` which is persisted to disk on every `write_tasks` call
- Frontend result is an integer percentage (0-100), backend is a float ratio (0.0-1.0)
- When `completed + failed == 0`, frontend returns `0`, backend returns `0` (via `max(..., 1)`)

**Impact**: The `api-e2e.spec.ts:508-509` test asserts `meta.success_rate >= 0 && <= 1` but the dashboard shows a DIFFERENT number. A user seeing "成功率 75%" on the dashboard while the API returns `meta.success_rate: 0.67` would be confused. No test validates consistency between these two sources.

### 3. Stats test `total_tasks` assertion is tautological (STILL UNFIXED from task-071 review)

**File**: `frontend/e2e/advanced-api.spec.ts:947`

```ts
expect(typeof data.total_tasks).toBe("number");
```

This was flagged as P0 in task-071 review (issue #2) and remains unfixed. The test creates one task (`ADV-统计测试`) but never asserts `total_tasks >= 1`. The assertion `typeof === "number"` passes even if the backend returns `total_tasks: -1` or `total_tasks: NaN`. This is a false-confidence test.

---

## P1 — High Severity

### 4. `/api/stats/daily` has no E2E test for created/completed count correctness

**File**: `frontend/e2e/advanced-api.spec.ts:963-975`

The daily stats test only checks:
```ts
expect(typeof data.created).toBe("number");
expect(typeof data.completed).toBe("number");
```

It creates NO tasks, so both values are whatever the current database state is. A proper test should:
1. Record baseline counts
2. Create a task (verifying `created` increments by 1)
3. Complete the task (verifying `completed` increments by 1)

Without this, the test cannot detect if the daily stats counting logic is broken.

### 5. `by_status`/`by_type`/`by_engine`/`by_priority` aggregations are not validated

**File**: `frontend/e2e/advanced-api.spec.ts:948-951`

```ts
expect(data.by_status).toBeDefined();
expect(data.by_type).toBeDefined();
expect(data.by_engine).toBeDefined();
expect(data.by_priority).toBeDefined();
```

These only check the keys exist (not `null`/`undefined`). They never check:
- That the values are correct counts
- That the keys match valid status/type/engine/priority values
- That the sum of `by_status` values equals `total_tasks`
- That creating a `pending` task increments `by_status.pending`

A backend bug that returns `by_status: { "pending": 999999 }` would pass all tests.

### 6. Backend `/api/stats` counts tasks with missing fields using defaults, tests don't cover this

**File**: `backend/main.py:2060-2064`

```python
by_status[task.get("status", "pending")] = ...
by_type[task.get("task_type", "feature")] = ...
by_priority[task.get("priority", "medium")] = ...
```

If a task has no `status` field (data corruption), it counts as `pending`. If it has no `task_type`, it counts as `feature`. No test creates a task with missing fields to verify this fallback behavior. While defensive, this silently masks data integrity issues.

### 7. Dashboard statistics UI test never verifies actual numbers

**File**: `frontend/e2e/console-pages.spec.ts:93-100`

The test checks:
```ts
await expect(page.getByText("总任务").first()).toBeVisible();
await expect(page.getByText("待执行").first()).toBeVisible();
await expect(page.getByText("进行中").first()).toBeVisible();
await expect(page.getByText("成功率").first()).toBeVisible();
```

It checks that label text exists but NEVER verifies the values. A dashboard showing "总任务: -1" or "成功率: NaN%" would pass. The test should create a known set of tasks, navigate to dashboard, and assert the displayed numbers match expectations.

### 8. Project-scoped `/api/projects/{id}/stats` has zero test coverage

**File**: `backend/main.py:2476-2515`

The project-scoped stats endpoint is a 40-line copy-paste of `/api/stats` (this was noted as P2-11 in task-071 review). Neither `console-pages.spec.ts` nor `advanced-api.spec.ts` tests the project-scoped stats endpoint. Given the dashboard uses `fetchStats(pid)` which routes to the project endpoint when `pid` is set, this is a significant coverage gap.

---

## P2 — Medium Severity

### 9. Stats engine section doesn't include `workers_idle` but frontend EngineCard renders it

**File**: `frontend/src/app/(console)/dashboard/page.tsx:251`

The `EngineCard` component accepts `workers_idle?: number` and `total_completed?: number` in its type but the backend never provides them. While TypeScript marks them optional (`?`), this means the "已完成" row in the EngineCard always shows `0`. No E2E test validates this rendering behavior, so a user would see misleading "已完成: 0" for engines that have completed many tasks.

### 10. `meta.success_rate` is stale if `read_tasks` is called without a subsequent `write_tasks`

**File**: `backend/main.py:198-215`

`meta.success_rate` is only recalculated in `write_tasks`. The `/api/stats` endpoint calls `read_tasks` but never `write_tasks`, so the `meta` section in the stats response reflects the state at the last write, not the current state. If tasks were modified by another process (e.g., direct file edit), `meta` would be stale. The E2E test doesn't cover this scenario, but it's a latent bug.

### 11. Stats tests don't clean up after themselves independently

**File**: `frontend/e2e/advanced-api.spec.ts:929-961`

The "Stats Endpoints" test block relies on the file-level `beforeEach` to clean `ADV-` prefixed tasks. But after the stats test creates `ADV-统计测试` and finishes, if the next test in the same `describe` block queries stats, it may see leftover data. This isn't a problem TODAY because the stats test is the last block, but it's fragile against reordering.

### 12. `api-e2e.spec.ts` meta test doesn't verify `claude_tasks`/`codex_tasks` in meta

**File**: `frontend/e2e/api-e2e.spec.ts:486-512`

The backend `write_tasks` calculates and persists `meta.claude_tasks` and `meta.codex_tasks`, but no E2E test ever asserts these values. Since the dashboard doesn't display them either, this is dead data in the meta — but if any consumer relies on it, there's zero regression protection.

### 13. Console-pages Dashboard test `ensureEnginesHealthy` doesn't reset workers

**File**: `frontend/e2e/console-pages.spec.ts:89-91`

The Dashboard test `beforeEach` calls `ensureEnginesHealthy` (which only resets engine health flags) but doesn't reset worker statuses to idle. If a previous test left workers in `busy` state, the "活跃" count on the Dashboard will be non-zero, and the EngineCard would show unexpected worker distributions. This was flagged as P1-7 in task-071 review and remains unfixed.

---

## P3 — Low Severity

### 14. Dispatch page also shows statistics cards with same labels as Dashboard

**File**: `frontend/e2e/console-pages.spec.ts:188-195`

Both Dashboard and Dispatch pages show "总任务", "待执行", "进行中" cards. The Dispatch page test checks these same labels but from a different page implementation. If the Dispatch page's stats came from a different data source (e.g., dispatcher queue vs `/api/stats`), the numbers could diverge. No test compares them for consistency.

### 15. `full-flow.spec.ts` screenshot `01-page-layout-columns-stats` asserts stats area exists but no values

**File**: `frontend/e2e/full-flow.spec.ts:208`

The screenshot name suggests stats verification, but the test only checks that column headings exist and takes a screenshot. The "stats" in the screenshot name refers to the task count indicator (`page.getByText(/个任务/)`), which is just a summary string, not the detailed statistics cards.

### 16. Stats `by_engine` can accumulate "auto" entries that are misleading

**File**: `backend/main.py:2063`

```python
eng = task.get("routed_engine") or "auto"
```

If `routed_engine` is an empty string (not `None`), `or "auto"` would catch it. But if `routed_engine` is `"auto"` itself (which shouldn't happen since auto-routing resolves to claude/codex), it would count as "auto" in stats. No test verifies that `by_engine` never contains "auto" after tasks are created with `engine: "auto"`.

---

## Cross-Cutting Concerns

### A. Frontend-Backend statistics contract mismatch

The frontend `fetchStats` TypeScript type (api.ts:217-237) declares fields (`workers_idle`, `total_completed`) that the backend never returns. This is a contract violation that TypeScript's structural typing silently accepts because the fields are marked optional (`?`). An OpenAPI schema or shared type definition would catch this.

### B. Dual success-rate calculation creates divergence risk

The system has TWO independent success rate calculations:
1. `meta.success_rate` in `write_tasks` (persisted, ratio 0-1)
2. `successRate` in `dashboard/page.tsx` (computed client-side, integer 0-100)

Neither the E2E tests nor any integration test verifies these produce consistent results. If the backend formula changes (e.g., to include cancelled tasks), the frontend would show a different number.

### C. Statistics tests provide breadth but no depth

All statistics E2E tests follow the pattern: create data → call endpoint → check types exist. None follow: create KNOWN data → call endpoint → assert EXACT values. This means the tests verify the API schema but not the computation logic.

---

## Comparison with task-071 Review

| task-071 Issue | Status | Notes |
|---|---|---|
| P0-1: Timezone mismatch in daily stats | **UNFIXED** | Still uses `new Date().toISOString()` |
| P0-2: Tautological stats assertions | **UNFIXED** | Still `typeof === "number"` |
| P0-3: Error swallowing in waitForPage | **UNFIXED** | Still catches all exceptions |
| P1-4: Fragile `.first()` selectors | **UNFIXED** | Still used extensively |
| P1-5: success_rate formula edge case | **UNFIXED** | Still excludes cancelled/reviewing |
| P1-7: Console tests don't reset workers | **UNFIXED** | Dashboard tests still affected |
| P1-8: Missing zero-task stats test | **UNFIXED** | Still no empty-state stats test |
| P2-9: Hard-coded API URLs | **UNFIXED** | Still mixed localhost/127.0.0.1 |
| P2-10: waitForTimeout anti-pattern | **UNFIXED** | Still used in 10+ places |
| P2-11: Duplicated stats code | **UNFIXED** | project-scoped is copy-paste |

**None of the 17 issues from the task-071 review have been addressed.** This review identified 5 additional NEW issues (P0-1 workers_idle, P0-2 dual success rate, P1-4 daily stats correctness, P1-8 project-scoped coverage, P2-9 EngineCard rendering).

---

## Summary

| Severity | Count | Key Themes |
|----------|-------|------------|
| P0       | 3     | API contract mismatch, dual success rate, tautological assertions |
| P1       | 5     | No value validation, missing daily/project stats coverage, stale worker state |
| P2       | 5     | Dead meta fields, stale meta, no test isolation, missing engine validation |
| P3       | 3     | Duplicate stats cards, misleading screenshot name, "auto" engine leak |

**Overall Assessment**: The statistics E2E tests provide **schema-level validation** (fields exist, types are correct) but offer **zero computation-level validation** (values are correct, counts match reality). The most critical new finding is the **frontend-backend contract mismatch** where `workers_idle` and `total_completed` are expected but never provided, causing the Dashboard EngineCard to permanently display "0" for completed tasks per engine. Combined with the 10 unfixed issues from the task-071 review, the statistics test suite has significant gaps that allow regressions to ship undetected.

**Recommendation**: The P0 issues (especially #1 contract mismatch and #2 dual calculation) should be addressed before this code is considered production-ready. The tautological assertion pattern across all stats tests should be replaced with value-based assertions using controlled test data.
