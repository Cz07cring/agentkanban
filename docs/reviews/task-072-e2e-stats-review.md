# Adversarial Review: Task-072 E2E 统计测试

**Reviewer:** task-074 (Adversarial Review Worker)
**Reviewed Code:** E2E test suite on `main` branch
**Files Reviewed:**
- `frontend/e2e/full-flow.spec.ts` (593 lines)
- `frontend/e2e/api-e2e.spec.ts` (583 lines)
- `frontend/e2e/advanced-api.spec.ts` (1393 lines)
- `frontend/e2e/console-pages.spec.ts` (559 lines)
- `frontend/playwright.config.ts` (45 lines)
- `backend/main.py` (API endpoints, cross-referenced)

**Verdict: BLOCK — 12 CRITICAL, 13 HIGH issues found across the test suite**

---

## Executive Summary

The E2E test suite provides broad coverage (145+ tests across 4 spec files), but suffers from systemic quality issues that undermine test reliability and trustworthiness:

1. **Vacuous assertions** — At least 5 tests pass with zero meaningful assertions executed
2. **Silent error swallowing** — Cleanup functions catch and discard all errors, masking state pollution
3. **Hardcoded sleeps** — 15+ instances of `waitForTimeout` causing flakiness
4. **Missing response status checks** — 20+ API calls proceed without verifying HTTP status
5. **Test isolation failures** — Engine health, worker state, and events leak between tests

| Severity | Count |
|----------|-------|
| CRITICAL | 12    |
| HIGH     | 13    |
| MEDIUM   | 25    |
| LOW      | 15    |

---

## CRITICAL Issues (Must Fix)

### C-01: Vacuous assertion — always passes
**File:** `console-pages.spec.ts:183`
```typescript
const count = await taskItems.count();
expect(count).toBeGreaterThanOrEqual(0); // count() always >= 0
```
A `count()` call can never return < 0. This assertion provides zero validation.

### C-02: `waitForPage` ignores heading text in retry loop
**File:** `console-pages.spec.ts:17-30`
```typescript
for (let attempt = 0; attempt < 3; attempt++) {
  await page.goto(url, { ... });
  await page.waitForSelector("h1", { timeout: 15000 });
  return; // Never checks headingText!
}
```
The `headingText` parameter is only used in the fallback path. Tests can "pass" while on the wrong page.

### C-03: Silent error swallowing in `cleanTestTasks`
**File:** `full-flow.spec.ts:27-73`
```typescript
} catch {
  // ignore fetch errors
}
```
If the backend is down or returning malformed JSON, cleanup silently fails. All subsequent tests run against polluted data, producing either false positives or confusing failures with no diagnostics.

### C-04: Dual-storage scope mismatch (global vs project-scoped APIs)
**File:** `full-flow.spec.ts:299-352`
Tests 17-20 use `POST /api/tasks` (global endpoint), but `cleanTestTasks` and UI-based tests use `POST /api/projects/proj-default/tasks` (project-scoped endpoint). These write to **different files** on the backend. Tasks created by one path are invisible to the other, causing phantom test data.

### C-05: Tests pass with zero assertions executed (vacuous test pattern)
**File:** `advanced-api.spec.ts:187-198`
```typescript
if (res.status() === 404) {
  // assertions here
}
// NO else, NO fail() — test passes silently if condition is false
```
Same pattern at `advanced-api.spec.ts:1039-1069` (event ack test) and `console-pages.spec.ts:245-260` (worker cards).

### C-06: Race condition — `cleanTestTasks` has no delay between retry passes
**File:** `full-flow.spec.ts:27-73`, `console-pages.spec.ts:59-73`
The cleanup loops retry up to 5 times with zero delay between passes. If deletion fails due to FileLock contention, immediate retries will fail identically.

### C-07: Hardcoded API URL with no environment variable fallback
**Files:** `api-e2e.spec.ts:7`, `advanced-api.spec.ts:7`, `console-pages.spec.ts:5`
```typescript
const API = "http://127.0.0.1:8000";
```
All API calls go to hardcoded localhost. In CI or Docker environments, this breaks silently.

