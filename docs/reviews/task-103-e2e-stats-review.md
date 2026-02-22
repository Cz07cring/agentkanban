# Adversarial Review: Task-103 E2E-统计测试

**Reviewer:** task-104 (Adversarial Review Worker)
**Target task:** task-103 — E2E-统计测试 (验证 meta 统计)
**Files in scope:**
- `frontend/e2e/api-e2e.spec.ts` — "Meta statistics update correctly" (lines 486-512)
- `frontend/e2e/advanced-api.spec.ts` — "Stats Endpoints" block (lines 929-976)
- `frontend/e2e/multi-project.spec.ts` — "Project-scoped stats reflect only project tasks" (lines 256-270)
- `backend/main.py` — `write_tasks()` meta calculation (lines 206-215), `/api/stats` (lines 2057-2093), `/api/stats/daily` (lines 2096-2104), `/api/projects/{id}/stats` (lines 2485-2521)

**Prior reviews examined:** task-071-review.md (task-073), task-072-e2e-stats-review.md (task-074)

**Methodology:** This review focuses exclusively on correctness, completeness, and adversarial robustness of the statistics-specific test coverage. Issues already fully documented in prior reviews (e.g., `waitForTimeout` anti-pattern, hardcoded API URL) are not repeated unless the statistics tests introduce a new dimension.

---

## Severity Legend
- **P0-Critical**: Test gives false confidence — passes despite real bugs, or can never fail
- **P1-High**: Missing coverage of important stats behavior, or correctness gap
- **P2-Medium**: Fragility, maintainability, or minor correctness concern
- **P3-Low**: Style, naming, and suggestions

---

## P0 — Critical Issues

### 1. `success_rate` test never validates the formula — any value [0, 1] passes
**File:** `api-e2e.spec.ts:508-511`
```typescript
expect(data.meta.success_rate).toBeGreaterThanOrEqual(0);
expect(data.meta.success_rate).toBeLessThanOrEqual(1);
```

The test creates exactly 1 task and marks it `completed`. After this operation, `success_rate` should be exactly `1.0` (1 completed, 0 failed). But the assertion accepts any value in [0, 1]. A backend bug returning `0.0`, `0.5`, or `0.37` would pass. This is a **tautological assertion** — any floating-point value the backend could plausibly return will satisfy it.

**Fix:** Assert `expect(data.meta.success_rate).toBe(1.0)` or at minimum `toBeGreaterThanOrEqual(0.5)` to prove the completed task was counted.

### 2. `total_completed` test is environment-dependent — cannot distinguish its own task
**File:** `api-e2e.spec.ts:509`
```typescript
expect(data.meta.total_completed).toBeGreaterThanOrEqual(1);
```

The `beforeEach` only cleans tasks with `"E2E-"` prefix, but the `GET /api/tasks` endpoint returns **all** tasks (including non-E2E tasks from other test suites or manual usage). `total_completed >= 1` passes whether or not the task created by this test was actually counted. If `write_tasks()` had a bug that skipped updating `total_completed`, the assertion would still pass as long as any other completed task exists in the data file.

**Fix:** Snapshot `total_completed` before creating the task, then verify it increased by exactly 1 afterward:
```typescript
const before = (await (await request.get(`${API}/api/tasks`)).json()).meta.total_completed;
// ... create and complete task ...
const after = (await (await request.get(`${API}/api/tasks`)).json()).meta.total_completed;
expect(after).toBe(before + 1);
```

### 3. `/api/stats` test performs only type-checking — never validates values against known state
**File:** `advanced-api.spec.ts:930-961`
```typescript
expect(typeof data.total_tasks).toBe("number");
expect(data.by_status).toBeDefined();
expect(data.by_type).toBeDefined();
```

The test creates one `ADV-统计测试` task, then checks the stats response contains fields with the right types. It never verifies:
- `total_tasks` actually includes the just-created task
- `by_status.pending` increased by 1
- `by_engine.auto` includes the new task
- `by_priority.medium` includes the new task

A backend that returns `{"total_tasks": 0, "by_status": {}, ...}` (empty stats ignoring all data) would pass this test.

