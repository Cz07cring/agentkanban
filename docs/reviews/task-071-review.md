# Adversarial Code Review: task-071 (E2E-统计测试)

**Reviewer**: task-073 (automated adversarial review)
**Commits reviewed**:
- `e2e43c5` — feat(e2e): add console pages E2E tests and fix project-scoped API bugs
- `4730632` — fix(e2e): fix 3 test failures across E2E suites

**Files in scope**:
- `frontend/e2e/console-pages.spec.ts` (559 lines, new file)
- `frontend/e2e/advanced-api.spec.ts` (stats section, lines 929-976)
- `frontend/e2e/api-e2e.spec.ts` (meta stats test, lines 486-512)
- `frontend/e2e/full-flow.spec.ts` (cleanup + project-scoped fixes)
- `frontend/src/app/(console)/tasks/page.tsx` (project-context wiring)
- `backend/main.py` — `/api/stats`, `/api/stats/daily`, meta calculation

---

## Severity Legend
- **P0-Critical**: Causes test flakiness, false passes, or data corruption
- **P1-High**: Logic errors, missing coverage, or robustness gaps
- **P2-Medium**: Maintainability, style, or minor correctness issues
- **P3-Low**: Nit-picks and suggestions

---

## P0 — Critical Issues

### 1. `/api/stats/daily` test has timezone mismatch (advanced-api.spec.ts:963-975)

```ts
const today = new Date().toISOString().split("T")[0];
expect(data.date).toBe(today);
```

The test constructs `today` using the browser/Node.js **local** timezone via `new Date().toISOString()` (which is always UTC), but the backend uses `datetime.now(timezone.utc).date().isoformat()` which is also UTC. This seems OK **if** the test runner is in the same UTC day as the server. However, if CI or a developer runs tests near midnight UTC boundary (e.g., UTC 23:50), a task created before midnight and stats queried after midnight will produce a date mismatch. **This is a latent flaky test**. The test should fetch the date from the API response itself or mock time.

### 2. Stats test does not clean up test data (advanced-api.spec.ts:929-976)

The "Stats Endpoints" `test.describe` block creates a task (`ADV-统计测试`) but has **no `afterEach` cleanup**. While the top-level `beforeEach` in the file cleans `ADV-` prefixed tasks, if the stats test runs after other test blocks that leave behind tasks, the `total_tasks` count is unpredictable. The assertions only check `typeof data.total_tasks === "number"` — this is a **tautological assertion** that provides no real validation. A passing test here proves almost nothing about correctness.

### 3. `waitForPage` retry swallows real errors (console-pages.spec.ts:20-30)

```ts
} catch {
  await page.waitForTimeout(500);
}
```

All exceptions (including assertion failures from wrong headings, network errors, etc.) are silently swallowed during the 3-attempt retry loop. If the page loads with an error screen or wrong heading, the test will waste 45+ seconds before eventually failing with a generic timeout. This masks the real failure root cause and makes debugging extremely difficult.

---

## P1 — High Severity

### 4. Console page tests use fragile `.first()` everywhere

`console-pages.spec.ts` uses `.first()` on nearly every text selector (e.g., `page.getByText("总任务").first()`). This is documented as "avoiding strict mode errors" but it actually **hides duplicate element problems**. If a second "总任务" element appears due to a rendering bug, the test will still pass. The correct fix is to scope selectors to a specific container (e.g., a `data-testid` on the stats card section) rather than blindly taking the first match.

### 5. `success_rate` calculation edge case: cancelled/reviewing tasks are invisible

Backend meta calculation:
```python
completed = sum(1 for x in tasks if x.get("status") == "completed")
failed = sum(1 for x in tasks if x.get("status") == "failed")
data["meta"]["success_rate"] = round(completed / max(completed + failed, 1), 2)
```

Tasks with statuses like `cancelled`, `reviewing`, or `in_progress` are excluded from both numerator and denominator. A project with 100 tasks where 1 completed and 99 are cancelled will show `success_rate = 1.0` (100%). This is misleading. The E2E test (`api-e2e.spec.ts:508`) only checks `success_rate >= 0 && <= 1` — it never validates the formula correctness with known inputs.

### 6. `cleanTestTasks` in full-flow.spec.ts has a race condition

The new cleanup logic queries both global and project-scoped endpoints, deduplicates, then deletes. But between the query and the delete, the dispatcher or another test could modify task state. The 5-pass retry loop mitigates this, but the `deleted === 0` early-return on line 73 will bail out even if there are still remaining tasks that simply failed to delete (e.g., due to dependency constraints). The correct check should be `if (deleted === 0 && unique.length > 0) break` with a warning, not a silent return.

### 7. Console page tests depend on backend state but don't reset it

