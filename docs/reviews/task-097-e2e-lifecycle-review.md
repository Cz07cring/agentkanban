# Adversarial Review: Task-097 E2E Full Lifecycle Tests

**Reviewer:** task-100 (Adversarial Review Worker)
**Reviewed Code:** E2E test suite on `main` branch
**Files Reviewed:**
- `frontend/e2e/full-flow.spec.ts` (593 lines, 26 tests) — **primary focus**
- `frontend/e2e/api-e2e.spec.ts` (583 lines, 16 tests)
- `frontend/e2e/advanced-api.spec.ts` (1393 lines, 36 tests)
- `frontend/e2e/console-pages.spec.ts` (559 lines, 25 tests)
- `frontend/playwright.config.ts` (45 lines)
- `backend/main.py` (API endpoints, cross-referenced)

**Verdict: BLOCK — 9 CRITICAL, 11 HIGH, 18 MEDIUM issues found**

**Methodology:** Line-by-line analysis with adversarial focus on false-positive tests, data races, isolation violations, assertion completeness, and production-readiness gaps. Cross-references prior reviews (task-072, task-079, task-081) and focuses on **net-new** findings or issues that remain unresolved.

---

## Executive Summary

The E2E suite covers 103+ test cases across 4 spec files, spanning UI Kanban flows, API CRUD/lifecycle, dispatcher logic, review protocol, and console page rendering. While breadth is impressive, the suite has **systemic correctness deficiencies** that make green runs unreliable as quality gates:

1. **False-positive tests** — 6+ tests can pass with zero meaningful assertions executed
2. **Dual-storage split** — Global vs project-scoped API endpoints create phantom data silos
3. **Worker state corruption** — `withManualStateControl` destroys and blindly restores worker state
4. **No afterAll cleanup** — 2 of 4 spec files leak test data permanently
5. **Platform-locked shortcuts** — `Meta+Enter` only works on macOS

| Severity | Count | Net-New vs Prior Reviews |
|----------|-------|--------------------------|
| CRITICAL | 9     | 4 new, 5 confirmed       |
| HIGH     | 11    | 6 new, 5 confirmed       |
| MEDIUM   | 18    | 10 new, 8 confirmed      |
| LOW      | 12    | (not enumerated)         |

---

## CRITICAL Issues (Must Fix Before Merge)

### C-01: Dual-storage API endpoint mismatch causes invisible test data
**File:** `full-flow.spec.ts:107-113` vs `full-flow.spec.ts:299-352`
**Status:** Confirmed from prior reviews — still unfixed

```typescript
// createTaskAPI uses project-scoped endpoint
async function createTaskAPI(page, create, patch) {
  const res = await page.request.post(`${API}/projects/proj-default/tasks`, { data: create });
  // ...
}

// Tests 17-20 use global endpoint directly
const res = await request.post(`${API}/tasks`, { data: {...} });
```

The backend stores project-scoped tasks in `data/proj-default/tasks.json` and global tasks in `data/dev-tasks.json`. Tasks created by tests 17-20 are invisible to `cleanTestTasks()` which only searches both endpoints but may fail to delete from the global store if the project-scoped endpoint returns 404 first and the fallback hits the wrong ID. More critically, the UI only renders project-scoped tasks — global tasks created by tests 17-20 are orphaned and never cleaned up.

**Impact:** Phantom test data accumulates across runs, causing non-deterministic test interactions.

### C-02: `withManualStateControl` blindly resets all workers — destroys real state
**File:** `full-flow.spec.ts:127-142`

```typescript
async function withManualStateControl(page, run) {
  await setAllWorkersStatus(page, "busy");  // Destroys original state
  try {
    await run();
  } finally {
    await setAllWorkersStatus(page, "idle"); // Doesn't restore original
  }
}
```

This function sets **all 5 workers** to "busy" to prevent the dispatcher from auto-claiming tasks during UI tests. However:
- Original worker state (some may be legitimately busy on real tasks) is destroyed
- The `finally` block sets all workers to "idle" regardless of their original state
- If `run()` throws, the test framework may not wait for the `finally` to complete before moving to the next test
- Workers' `current_task_id`, `consecutive_failures`, and `last_seen_at` are not saved/restored

**Impact:** Worker state corruption leaks between serial tests. If test 09 fails, tests 10-12 inherit incorrect worker state.

### C-03: `cleanTestTasks` swallows all errors silently
**File:** `full-flow.spec.ts:24-72`

```typescript
} catch {
  // ignore fetch errors
}
```

