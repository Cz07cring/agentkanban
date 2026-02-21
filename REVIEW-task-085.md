# Adversarial Review: task-085 (E2E-统计测试)

**Reviewer**: Worker-2 (task-086)
**Scope**: 4 E2E test files + related backend endpoints on `main` branch
- `frontend/e2e/api-e2e.spec.ts` (21 tests)
- `frontend/e2e/advanced-api.spec.ts` (44 tests)
- `frontend/e2e/full-flow.spec.ts` (26 tests)
- `frontend/e2e/console-pages.spec.ts` (30 tests)
- `backend/main.py` (stats, events, task lifecycle endpoints)

---

## CRITICAL Issues

### C1: Race condition — file-based storage without read-modify-write atomicity
**File**: `backend/main.py` (read_tasks / write_tasks pattern)
**Severity**: critical

Every API endpoint follows the pattern `read_tasks() → mutate → write_tasks()`. The `FileLock` only guards the individual read or write operation, NOT the full read-modify-write cycle. Two concurrent requests can:
1. Both read the same state
2. Both mutate independently
3. The second writer overwrites the first writer's changes (lost update)

This is especially dangerous for `update_task`, `claim_task`, `fail_task`, and `complete_task` which all mutate shared state. The E2E tests run sequentially so they don't catch this, but any production deployment with concurrent requests will lose data.

**Recommendation**: Wrap the entire read → mutate → write cycle in a single `FileLock` acquisition, or switch to a proper database.

### C2: Meta statistics `success_rate` can silently become inaccurate
**File**: `backend/main.py:207-216` (write_tasks)

`success_rate` is computed as `completed / max(completed + failed, 1)`. However, tasks in `reviewing`, `cancelled`, or `blocked_by_subtasks` status are excluded from both numerator and denominator. If a user cancels many tasks, the success rate stays artificially high. The E2E test (`api-e2e.spec.ts` "Meta statistics update correctly") only checks `>= 0` and `<= 1` — it never verifies the actual computed value is correct given the known task states.

### C3: `update_task` silently increments retry_count on any `status=failed` PATCH
**File**: `backend/main.py:1304-1305`

```python
elif new_status == "failed":
    task["retry_count"] = min(task.get("retry_count", 0) + 1, task.get("max_retries", 3))
```

Every PATCH that sets `status=failed` increments `retry_count`, even a manual status change from the UI. This means clicking "failed" in the detail panel eats a retry. The E2E test in `api-e2e.spec.ts` ("Task failure and retry lifecycle") doesn't detect this because it only PATCHes once to "failed". Combined with the `_fail_task_internal` also incrementing `retry_count`, a single execution failure can increment the counter TWICE if both paths execute.

---

## HIGH Issues

### H1: `cleanTestTasks` in `full-flow.spec.ts` uses both global and project-scoped endpoints — cleanup may silently fail
**File**: `frontend/e2e/full-flow.spec.ts:26-69`