**Fix:** Snapshot counts before task creation, verify delta after:
```typescript
const before = await (await request.get(`${API}/api/stats`)).json();
// create task
const after = await (await request.get(`${API}/api/stats`)).json();
expect(after.total_tasks).toBe(before.total_tasks + 1);
expect(after.by_status.pending).toBe((before.by_status.pending ?? 0) + 1);
```

### 4. No test validates `meta.claude_tasks` and `meta.codex_tasks` engine counters
**File:** `api-e2e.spec.ts:486-512`, `advanced-api.spec.ts:960`

The backend calculates `meta.claude_tasks` and `meta.codex_tasks` in `write_tasks()` (line 214-215), but no test checks these fields. The test at line 960 only asserts `expect(data.meta).toBeDefined()` — an empty `{}` object would satisfy this. If the `routed_engine` field name changed or the counting logic broke, no test would catch it.

---

## P1 — High Severity Issues

### 5. `/api/stats/daily` test has a fundamental correctness gap — `completed_at` may never be set
**File:** `advanced-api.spec.ts:963-975`, `backend/main.py:2101-2102`

The daily stats endpoint counts:
```python
completed_today = sum(1 for t in tasks if t.get("completed_at") and str(t["completed_at"]).startswith(today))
```

But the test only verifies `typeof data.completed === "number"` — it never creates and completes a task and then verifies `completed` increased. If the `completed_at` timestamp is written in a different format (e.g., epoch instead of ISO), or if the `startswith(today)` comparison fails due to timezone offset, the daily stats would silently return `0` forever and the test would still pass.

### 6. Project-scoped stats test (`multi-project.spec.ts:256-270`) relies on fragile exact count
**File:** `multi-project.spec.ts:268-269`
```typescript
expect(stats.total_tasks).toBe(2);
expect(stats.by_status.pending).toBe(2);
```