If the backend is down, returning 500, or sending malformed JSON, cleanup silently fails. Subsequent tests run against polluted state, producing either false positives or mysterious failures with no diagnostic output. The same pattern appears in `console-pages.spec.ts:59-73`.

**Impact:** Silent data pollution. Failed cleanup is indistinguishable from successful cleanup.

### C-04: `waitForPage` ignores `headingText` parameter in retry path
**File:** `console-pages.spec.ts:17-30`

```typescript
async function waitForPage(page, url, headingText) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForSelector("h1", { timeout: 15000 });
      return; // ← Returns without checking headingText!
    } catch {
      await page.waitForTimeout(500);
    }
  }
  // headingText only used in fallback after 3 failures
}
```

On the fast path (which succeeds 99% of the time), `headingText` is never validated. A test navigating to `/dispatch` could land on `/dashboard` if a redirect occurs, and `waitForPage` would return success because any `<h1>` tag exists.

**Impact:** Tests can pass while viewing the wrong page entirely.

### C-05: Vacuous assertions that always pass
**File:** `console-pages.spec.ts:183`

```typescript
const count = await taskItems.count();
expect(count).toBeGreaterThanOrEqual(0); // count() can never be < 0
```

`Locator.count()` returns a non-negative integer by definition. This assertion provides zero validation. The test is titled "待调度任务区域正确渲染" but doesn't actually verify any rendering correctness.

Additional vacuous patterns:
- `advanced-api.spec.ts:187-198`: Empty else branch — test passes silently when condition is false
- `console-pages.spec.ts:245-260`: Worker card test falls through to trivial assertions when `count === 0`
- `full-flow.spec.ts:146`: Dashboard recent tasks uses `hasTasks || hasEmpty` — always true by exhaustion

### C-06: No `afterAll` cleanup in `api-e2e.spec.ts` and `full-flow.spec.ts`
**File:** `api-e2e.spec.ts`, `full-flow.spec.ts`

Both files have `beforeEach` cleanup but no `afterAll`. If the last test in a run creates tasks, they remain permanently in `dev-tasks.json`. This means:
- Tasks with prefixes `E2E-` and `[E2E]` accumulate across runs
- Worker state modified by `setAllWorkersStatus` is never restored after the suite finishes
- The `api-e2e.spec.ts` file modifies `retry_count`/`max_retries` on line 270 without restoration

**Impact:** Permanent data pollution and non-deterministic test starts.

### C-07: Conditional assertion blocks — tests pass with zero real assertions
**File:** `advanced-api.spec.ts:998-1006`

```typescript
if (data.events.length > 0) {
  const event = data.events[0];
  expect(event.id).toBeTruthy();
  // ... real assertions here
}
// NO else block — test silently passes if events array is empty
```

Same pattern at:
- `advanced-api.spec.ts:1053-1069` (event ack test)
- `console-pages.spec.ts:245-260` (worker card structure — `if (count > 0) {...} else { trivial fallback }`)
- `console-pages.spec.ts:308-314` (review empty state — `if (hasEmpty) {...}` with no else)

**Impact:** Tests can report green while asserting nothing. Coverage metrics are inflated.

### C-08: Race condition in dispatcher `next` test with real execution
**File:** `advanced-api.spec.ts:143-167`

```typescript
const nextRes = await request.post(`${API}/api/dispatcher/next`, {
  data: { worker_id: "worker-0", engine: "claude" },
});
// ...
await new Promise((r) => setTimeout(r, 2000)); // Hardcoded sleep
```

`POST /api/dispatcher/next` with `worker_id` triggers real worker execution in the backend. The 2-second sleep is a race condition:
- On slow machines or CI, the worker may not finish in 2s
- On fast machines, the sleep wastes time
- The `beforeEach` resets workers to "idle", but the dispatched task may still be running from a previous invocation

**Impact:** Non-deterministic test failures in CI. The test measures timing, not correctness.

### C-09: `api-e2e.spec.ts` cleanup can destroy tasks from other test files
**File:** `api-e2e.spec.ts:10-17`

```typescript
test.beforeEach(async ({ request }) => {
  const res = await request.get(`${API}/api/tasks`);
  const data = await res.json();
  for (const task of data.tasks) {
    if (task.title.startsWith("E2E-")) {
      await request.delete(`${API}/api/tasks/${task.id}`);
    }
  }
});
```

This deletes ALL tasks with `E2E-` prefix across the entire backend. While Playwright config uses `workers: 1`, the serial execution order within `test.describe.serial` blocks doesn't guarantee cross-file ordering. If someone adds a new spec file with `E2E-` prefixed tasks, this cleanup will destroy them.

**Impact:** Latent cross-file data destruction. One configuration change (enable parallelism) breaks the entire suite.