The cleanup tries `${API}/tasks` and `${API}/projects/proj-default/tasks`, iterating up to 5 passes. If the backend returns an error on the project-scoped endpoint (e.g., project doesn't exist yet), the `catch {}` swallows it silently. Leftover tasks from previous runs will pollute subsequent tests.

### H2: `waitForPage` retry logic can mask real failures
**File**: `frontend/e2e/console-pages.spec.ts:22-31`

The function retries 3 times with a blank `catch {}`, then does a final attempt with a 30-second timeout. A page that intermittently fails to load (e.g., backend crash) will be retried silently, and the test may pass on the 4th try, hiding a real bug. The test reports "green" but the system was flaky.

### H3: `waitForTimeout` anti-pattern used extensively
**Files**: Multiple locations across all 4 test files

`page.waitForTimeout(1000)`, `waitForTimeout(2000)`, `waitForTimeout(3000)` are used 15+ times across the test suite. This is a well-known Playwright anti-pattern that:
- Makes tests slow (unnecessary waits)
- Makes tests flaky (timeouts may be too short on slow CI)
- Should be replaced with `waitForSelector`, `waitForResponse`, or `expect(...).toBeVisible()` with appropriate timeouts

### H4: `api-e2e.spec.ts` "Frontend proxy" test hardcodes `http://127.0.0.1:3000`
**File**: `frontend/e2e/api-e2e.spec.ts` (last test)

The test directly hits `http://127.0.0.1:3000` instead of using the configured `baseURL`. If the frontend runs on a different port in CI, this test will fail with a misleading error.

### H5: `advanced-api.spec.ts` `beforeEach` resets ALL 5 workers to idle globally
**File**: `frontend/e2e/advanced-api.spec.ts:66-74`

Every test in the advanced-api suite PATCHes all 5 workers to `idle`. This mutates global in-memory state and can interfere with other test suites running in parallel (though the config disables parallelism). More importantly, if a real worker is executing in a concurrent deployment, this test will forcibly steal its status.

### H6: No test for task ID collision / overflow
**File**: `backend/main.py:325-333` (gen_task_id)

`gen_task_id` scans all tasks and picks `max_num + 1`. If task IDs are non-contiguous (e.g., tasks were deleted), IDs can collide with IDs in `depends_on` or `sub_tasks` references of deleted-but-still-referenced tasks. No E2E test covers this edge case.

### H7: `daily_stats` timezone mismatch with clients
**File**: `backend/main.py:2088-2096`

`get_daily_stats` uses `datetime.now(timezone.utc).date()` to determine "today", but task `created_at` timestamps include timezone info as ISO strings. The `startswith(today)` comparison works for UTC but will miss tasks created in UTC+8 (China) that fall on the previous UTC date. E2E test only checks `data.date === today` using `new Date().toISOString().split("T")[0]` — JavaScript's `Date` uses the local timezone for `.toISOString()` which is always UTC, so the test passes, but the behavior is wrong for real users.

---

## MEDIUM Issues

### M1: Screenshots committed to git — binary bloat
**File**: `frontend/e2e/screenshots/pages/*.png` (30+ files)

30+ PNG screenshots are committed to the repository on every test run. These binaries add ~3MB per commit and will grow with each E2E change. Screenshots should be treated as CI artifacts (uploaded to artifact storage), not committed to the repo.

### M2: `console-pages.spec.ts` tests are brittle — rely on exact Chinese text
**File**: `frontend/e2e/console-pages.spec.ts` (throughout)

Tests assert on exact Chinese strings like `"自动调度、执行与审计总览"`, `"队列、阻塞与引擎故障转移监控"`, etc. Any copy/text change will break multiple tests. Consider using `data-testid` attributes for structural assertions and keeping text assertions minimal.

### M3: `ensureReviewTask` helper has fragile error handling
**File**: `frontend/e2e/advanced-api.spec.ts:38-63`

If the POST `/review` returns neither 200 nor 409, the function falls through to a `.find()` that may return `undefined`, and then `expect(reviewTask).toBeDefined()` fails with a confusing error message. The function should explicitly handle unexpected status codes.

### M4: Missing negative test — PATCH with invalid status transition
No test verifies that transitioning from `completed` → `in_progress` is rejected (or not). The backend currently allows ANY status transition via PATCH, which means tests could set any arbitrary status. If business rules should restrict transitions (e.g., completed tasks can't go back to in_progress), there's no test enforcing it.

### M5: `events` array grows unbounded per test run
**File**: `backend/main.py:440-441`

Events are capped at 2000 entries, but there's no cleanup between tests. If the test suite runs many times on the same data file, the events array fills up and older events (which tests may depend on) get evicted. The `api-e2e.spec.ts` only cleans up tasks, not events.

### M6: `_decompose_from_plan` creates up to 8 sub-tasks with predictable IDs
**File**: `backend/main.py:518-546`

Sub-task creation uses `gen_task_id(data)` in a loop. Since `gen_task_id` scans the data each time, it correctly increments. However, if two concurrent plan approvals run, sub-task IDs can collide due to the TOCTOU race in C1.

### M7: No CSRF protection on state-mutating endpoints
All POST/PATCH/DELETE endpoints accept requests without any CSRF token. The CORS middleware allows all headers (`allow_headers=["*"]`). While the E2E tests use the Playwright request API which bypasses CORS, a malicious page could make cross-origin requests to the backend if it runs on the same machine.

---

## LOW Issues

### L1: `any` type used in test helpers
**Files**: All 4 test files use `(task: any)`, `(data: any)`, etc.

TypeScript's `any` type defeats type checking. Consider defining lightweight interfaces for Task, Worker, Event responses.

### L2: Magic strings for statuses and priorities
Tests repeat string literals like `"pending"`, `"in_progress"`, `"completed"`, `"failed"` without a shared enum. A typo in a test assertion (`"compelted"`) would silently pass if the backend also has a typo.

### L3: No test for WebSocket reconnection
The full-flow test checks that WebSocket is "在线", but doesn't test what happens when the connection drops and reconnects. The frontend `createRealtimeChannel` should handle reconnection gracefully.

### L4: `console-pages.spec.ts` Settings test modifies global engine health
The "引擎健康开关可切换" test toggles engine health and restores it. If the test fails mid-execution, the engine remains in an unhealthy state, potentially breaking subsequent tests. The `afterEach` hook calls `ensureEnginesHealthy` which helps, but only for tests in the same describe block.

---

## Summary

| Severity | Count | Key Themes |
|----------|-------|------------|
| Critical | 3 | File-based race condition, silent stats inaccuracy, double-increment bug |
| High | 7 | Test isolation, waitForTimeout anti-pattern, timezone bugs, hardcoded URLs |
| Medium | 7 | Binary bloat, brittle text assertions, missing negative tests, CSRF |
| Low | 4 | TypeScript `any`, magic strings, reconnection coverage |

**Overall Assessment**: The E2E test suite is comprehensive in coverage (145 tests across 4 files, covering API, UI, dispatcher, review, events, stats). The test organization is well-structured with proper setup/teardown. However, the tests have several architectural weaknesses:

1. They don't test concurrent access, which is where the most severe backend bugs hide
2. Excessive use of `waitForTimeout` makes the suite slow and potentially flaky
3. Screenshot binaries in git is a scaling concern
4. Several backend bugs (race conditions, double retry_count increment, timezone mismatch) are not caught because the tests run sequentially and in UTC

**Recommendation**: Address C1 (race condition) and C3 (double increment) as priority fixes. Replace `waitForTimeout` calls with proper Playwright waiters. Move screenshots to CI artifact storage.