### C-08: No `afterAll` cleanup — permanent data pollution
**File:** `api-e2e.spec.ts` (entire file)
The file has `beforeEach` but no `afterAll`. If the last test creates tasks, they remain permanently in `dev-tasks.json`. Worker state (status, `consecutive_failures`) is never restored.

### C-09: Plan mode task race condition
**File:** `api-e2e.spec.ts:229`
A `plan_mode: true` task is created and immediately approved. The backend's plan generation coroutine may modify the task between creation and the approve call, causing nondeterministic failures.

### C-10: `beforeEach` cleanup can delete tasks from concurrent test runs
**File:** `api-e2e.spec.ts:10-17`
Cleanup deletes ALL tasks with `"E2E-"` prefix. If multiple test workers run against the same backend, one worker's cleanup deletes another's tasks.

### C-11: 2-second hardcoded sleep masking race condition
**File:** `advanced-api.spec.ts:166`
```typescript
await new Promise((r) => setTimeout(r, 2000));
```
Dispatching a task triggers real async worker execution. A fixed 2s sleep may be too short or too long depending on environment load.

### C-12: Cleanup function gives up silently on delete failures
**File:** `advanced-api.spec.ts:9-36`
```typescript
if (deleted === 0) {
  return; // Gives up without logging what failed
}
```
If dependent tasks prevent deletion, cleanup exits silently, leaving stale data.

---

## HIGH Issues (Should Fix)

### H-01: 15+ hardcoded `waitForTimeout` calls
**Files:** `full-flow.spec.ts:234,373`, `console-pages.spec.ts:124,167,180,229,258,263,268,287,316,322,338,344`
Values range from 500ms to 3000ms. These cause CI flakiness on slow machines and waste time on fast ones.

### H-02: Missing response status checks on 20+ API calls
**Files:** `full-flow.spec.ts:115-125`, `api-e2e.spec.ts:162,175,189`, `advanced-api.spec.ts` (throughout)
```typescript
const res = await request.post(`${API}/api/tasks`, { data: {...} });
const task = await res.json(); // No check for res.ok()!
```
If the API returns 400/500, `task.id` is undefined, causing cascading failures with misleading error messages.

### H-03: Fragile textarea selector
**File:** `full-flow.spec.ts:92-93`
```typescript
const textarea = page.locator("textarea").filter({ hasText: "" }).first();
```
Finds the first empty textarea on the page. If UI changes add another textarea, this silently targets the wrong element. The `hasText("")` filter matches all elements (empty string matches everything).

### H-04: `setAllWorkersStatus` destroys original worker state
**File:** `full-flow.spec.ts:127-142`
Workers are set to "busy" then blindly reset to "idle" in `finally`. Original state is not saved/restored.

### H-05: `Meta+Enter` shortcut only works on macOS
**File:** `full-flow.spec.ts:196`
```typescript
await textarea.press("Meta+Enter");
```
`Meta` maps to Cmd on macOS. On Linux/Windows CI, this keypress does nothing.

### H-06: Test order dependency — serial tests with implicit state coupling
**File:** `full-flow.spec.ts` (entire file uses `test.describe.serial`)
If test N fails, tests N+1 through 26 are skipped. Test 26 has no assertions — just a screenshot relying on prior test state.

### H-07: API tests masquerading as E2E tests
**File:** `full-flow.spec.ts:299-390` (tests 17-23)
Tests 17-20 call APIs directly without UI interaction. Tests 21-23 assert on hardcoded worker counts (`expect(data.workers).toHaveLength(5)`). These belong in a dedicated API test suite.

### H-08: Engine health state leaks between tests
**File:** `advanced-api.spec.ts:1133-1162`
Engine health is set to `false` during testing. If the test fails before restoration, the engine remains unhealthy for all subsequent tests. `beforeEach` does not reset engine health.

### H-09: File size violation — advanced-api.spec.ts at 1393 lines
**File:** `advanced-api.spec.ts`
The project recommends 200-400 line files. At 1393 lines, this file covers 9+ distinct feature areas and should be split.