---

## HIGH Issues (Should Fix)

### H-01: `Meta+Enter` shortcut only works on macOS
**File:** `full-flow.spec.ts:196`

```typescript
await textarea.press("Meta+Enter");
```

`Meta` maps to Cmd on macOS. On Linux/Windows CI, this keypress does nothing and the task is never submitted. The test would then fail with a confusing "heading not visible" error instead of "wrong keyboard shortcut".

**Recommendation:** Use `page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter")` or test both shortcuts.

### H-02: 15+ hardcoded `waitForTimeout` calls
**Files:** Throughout all spec files

| File | Line(s) | Duration |
|------|---------|----------|
| `full-flow.spec.ts` | 234, 373 | 1000ms, 2000ms |
| `console-pages.spec.ts` | 124, 167, 180, 229, 258, 263, 268, 287, 316, 322, 338, 344, 383 | 500-3000ms |
| `advanced-api.spec.ts` | 166 | 2000ms |

These cause flakiness on slow machines (timeout too short) and waste time on fast machines (unnecessary delay). Replace with `waitForSelector`, `waitForResponse`, or Playwright's auto-waiting.

### H-03: Missing HTTP status checks before JSON parsing
**Files:** `full-flow.spec.ts:115-125`, `api-e2e.spec.ts:89-100`, `advanced-api.spec.ts` (throughout)

```typescript
const res = await request.post(`${API}/api/tasks`, { data: {...} });
const task = await res.json(); // No res.ok() check!
```

If the API returns 400/500, `res.json()` may fail or return an error object. `task.id` becomes `undefined`, causing cascading failures with misleading error messages like "Cannot read property 'id' of undefined" rather than "API returned 500: Internal Server Error".

At least 20+ API calls across the suite lack status checks.

### H-04: Fragile textarea selector relies on element ordering
**File:** `full-flow.spec.ts:92-93`

```typescript
const textarea = page.locator("textarea").filter({ hasText: "" }).first();
```

This finds the first empty textarea on the page. Problems:
- `hasText("")` is a no-op filter — empty string matches everything
- `.first()` suppresses Playwright's strict mode, silently targeting the wrong element if UI changes add another textarea
- A proper selector would use `data-testid` or a more specific locator

### H-05: `page.on("dialog")` handler registered too late and never removed
**File:** `full-flow.spec.ts:230`

```typescript
page.on("dialog", (dialog) => dialog.accept());
```

This registers a permanent dialog handler that persists for the page lifecycle. If a dialog appears in a later test within the serial block, it will be auto-accepted regardless of intent. Should use `page.once("dialog", ...)` instead.

### H-06: Serial test ordering creates cascading skip failures
**File:** `full-flow.spec.ts` (entire file uses `test.describe.serial`)

If test N fails, Playwright skips tests N+1 through 26. Test 26 ("全局看板截图") has zero assertions — it only takes a screenshot. If test 25 fails, the final screenshot is never captured and there's no evidence of the board state.

### H-07: API tests embedded in UI test file
**File:** `full-flow.spec.ts:299-390` (tests 17-23)

Tests 17-23 use `request` directly without page interaction. They test API routing, worker counts, and engine health — pure backend logic that belongs in `api-e2e.spec.ts`. By placing them in a `test.describe.serial` block with UI tests, a UI failure in test 16 causes all API tests to be skipped.

### H-08: Engine health state leaks between tests
**File:** `advanced-api.spec.ts:1133-1162`

```typescript
const offRes = await request.patch(`${API}/api/engines/claude/health`, {
  data: { healthy: false },
});
// ... test logic ...
// Restore at end
const onRes = await request.patch(`${API}/api/engines/claude/health`, {
  data: { healthy: true },
});
```

If the test fails between setting `healthy: false` and the restoration call, the Claude engine remains unhealthy for all subsequent tests. The `beforeEach` in `advanced-api.spec.ts` resets workers but does NOT reset engine health.

### H-09: `advanced-api.spec.ts` is 1393 lines — violates project guidelines
**File:** `advanced-api.spec.ts`

The project CLAUDE.md recommends manageable file sizes. At 1393 lines covering 9+ distinct feature areas (dispatcher, plans, reviews, execution protocol, retry, filtering, stats, events, dependencies), this file should be split into focused modules.

### H-10: Fragile CSS class assertions
**File:** `console-pages.spec.ts:335-340`

```typescript
await expect(dashLink).toHaveClass(/bg-blue/);
```

Asserting on Tailwind CSS utility classes breaks on any CSS refactoring, Tailwind version upgrade, or theme change. Use semantic assertions (e.g., `aria-current="page"`) instead.

