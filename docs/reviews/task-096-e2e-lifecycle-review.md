# Adversarial Review: Task-096 E2E Complete Lifecycle Test Suite

**Reviewer:** task-099 (Adversarial Review Worker)
**Target:** E2E test suite on `main` branch (full lifecycle coverage)
**Files Reviewed:**
- `frontend/e2e/full-flow.spec.ts` (593 lines) — UI lifecycle + smart routing + WebSocket
- `frontend/e2e/api-e2e.spec.ts` (583 lines) — Backend API E2E lifecycle
- `frontend/e2e/advanced-api.spec.ts` (1393 lines) — Dispatcher, plan/review, execution protocol, stats, events, filtering, dependencies
- `frontend/e2e/console-pages.spec.ts` (559 lines) — Console page navigation + CRUD
- `frontend/playwright.config.ts` (45 lines) — Test infrastructure config
- `backend/main.py` (2585 lines) — Cross-referenced for API correctness

**Verdict: BLOCK — 10 CRITICAL, 11 HIGH, 18 MEDIUM issues found**

---

## Executive Summary

The E2E suite delivers impressive breadth: ~100 tests spanning task CRUD, lifecycle state machines, plan approval, adversarial review, dispatcher protocol, event observability, console pages, and WebSocket push. However, the suite has systemic reliability problems that undermine its value as a safety net:

1. **Vacuous assertions** — At least 4 tests can pass with zero meaningful checks executed
2. **Silent cleanup failures** — Error-swallowing cleanup means tests run against polluted state with no diagnostics
3. **Dual API scope mismatch** — UI tests use project-scoped endpoints while API routing tests use global endpoints, writing to different storage files
4. **Hardcoded environment assumptions** — Ports, worker counts, macOS-only keybindings
5. **Test isolation gaps** — Engine health, worker state, and events leak across test boundaries

| Severity | Count |
|----------|-------|
| CRITICAL | 10    |
| HIGH     | 11    |
| MEDIUM   | 18    |
| LOW      | 12    |

---

## CRITICAL Issues (Must Fix Before Merge)

### C-01: Vacuous assertion — `count >= 0` always passes
**File:** `console-pages.spec.ts:183`
```typescript
const count = await taskItems.count();
expect(count).toBeGreaterThanOrEqual(0); // Playwright count() returns unsigned int
```
`Locator.count()` can never return a negative number. This assertion is tautologically true and validates nothing. The test claims to verify "待调度任务区域正确渲染" but proves nothing about rendering.

**Fix:** Assert `count > 0` after creating a test task, or assert on specific element text/structure.

### C-02: `waitForPage` ignores heading validation in retry loop
**File:** `console-pages.spec.ts:17-30`
```typescript
async function waitForPage(page: Page, url: string, headingText: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { ... });
      await page.waitForSelector("h1", { timeout: 15000 }); // Any <h1> matches!
      return; // Never checks headingText
    } catch { ... }
  }
  // headingText only checked in fallback path after all retries fail
}
```
During normal operation (retry succeeds), the `headingText` parameter is dead code. A test calling `waitForPage(page, "/workers", "Worker 管理")` succeeds even if the page shows a completely different `<h1>`.

**Fix:** Replace `page.waitForSelector("h1")` with `page.getByRole("heading", { name: headingText })` in the retry loop.

### C-03: Silent error swallowing in cleanup functions
**Files:** `full-flow.spec.ts:34-36`, `console-pages.spec.ts:59-73`, `advanced-api.spec.ts:9-36`
```typescript
} catch {
  // ignore fetch errors
}
```
All three cleanup functions swallow every error silently. When the backend is down, returns 500, or sends malformed JSON, cleanup silently "succeeds" and all subsequent tests run against polluted state. Failures manifest as bizarre assertion errors with no hint at the root cause.

**Fix:** Log cleanup errors to stderr (`console.warn`) and fail fast if the backend is unreachable.

### C-04: Dual API scope creates invisible data divergence
**File:** `full-flow.spec.ts` lines 108-112 vs 299-352
- `createTaskAPI()` and `createTaskUI()` use `POST /api/projects/proj-default/tasks` (project-scoped)
- Tests 17-20 (smart routing) use `POST /api/tasks` (global endpoint)

The backend stores these in **separate JSON files** (`data/projects/proj-default/tasks.json` vs `data/dev-tasks.json`). Tasks created by routing tests are invisible to `cleanTestTasks` (which cleans project-scoped data), and vice versa. This causes phantom test data accumulation across runs.

**Fix:** Standardize all tests on one endpoint scope. Prefer project-scoped since UI tests already use it.