### H-10: Review test takes screenshot but asserts nothing
**File:** `console-pages.spec.ts:275-291`
Creates a task, patches to completed, triggers review, navigates to reviews page, and... only takes a screenshot. Zero verification that the review renders in the UI.

### H-11: Fragile CSS class assertions
**File:** `console-pages.spec.ts:335-340`
```typescript
await expect(dashLink).toHaveClass(/bg-blue/);
```
Asserting on Tailwind utility class names breaks on any CSS refactoring.

### H-12: Cleanup cannot handle dependency-ordered deletion
**File:** `api-e2e.spec.ts:10-17`
Backend DELETE returns 409 if other tasks reference the target. The cleanup loop has no ordering to delete children before parents.

### H-13: Frontend proxy test assumes port 3000 is running
**File:** `api-e2e.spec.ts:344-357`
Test hits `http://127.0.0.1:3000/api/health` with no guard. Connection refused errors produce unhelpful timeout messages.

---

## MEDIUM Issues (Fix in Follow-up)

### M-01: No negative/error path testing
No tests for empty titles, invalid engine values, invalid status transitions, circular dependencies, XSS payloads, or very long strings.

### M-02: No test for plan approval/rejection UI flow
The plan approval workflow (a core feature) is only tested at API level, never through the UI.

### M-03: No WebSocket test coverage in API test suites
The backend has `/ws/tasks` for real-time updates. Only `full-flow.spec.ts` test 24 touches WebSocket, and that test uses a hardcoded 2s sleep.

### M-04: No concurrent access testing
No tests for simultaneous task claims, concurrent PATCH operations, or race conditions in the file-based storage.

### M-05: No task dependency blocking tests
Backend has `dependencies_satisfied` logic, but no E2E test verifies blocked tasks cannot be started.

### M-06: Pervasive `any` type usage defeats TypeScript strict mode
All spec files use `any` extensively instead of proper Playwright types (`APIRequestContext`) and task interfaces.

### M-07: Daily stats test has timezone fragility
**File:** `advanced-api.spec.ts:963-975`
Uses `new Date().toISOString().split("T")[0]` which is UTC-based — may fail near midnight in non-UTC timezones.

### M-08: `retry_count`/`max_retries` manipulation exposes security gap
**File:** `api-e2e.spec.ts:270-272`
Test directly patches internal fields via unrestricted `for key, value` loop in backend. The API allows arbitrary field overwrites including `id`, `created_at`, etc.

### M-09: `/projects` page entirely untested
The projects page has CRUD operations that are completely untested at the E2E level.

### M-10: `/tasks` page excluded from console-pages without justification
Comment says "full-flow covers it" but if full-flow fails early, tasks page loading is never verified.

### M-11: Conditional test logic creates invisible test gaps
Multiple tests use `if (count > 0) { real assertions } else { trivial fallback }` — real assertions may never execute.

### M-12: DRY violation — task creation payload repeated 30+ times
Same `POST /api/tasks` pattern with minor variations appears across all files. Should extract shared helpers.

### M-13: Inconsistent timeout values (5000, 10000, 15000, 30000ms)
No rationale for different timeouts across similar operations.

### M-14: Screenshot-only tests provide zero regression value
Tests 07, 26 in full-flow.spec.ts, and review test in console-pages.spec.ts have no assertions — only screenshots with no visual regression tool.

### M-15: No mobile/responsive viewport tests
`AppShell.tsx` has explicit mobile behavior (hamburger menu, collapsible sidebar) that is never tested. Playwright config hardcodes 1440x900 desktop viewport.

### M-16: No accessibility assertions
Zero ARIA role/label checks, keyboard navigation tests, or focus management verification.

### M-17: `page.on("dialog")` handler registered too late
**File:** `full-flow.spec.ts:230`
Dialog handler persists for the page lifecycle without removal. Should use `page.once()`.

### M-18: Playwright config has `retries: 0` and `video: "off"`
Zero retries means any transient flakiness causes hard failures. No video means debugging requires screenshot inference.