### H-11: Hardcoded API URLs with no environment variable fallback
**Files:** All spec files

```typescript
const API = "http://localhost:8000/api";     // full-flow, console-pages
const API = "http://127.0.0.1:8000";         // api-e2e, advanced-api
```

Two different URL formats (with/without `/api` suffix) and no `process.env` fallback. In Docker or CI environments, the backend may run on a different host/port. The inconsistent URL formats also suggest copy-paste errors.

---

## MEDIUM Issues (Fix in Follow-up)

### M-01: No negative/error path testing for UI
No UI tests for:
- Submitting empty task titles (validation error handling)
- XSS payloads in task titles/descriptions
- Very long strings in input fields
- Invalid characters in task names
- Network error handling (what happens when WebSocket disconnects?)

### M-02: No test for plan approval/rejection UI flow
The plan mode is tested at API level (`api-e2e.spec.ts:229`, `advanced-api.spec.ts:242-319`) but never through the UI. The plan approval dialog, rejection feedback, and sub-task visualization are untested at the E2E level.

### M-03: WebSocket test uses timing-based assertion
**File:** `full-flow.spec.ts:373-388`

```typescript
await page.waitForTimeout(2000);
await expect(page.getByText("在线")).toBeVisible({ timeout: 5000 });
```

The WebSocket test creates a task via API and expects it to appear via real-time push. But the 2s wait is arbitrary. Should use `waitForSelector` or `expect.poll` to wait for the specific task heading to appear.

### M-04: No concurrent access testing
No tests for:
- Two workers claiming the same task simultaneously
- Concurrent PATCH operations on the same task
- Race conditions in FileLock-based storage

### M-05: Pervasive `any` type usage defeats TypeScript strict mode
**Files:** All spec files

```typescript
async function cleanupAdvTasks(request: any) { ... }
const targets = (data.tasks ?? []).filter((task: any) => ...);
```

Every spec file uses `any` extensively instead of proper types (`APIRequestContext`, task interface). This defeats the project's TypeScript strict mode setting.

### M-06: `ensureReviewTask` defensive logic masks backend bugs
**File:** `advanced-api.spec.ts:38-63`

```typescript
async function ensureReviewTask(request, parentTaskId) {
  // First check if review task already exists
  // Then try to create one
  // If 409, search again
  // Return whatever we find
}
```

This 3-layer defensive pattern works around backend race conditions rather than testing them. If the review endpoint has a real bug (e.g., creates duplicate reviews), this function hides it.

### M-07: Daily stats test has timezone fragility
**File:** `advanced-api.spec.ts:963-975`

```typescript
const today = new Date().toISOString().split("T")[0]; // UTC date
expect(data.date).toBe(today);
```

`new Date().toISOString()` returns UTC. If the backend uses local timezone for daily stats, this assertion fails near midnight in UTC+ timezones.

### M-08: `retry_count`/`max_retries` directly patchable via API
**File:** `api-e2e.spec.ts:270-272`

```typescript
await request.patch(`${API}/api/tasks/${task.id}`, {
  data: { retry_count: 2, max_retries: 3 },
});
```

The test demonstrates that internal bookkeeping fields are writable via the public PATCH endpoint. This is an API security issue — clients should not be able to reset their retry count or increase max_retries.

### M-09: No mobile/responsive viewport tests
The Playwright config hardcodes `1440x900` desktop viewport. `AppShell.tsx` has mobile-specific behavior (hamburger menu, collapsible sidebar) that is never tested.

### M-10: Cleanup has no backoff between retry passes
**File:** `full-flow.spec.ts:27-73`, `console-pages.spec.ts:59-73`

The cleanup loops retry up to 5 times with zero delay. If deletion fails due to FileLock contention, immediate retries hit the same lock. Add exponential backoff or at minimum a 100ms delay.

### M-11: Screenshot-only tests provide zero regression value
**File:** `full-flow.spec.ts` tests 07, 26; `console-pages.spec.ts` review test

These tests take screenshots but have no assertions and no visual regression tool configured. Without a baseline comparison tool (e.g., `@playwright/test` visual comparisons or Percy), screenshots are documentation only.

### M-12: DRY violation — task creation payload repeated 30+ times
The same `POST /api/tasks` pattern with minor variations appears across all files. Should extract a shared `createTestTask()` helper with defaults.

### M-13: Inconsistent timeout values
`5000`, `10000`, `15000`, `30000` ms used across similar operations with no rationale. Recommend standardizing on 2-3 timeout tiers.