### C-05: Conditional assertions create invisible test gaps
**File:** `advanced-api.spec.ts:187-198`
```typescript
const res = await request.post(`${API}/api/dispatcher/next`, { data: {} });
if (res.status() === 404) {
  const data = await res.json();
  expect(data.detail).toBe("No pending task");
}
// If status is NOT 404 (e.g., 200, 500), test passes with zero assertions
```
Same pattern at:
- `advanced-api.spec.ts:1057` — event ack test only asserts if an unacked event exists
- `console-pages.spec.ts:245-260` — worker card test only asserts if cards are found

**Fix:** Always have a meaningful assertion in every code path. Use `else { fail(...) }` or assert on expected status code.

### C-06: `Meta+Enter` shortcut only works on macOS
**File:** `full-flow.spec.ts:196`
```typescript
await textarea.press("Meta+Enter");
```
`Meta` maps to Cmd on macOS. On Linux/Windows (typical CI environments), this keypress produces no effect, so the task is never submitted. The assertion `expect(heading).toBeVisible()` then either times out (flaky) or passes because a prior test left the heading visible (false positive).

**Fix:** Use platform-conditional keybinding: `process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter'`.

### C-07: Cleanup loops have no delay between retry passes
**Files:** `full-flow.spec.ts:27-73`, `console-pages.spec.ts:59-73`, `advanced-api.spec.ts:9-36`
All cleanup functions retry up to 5 passes with zero delay. The backend uses `FileLock` for concurrent access — if deletion fails due to lock contention, immediate retries hit the same contention.

**Fix:** Add exponential backoff (e.g., 100ms, 200ms, 400ms) between retry passes.

### C-08: No `afterAll` / `afterEach` cleanup in `api-e2e.spec.ts`
**File:** `api-e2e.spec.ts`
The file uses `beforeEach` to clean `"E2E-"` prefixed tasks, but has no `afterAll`. If the last test creates tasks or mutates worker state (e.g., `assigned_worker: "worker-0"`), that state persists permanently in `dev-tasks.json`. This silently corrupts the environment for all subsequent test runs.

**Fix:** Add `afterAll` to delete all `E2E-` tasks and reset worker states.

### C-09: Hardcoded API URLs with no environment variable fallback
**Files:** All 4 spec files
```typescript
const API = "http://127.0.0.1:8000"; // api-e2e, advanced-api
const API = "http://localhost:8000/api"; // full-flow, console-pages
```
Two different URL formats are used, neither supports environment variable override. Docker, CI, and remote dev environments all fail silently.

**Fix:** Use `process.env.API_URL || "http://localhost:8000/api"` consistently.

### C-10: `beforeEach` cleanup can destroy concurrent workers' data
**File:** `api-e2e.spec.ts:10-17`
```typescript
for (const task of data.tasks) {
  if (task.title.startsWith("E2E-")) {
    await request.delete(`${API}/api/tasks/${task.id}`);
  }
}
```
If two test workers run simultaneously against the same backend, one worker's `beforeEach` deletes tasks created by the other. No run-specific isolation mechanism exists.

**Fix:** Use run-specific prefix (e.g., `E2E-${Date.now()}-`) or per-run project scoping.

---

## HIGH Issues (Should Fix)

### H-01: 15+ hardcoded `waitForTimeout` calls cause flakiness
**Files:** Multiple locations across all spec files
```typescript
await page.waitForTimeout(2000); // full-flow.spec.ts:234
await page.waitForTimeout(3000); // console-pages.spec.ts:124
await page.waitForTimeout(1000); // console-pages.spec.ts:322
```
Fixed sleeps are the #1 cause of CI flakiness. They're either too short (flaky failure) or too long (wasted time). Values range from 500ms to 3000ms with no justification.

**Fix:** Replace with `page.waitForResponse()`, `expect().toBeVisible()`, or `page.waitForFunction()`.

### H-02: Missing response status checks on 20+ API calls
**Files:** Throughout `api-e2e.spec.ts` and `advanced-api.spec.ts`
```typescript
const res = await request.post(`${API}/api/tasks`, { data: {...} });
const task = await res.json(); // No check for res.ok()!
```
If the API returns 400/500, `res.json()` may still succeed (backend returns JSON error bodies), but `task.id` is undefined. Downstream assertions fail with misleading `TypeError: Cannot read property 'id' of undefined`.

**Fix:** Add `expect(res.ok()).toBeTruthy()` or `expect(res.status()).toBe(201)` before every `.json()` call.

### H-03: Fragile textarea selector matches any empty textarea
**File:** `full-flow.spec.ts:92-93`
```typescript
const textarea = page.locator("textarea").filter({ hasText: "" }).first();
```
`hasText: ""` matches ALL textareas (empty string is a substring of everything). If the UI adds another textarea (e.g., search, comment), this silently targets the wrong element.