This test asserts exactly 2 tasks, but the test creates tasks with `"E2E-Stats-1"` and `"E2E-Stats-2"` titles. If the project already contains tasks from a prior failed test run (cleanup didn't work), the count will exceed 2. Conversely, if the prior test in the same `describe` block (project task CRUD, line 195-253) left a task behind, this breaks. The test relies on perfect isolation from the CRUD test above — a single cleanup failure cascades.

### 7. No test for `success_rate` edge case: zero completed AND zero failed tasks
**Backend:** `main.py:213`
```python
data["meta"]["success_rate"] = round(completed / max(completed + failed, 1), 2)
```

The `max(..., 1)` prevents division by zero, but the result for 0 completed / 0 failed is `0.0`. No test verifies this edge case. If the guard were accidentally changed to `max(completed + failed, 0)`, it would cause a `ZeroDivisionError` in production — but no test would catch it before deployment.

### 8. No test validates stats consistency after task deletion
**All stats tests**

Tests only add tasks and check stats. No test verifies that deleting a task correctly decrements `total_tasks`, `by_status`, or `total_completed`. Since `write_tasks()` recalculates stats on every write, and `DELETE /api/tasks/{id}` calls `write_tasks()`, this should work — but it's an untested assumption. A bug that decrements `by_status` but not `total_tasks` would be invisible.

### 9. No test for stats after status transitions (pending→in_progress→failed)
**All stats tests**

The meta stats test only tests the happy path (pending→in_progress→completed). There is no test for:
- `pending` → `in_progress` → `failed` and verifying `success_rate` decreases
- Multiple tasks with mixed outcomes (2 completed, 1 failed → rate = 0.67)
- Task retried from `failed` back to `pending` — does `success_rate` update?

The `success_rate` formula excludes `in_progress`/`pending` tasks from both numerator and denominator, which is a deliberate design choice — but without tests proving the formula against known inputs, there's no regression protection.

---

## P2 — Medium Severity Issues

### 10. `meta.last_updated` is only checked for truthiness, not temporal ordering
**File:** `api-e2e.spec.ts:508`
```typescript
expect(data.meta.last_updated).toBeTruthy();
```

This accepts any truthy value: `"hello"`, `42`, `true`. It never verifies:
- The value is a valid ISO timestamp
- The timestamp is recent (within the last few seconds)
- The timestamp is newer than a previous read

### 11. Stats test in `advanced-api.spec.ts` doesn't verify engine stats match worker data
**File:** `advanced-api.spec.ts:953-958`

The test checks `engines.claude.workers_total` is a number, but never verifies it equals the actual worker count from `GET /api/workers`. Since engine stats are calculated at request time from the in-memory `WORKERS` list, and worker counts can change between requests, this is technically non-deterministic — but the test should at least cross-reference `GET /api/workers` to validate consistency.

### 12. Cleanup pollution — meta stats test creates `"E2E-统计测试"` but `beforeEach` cleans ALL `"E2E-"` tasks
**File:** `api-e2e.spec.ts:10-17, 486-512`

The `beforeEach` hook deletes all tasks with `"E2E-"` prefix before each test. This means previous tests' completed tasks are deleted, potentially changing `total_completed` and `success_rate`. The meta stats test reads stats *after* `beforeEach` deleted prior tasks, so the baseline is unpredictable. The test might read stale meta data if `write_tasks()` was not triggered by the cleanup deletions (depends on whether `DELETE` endpoint calls `write_tasks`).

### 13. `/api/stats/daily` timezone test has a race window near midnight
**File:** `advanced-api.spec.ts:972-974`

This was noted in prior reviews but bears emphasis: the test constructs `today` in the test process and compares against the server's UTC date. If the test straddles midnight UTC, the dates will differ. The stats tests have no time-mocking mechanism, making this an unavoidable intermittent failure in CI.

### 14. `/api/stats` and `/api/projects/{id}/stats` are 100% copy-pasted — no shared function
**File:** `backend/main.py:2057-2093` vs `2485-2521`

These are 37 lines of identical aggregation logic. If one is fixed (e.g., to handle a new status like `"cancelled"`), the other will be silently wrong. The tests for each endpoint are also separately written with different assertion styles — `advanced-api.spec.ts` does type-checks, while `multi-project.spec.ts` does exact value checks — making bug detection inconsistent.

### 15. No negative tests for malformed stats queries
**All stats tests**

No test verifies behavior for:
- `GET /api/stats/daily?date=2025-01-01` (if date parameter were added)
- `GET /api/projects/nonexistent/stats` (should return 404, untested)
- `GET /api/stats` when `dev-tasks.json` is corrupted or missing

---

## P3 — Low Severity / Suggestions

### 16. Stats test names don't describe expected behavior
Test names like `"GET /api/stats returns comprehensive statistics"` describe the HTTP call, not the behavior under test. Better: `"Stats reflect newly created task in by_status and total_tasks counts"`.

### 17. Engine health in stats is hardcoded to in-memory state
The `engines.claude.healthy` and `engines.codex.healthy` values come from the `ENGINE_HEALTH` dict (in-memory, not persisted). If the backend restarts, all engines reset to healthy. No test verifies this recovery behavior or tests stats after an engine health change.

### 18. `by_engine` defaults are inconsistent with task creation
Backend defaults `routed_engine` to `"auto"` in stats aggregation (line 2070: `task.get("routed_engine") or "auto"`), but task creation doesn't set `routed_engine` — it's set later by the dispatcher. Tasks that were never dispatched show up as `"auto"` in stats, which is misleading. No test distinguishes between `engine: "auto"` (user-requested) and `routed_engine: None` (not yet dispatched).

---

## Summary

| Severity | Count | Key Themes |
|----------|-------|------------|
| P0       | 4     | Tautological assertions that accept any value, untested engine counters |
| P1       | 5     | Missing coverage for failure paths, deletion, edge cases |
| P2       | 6     | Stale data risk, copy-pasted backend, timezone fragility |
| P3       | 3     | Naming, defaults, recovery behavior |

**Overall Assessment:** The statistics E2E tests provide **structural validation** (fields exist, types are correct) but lack **semantic validation** (values are correct for known inputs). The core problem is that no test creates a controlled scenario with known task counts and verifies the stats match those exact counts. Every assertion uses `toBeDefined()`, `toBeGreaterThanOrEqual(0)`, or `typeof === "number"` — patterns that can never fail in practice. A backend returning static dummy data would pass the entire stats test suite.

**Recommendation:** P0 issues #1-#3 represent tests that provide false confidence and should be strengthened before the test suite can be trusted for regression detection. The highest-impact fix is introducing before/after delta assertions so that each test verifies the *effect* of its own actions on the stats, rather than checking ambient system state.

---

*Review generated by task-104 adversarial review worker*