### M-14: No accessibility assertions
Zero ARIA role verification, keyboard navigation tests (except the `Meta+Enter` test), or screen reader compatibility checks. The frontend uses Chinese UI labels — accessible names should be verified.

### M-15: `POST /api/dispatcher/next` used for read-only query
**File:** `advanced-api.spec.ts:131-134`

```typescript
const nextRes = await request.post(`${API}/api/dispatcher/next`, { data: {} });
```

Without `worker_id`, this is a read-only query returning the next pending task. Per REST conventions, it should be `GET`, not `POST`.

### M-16: Test names hardcode expected counts
**File:** `api-e2e.spec.ts:36`

```typescript
test("Workers endpoint returns 5 workers (3 Claude + 2 Codex)", ...);
```

Test name becomes misleading if worker configuration changes. Use dynamic assertions without embedding counts in titles.

### M-17: Weak `res.ok()` assertion masks status code issues
**File:** `api-e2e.spec.ts` (throughout)

`res.ok()` accepts any 2xx status. Doesn't distinguish between 200 (OK), 201 (Created), and 204 (No Content). A POST that should return 201 returning 200 would pass silently.

### M-18: `/projects` page entirely untested
The projects page (`/projects`) has CRUD operations for multi-project management but zero E2E test coverage.

---

## Cross-File Consistency Issues

| Issue | `full-flow` | `api-e2e` | `advanced-api` | `console-pages` |
|-------|-------------|-----------|----------------|-----------------|
| API URL format | `localhost:8000/api` | `127.0.0.1:8000` | `127.0.0.1:8000` | `localhost:8000/api` |
| Test prefix | `[E2E]` | `E2E-` | `ADV-` | `[E2E-Pages]` |
| afterAll cleanup | No | No | Yes (implicit via beforeEach) | Yes |
| Response status check | Partial | Partial | Partial | No |
| TypeScript strict | No (`any`) | No (`any`) | No (`any`) | No (`any`) |

---

## Recommended Action Plan

### Phase 1: Fix Critical Test Correctness (Immediate)
1. **Standardize API endpoint usage** — All tests should use either global or project-scoped endpoints consistently. Migrate to project-scoped for UI-visible tasks (C-01)
2. **Save/restore worker state** in `withManualStateControl` instead of blind set/reset (C-02)
3. **Add error logging** to `cleanTestTasks` and `cleanupAdvTasks` — at minimum `console.warn` on failures (C-03)
4. **Fix `waitForPage`** to verify heading text in all code paths, not just the fallback (C-04)
5. **Replace vacuous assertions** with meaningful checks or `expect.fail()` in else branches (C-05, C-07)
6. **Add `afterAll` cleanup** to `api-e2e.spec.ts` and `full-flow.spec.ts` (C-06)

### Phase 2: Fix Test Reliability
1. Replace all `waitForTimeout` with proper wait conditions (H-02)
2. Add `res.ok()` or status code checks before all JSON parsing (H-03)
3. Fix `Meta+Enter` to be platform-aware (H-01)
4. Use `page.once("dialog")` instead of `page.on("dialog")` (H-05)
5. Reset engine health in `beforeEach` across all files (H-08)
6. Add environment variable support for API URLs (H-11)

### Phase 3: Improve Coverage and Architecture
1. Split `advanced-api.spec.ts` into focused files (H-09)
2. Move API-only tests from `full-flow.spec.ts` to `api-e2e.spec.ts` (H-07)
3. Add negative/error path UI tests (M-01)
4. Add plan approval UI flow tests (M-02)
5. Add mobile viewport tests (M-09)
6. Add accessibility testing (M-14)
7. Test `/projects` page (M-18)

---

## Positive Observations

Despite the issues above, the test suite demonstrates several strengths:

1. **Broad coverage** — 103+ tests covering API lifecycle, UI flows, dispatcher, reviews, events, dependencies, and console pages
2. **Good isolation prefixes** — Each file uses distinct prefixes (`[E2E]`, `E2E-`, `ADV-`, `[E2E-Pages]`) to prevent accidental cross-file deletion
3. **Systematic status flow testing** — Tests 09-12 in `full-flow.spec.ts` methodically verify the full task state machine (pending → in_progress → completed, pending → in_progress → failed → retry, cancel)
4. **Dependency management tests** — `advanced-api.spec.ts` tests dependency blocking and unblocking, which is a complex and error-prone area
5. **Review protocol testing** — The adversarial review flow (create → complete → trigger review → submit findings → verify parent status) is well-tested

---

*Review generated by task-100 adversarial review worker*
*Files analyzed: 4 spec files, 1 config file, ~3,128 total lines of test code*