**Fix:** Use a more specific selector like `page.getByPlaceholder("输入任务标题")` or `page.getByTestId("task-input")`.

### H-04: `setAllWorkersStatus` destroys and never restores original state
**File:** `full-flow.spec.ts:127-142`
```typescript
async function withManualStateControl(page: Page, run: () => Promise<void>) {
  await setAllWorkersStatus(page, "busy"); // Overwrite ALL worker states
  try { await run(); }
  finally { await setAllWorkersStatus(page, "idle"); } // Blindly set all to idle
}
```
Original worker states (some may have been `"error"`, or had `consecutive_failures > 0`) are permanently lost.

**Fix:** Save original states before mutation, restore in `finally`.

### H-05: Engine health state leaks between tests
**File:** `advanced-api.spec.ts:1133-1162`
Test toggles Claude engine to `unhealthy` then restores. If the test fails before restoration, the engine remains unhealthy for all subsequent tests. The `beforeEach` only resets workers, not engine health.

**Fix:** Add engine health restoration to `afterEach` or `beforeEach`.

### H-06: Test order dependency via `test.describe.serial`
**File:** `full-flow.spec.ts`
All 26 tests run serially. If test N fails, tests N+1 through 26 are skipped entirely. Test 26 ("全局看板截图") has zero assertions — it only takes a screenshot and depends on prior tests' state to be meaningful.

**Fix:** Make each test self-contained or split into smaller serial groups with explicit setup.

### H-07: `advanced-api.spec.ts` at 1393 lines violates single-responsibility
The file covers 9 distinct feature areas (Dispatcher, Plan Approval, Review Flow, Execution Protocol, Retry, Filtering, Stats, Events, Dependencies) in a single file. Finding and maintaining specific tests requires extensive scrolling.

**Fix:** Split into focused files: `dispatcher.spec.ts`, `plan-review.spec.ts`, `execution-protocol.spec.ts`, etc.

### H-08: API tests embedded in UI flow spec
**File:** `full-flow.spec.ts:299-390` (tests 17-23)
Tests 17-20 (smart routing) and 21-23 (workers, health) use only `request` API — no UI interaction at all. They don't belong in a "Full E2E Flow" spec and inflate serial execution time.

**Fix:** Move pure API tests to `api-e2e.spec.ts`.

### H-09: Review test in console-pages creates data but asserts nothing
**File:** `console-pages.spec.ts:275-291`
```typescript
test("有 Review 任务时显示列表", async ({ page }) => {
  // ... creates task, patches status, triggers review ...
  await screenshot(page, "reviews-with-task");
  // Zero assertions about review rendering!
});
```
The test only takes a screenshot. There's no verification that the review is visible, has correct data, or renders properly.

**Fix:** Add `expect(page.getByText("review")).toBeVisible()` or equivalent.

### H-10: Fragile CSS class assertion
**File:** `console-pages.spec.ts:335-340`
```typescript
await expect(dashLink).toHaveClass(/bg-blue/);
```
Asserting on Tailwind utility class names breaks on any CSS refactoring (e.g., switching to `bg-primary`, CSS modules, or Tailwind v4 class changes).

**Fix:** Assert on visual state or ARIA attributes instead.

### H-11: `page.on("dialog")` handler never removed
**File:** `full-flow.spec.ts:230`
```typescript
page.on("dialog", (dialog) => dialog.accept());
```
This handler persists for the entire page lifecycle. Subsequent tests will auto-accept any dialog (including unexpected ones), masking bugs.

**Fix:** Use `page.once("dialog", ...)` for single-use handlers.

---

## MEDIUM Issues