### M-19: DRY violation in stat card visibility checks
**File:** `console-pages.spec.ts:91-95, 151-155`
Same stat card checking pattern duplicated between Dashboard and Dispatch tests.

### M-20: `.first()` overuse hides element ambiguity
**File:** `console-pages.spec.ts` (20+ instances)
Suppresses strict mode errors when multiple elements match, silently checking the wrong element.

### M-21: Test names hardcode expected counts
`"Workers endpoint returns 5 workers (3 Claude + 2 Codex)"` — test name becomes misleading if config changes.

### M-22: No verification that WebSocket broadcasts are emitted
Backend emits broadcasts for every state change, but no test verifies these are sent correctly.

### M-23: Dispatcher queue test makes weak assertion
**File:** `advanced-api.spec.ts:200-235`
Only checks `expect(blockedChild).toBeDefined()` without verifying `reason` or `task_id` fields.

### M-24: `Weak res.ok()` assertion obscures actual status codes
**File:** `api-e2e.spec.ts` (throughout)
`res.ok()` accepts any 2xx. Doesn't distinguish 200/201/204 — masking REST convention violations.

### M-25: POST used for idempotent read operation
`POST /api/dispatcher/next` without `worker_id` is a read-only query — should be GET per REST conventions.

---

## LOW Issues (Consider Improving)

| # | Issue | File |
|---|-------|------|
| L-01 | Screenshots use relative paths (fragile CWD dependency) | `full-flow.spec.ts:7` |
| L-02 | Inconsistent test naming (mixed Chinese/English) | All files |
| L-03 | `openTaskDetail` uses `.first()` — may match wrong card | `full-flow.spec.ts:77` |
| L-04 | No `afterAll` cleanup in full-flow | `full-flow.spec.ts` |
| L-05 | Task ID dedup may skip same-ID tasks from different stores | `full-flow.spec.ts:43-49` |
| L-06 | No timeout config for long-running API requests | `api-e2e.spec.ts` |
| L-07 | Magic numbers (5200, 5 workers, 3+2 split) | `api-e2e.spec.ts:36-48` |
| L-08 | `ensureReviewTask` defensive logic masks backend bugs | `advanced-api.spec.ts:38-63` |
| L-09 | Magic numbers without explanation (5 passes, 8 subtasks) | `advanced-api.spec.ts:10,276` |
| L-10 | Mixed Chinese/English test names | `advanced-api.spec.ts` |
| L-11 | No cleanup of engine health after mutation | `advanced-api.spec.ts:1133-1162` |
| L-12 | Magic prefix creates coupling between test suites | `console-pages.spec.ts:6` |
| L-13 | Cleanup has no backoff between retry passes | `console-pages.spec.ts:59-73` |
| L-14 | `eslint-disable` suppressing type safety | `console-pages.spec.ts:59` |
| L-15 | No test-run-specific isolation prefix | Multiple files |

---

## Recommended Action Plan

### Phase 1: Fix Critical Test Reliability (Immediate)
1. Replace all vacuous assertions with meaningful checks (C-01, C-05)
2. Fix `waitForPage` to verify heading text in retry loop (C-02)
3. Add error logging to cleanup functions (C-03, C-06, C-12)
4. Standardize on project-scoped API endpoints (C-04)
5. Add response status checks before JSON parsing (H-02)
6. Replace all `waitForTimeout` with proper wait conditions (H-01)

### Phase 2: Fix Test Isolation (Next Sprint)
1. Add `afterAll` cleanup to all spec files (C-08)
2. Reset engine health and worker state in `beforeEach` (H-04, H-08)
3. Use run-specific prefixes to prevent cross-worker interference (C-10)
4. Add environment variable support for API URL (C-07)

### Phase 3: Improve Coverage (Backlog)
1. Add negative/error path tests (M-01)
2. Add plan approval UI flow tests (M-02)
3. Add WebSocket broadcast verification (M-03)
4. Add mobile viewport tests (M-15)
5. Split `advanced-api.spec.ts` into smaller files (H-09)
6. Add accessibility testing (M-16)

---

*Review generated by task-074 adversarial review worker*