`console-pages.spec.ts` tests like "显示引擎卡片 Claude 和 Codex" call `ensureEnginesHealthy` but don't reset workers to a known state. If a prior test left workers busy, the "活跃" count shown on the Dashboard page will be non-zero and the worker stats cards may show unexpected data. Tests should fully reset both engine health AND worker status.

### 8. Missing negative test: stats with zero tasks

Neither `/api/stats` nor `/api/stats/daily` is tested with an empty task list. The `by_status`, `by_type`, etc. dictionaries would be empty objects `{}` — this is a valid edge case that should be explicitly verified.

---

## P2 — Medium Severity

### 9. Hard-coded API URLs differ across files

- `console-pages.spec.ts`: `const API = "http://localhost:8000/api"`
- `advanced-api.spec.ts`: `const API = "http://127.0.0.1:8000"`
- `api-e2e.spec.ts`: `const API = "http://127.0.0.1:8000"`
- `full-flow.spec.ts`: `const API = "http://localhost:8000/api"`

Mixing `localhost` and `127.0.0.1`, and mixing with/without `/api` suffix, is error-prone. On some systems `localhost` resolves to IPv6 `::1` while `127.0.0.1` is IPv4 only. This can cause intermittent connection failures. Should use a single shared constant or environment variable.

### 10. `waitForTimeout` anti-pattern used extensively

`console-pages.spec.ts` and `full-flow.spec.ts` use `page.waitForTimeout(2000)` and `page.waitForTimeout(3000)` in at least 10 places. Playwright's documentation explicitly warns against `waitForTimeout` as it causes slow, flaky tests. These should be replaced with `waitForResponse`, `waitForSelector`, or `expect().toBeVisible()` with appropriate timeouts.

### 11. `/api/stats` endpoint has duplicated code

The backend has `/api/stats` and `/api/projects/{project_id}/stats` with identical aggregation logic (30+ lines copy-pasted). This is not a test issue but was introduced/exposed by the same commit. Should be extracted into a helper function.

### 12. `console-pages.spec.ts` "Worker 卡片结构完整" test has weak else branch

```ts
if (count > 0) {
  // validate card structure
} else {
  // just check heading exists (already validated in prior test)
  await expect(page.getByRole("heading", { name: "Claude Workers" })).toBeVisible();
}
```

The else branch provides zero additional value beyond what other tests already check. If workers don't render, this test silently passes instead of flagging it as a problem.

### 13. `tasks/page.tsx` missing error boundary for project context

The `useProjectContext()` hook is called unconditionally but if the context provider is missing (e.g., during SSR or layout mismatch), it will throw. The `useCallback` dependencies include `activeProjectId` but there's no guard for undefined/null project IDs in the API calls.

---

## P3 — Low Severity / Nit-picks

### 14. Screenshot-heavy tests inflate CI storage

The commit adds 30+ new screenshot files (PNG). Each full-page screenshot is 40-160KB. Over time this will bloat the repository. Consider adding screenshots to `.gitignore` and only capturing them on failure.

### 15. `eslint-disable` comment in console-pages.spec.ts

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cleanTestTasks(page: Page) {
```

The `any` types in `cleanTestTasks` and `cleanupAdvTasks` should use proper task type interfaces instead of suppressing lint warnings.

### 16. Review test creates task but doesn't verify review creation outcome

In `console-pages.spec.ts` "有 Review 任务时显示列表", the test creates a task, completes it, triggers review via API, then navigates to the reviews page. It takes a screenshot but **makes no assertion** about what's actually displayed on the page.

### 17. The fix commit (`4730632`) patches retry_count but doesn't explain the root cause

The fix sets `retry_count: 2, max_retries: 3` before failing a task, but the commit message doesn't explain why the original test was failing. If the backend auto-retries tasks and resets status to `pending`, the test was checking for `"failed"` but finding `"pending"`. The fix works around this by exhausting retries, but a comment explaining this behavior would help future maintainers.

---

## Summary

| Severity | Count | Key Themes |
|----------|-------|------------|
| P0       | 3     | Timezone flake, tautological assertions, error swallowing |
| P1       | 5     | Fragile selectors, incorrect formula testing, state leaks |
| P2       | 5     | Code duplication, anti-patterns, weak branches |
| P3       | 4     | Style, storage bloat, missing comments |

**Overall Assessment**: The E2E test suite is **comprehensive in breadth** — it covers all console pages, navigation, stats endpoints, and project-scoped operations. However, **depth is lacking in the stats-specific tests**: the `/api/stats` assertions are mostly type-checks (`typeof === "number"`) rather than value-correctness checks. The console page tests rely heavily on `.first()` and `waitForTimeout` which creates a fragile, slow test suite. The most pressing issues are the timezone flake risk (P0-1), tautological stats assertions (P0-2), and the error-swallowing retry pattern (P0-3).

**Recommendation**: Address P0 issues before merging. P1 issues should be tracked as follow-up tasks.