| # | Issue | File | Line |
|---|-------|------|------|
| M-01 | No negative/error path tests (empty title, XSS payload, invalid engine, circular deps) | All files | — |
| M-02 | Plan approval UI flow untested — only API-level coverage | `full-flow.spec.ts` | — |
| M-03 | No concurrent access tests (simultaneous claims, parallel PATCHes) | All files | — |
| M-04 | Pervasive `any` type usage defeats TypeScript strict mode | All spec files | — |
| M-05 | Daily stats test has UTC timezone fragility near midnight | `advanced-api.spec.ts` | 973 |
| M-06 | Backend PATCH allows arbitrary field overwrite (security: `id`, `created_at`) | `backend/main.py` | 1316-1325 |
| M-07 | `/projects` page completely untested at E2E level | — | — |
| M-08 | No mobile/responsive viewport tests despite mobile-aware AppShell | `playwright.config.ts` | — |
| M-09 | No accessibility assertions (ARIA, keyboard nav, focus management) | All files | — |
| M-10 | Inconsistent timeout values (5s, 10s, 15s, 30s) with no rationale | All files | — |
| M-11 | `.first()` overuse (20+ instances) silently ignores element ambiguity | `console-pages.spec.ts` | — |
| M-12 | Screenshots have no visual regression tooling — purely decorative | All files | — |
| M-13 | `retries: 0` in playwright config means any transient failure is hard failure | `playwright.config.ts` | 9 |
| M-14 | `video: "off"` makes debugging CI failures difficult | `playwright.config.ts` | 16 |
| M-15 | DRY violation: task creation payload repeated 30+ times across files | All files | — |
| M-16 | Weak `res.ok()` assertion doesn't distinguish 200/201/204 status codes | `api-e2e.spec.ts` | — |
| M-17 | `POST /api/dispatcher/next` without `worker_id` is a read-only query — should be GET | `advanced-api.spec.ts` | 131 |
| M-18 | No test for WebSocket broadcast correctness (message shape, ordering) | All files | — |

---

## LOW Issues

| # | Issue | File |
|---|-------|------|
| L-01 | Screenshots use relative paths (fragile CWD dependency) | `full-flow.spec.ts:7` |
| L-02 | Inconsistent test naming language (mixed Chinese/English) | All files |
| L-03 | `openTaskDetail` uses `.first()` — may match wrong card with duplicate titles | `full-flow.spec.ts:77` |
| L-04 | `ensureReviewTask` defensive logic masks backend race conditions | `advanced-api.spec.ts:38-63` |
| L-05 | Magic numbers without documentation (5 passes, 8 subtask max, 5 workers) | Multiple files |
| L-06 | Test names embed expected counts ("5 workers (3 Claude + 2 Codex)") | `api-e2e.spec.ts:16` |
| L-07 | `eslint-disable` comment suppressing type safety | `console-pages.spec.ts:59` |
| L-08 | Cleanup dedup by `task.id` may miss cross-scope duplicates | `full-flow.spec.ts:43-49` |
| L-09 | `2000ms` delay in dispatcher test is arbitrary and environment-dependent | `advanced-api.spec.ts:166` |
| L-10 | No test-run-specific prefix for isolation | Multiple files |
| L-11 | Worker consecutive_failures counter not verified/reset in tests | `advanced-api.spec.ts` |
| L-12 | `plan_mode: true` task creation race with auto plan generation coroutine | `api-e2e.spec.ts:229` |

---

## Security Observations (from backend cross-reference)

### S-01: Unrestricted field overwrite via PATCH
**File:** `backend/main.py:1316-1325`
```python
for key, value in updates.items():
    if key == "status":
        continue
    task[key] = value  # Allows overwriting: id, created_at, timeline, attempts, etc.
```
The `TaskUpdate` Pydantic model uses `Optional` fields, but the `for key, value` loop writes ANY non-None field directly. Tests exploit this to set `retry_count`, `max_retries`, `assigned_worker` — but a malicious client could overwrite `id`, `created_at`, or inject arbitrary fields.

### S-02: No authentication/authorization on any endpoint
All endpoints are fully open. Any client can delete tasks, toggle engine health, or trigger dispatches. While acceptable for dev, E2E tests should note this as a known gap.

### S-03: Cleanup deletes by title prefix — no ownership validation
Test cleanup deletes ALL tasks matching a prefix. In a shared environment, this could delete tasks belonging to other users/processes.

---

## Recommended Action Plan

### Phase 1: Fix Test Reliability (Immediate, blocks merge)
1. Fix vacuous assertions: C-01, C-05 — ensure every test has meaningful assertions
2. Fix `waitForPage` heading check: C-02
3. Add error logging to cleanup functions: C-03
4. Standardize API scope (project-scoped only): C-04
5. Add response status checks: H-02
6. Fix macOS-only keybinding: C-06

### Phase 2: Fix Test Isolation (Next sprint)
1. Add `afterAll`/`afterEach` cleanup: C-08
2. Add engine health reset to `beforeEach`: H-05
3. Add cleanup retry delay: C-07
4. Support env var for API URL: C-09
5. Add run-specific prefix: C-10
6. Remove persistent dialog handler: H-11

### Phase 3: Improve Coverage & Maintainability (Backlog)
1. Replace `waitForTimeout` with proper waits: H-01
2. Split `advanced-api.spec.ts`: H-07
3. Move API tests out of `full-flow.spec.ts`: H-08
4. Add negative/error path tests: M-01
5. Add plan approval UI tests: M-02
6. Add mobile/accessibility tests: M-08, M-09

---

*Review generated by task-099 adversarial review worker*
*Date: 2026-02-21*
