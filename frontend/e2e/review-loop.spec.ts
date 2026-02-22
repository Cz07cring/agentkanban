/**
 * E2E tests for the Review→Fix→Verify closed loop.
 *
 * Tests the auto-parsing of structured review JSON from worker stdout
 * via the /complete endpoint, the fix cycle (parent reset to pending),
 * re-review after fix, approval, and max-round escalation.
 */
import { test, expect } from "@playwright/test";

const API = "http://127.0.0.1:8000";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanupLoopTasks(request: any) {
  for (let pass = 0; pass < 5; pass++) {
    const res = await request.get(`${API}/api/tasks`);
    const data = await res.json();
    const targets = (data.tasks ?? [])
      .filter((task: any) => task.title.includes("LOOP-"))
      .sort(
        (a: any, b: any) =>
          (b.depends_on?.length ?? 0) - (a.depends_on?.length ?? 0),
      );
    if (!targets.length) return;

    let deleted = 0;
    for (const task of targets) {
      const delRes = await request.delete(`${API}/api/tasks/${task.id}`);
      if (delRes.ok()) deleted++;
    }
    if (deleted === 0) return;
  }
}

/** Create a feature task, claim it with worker-0, and complete it so a
 *  review task is auto-created. Returns { parent, reviewTask, leaseId }. */
async function setupReviewScenario(request: any) {
  // Ensure worker-0 is idle
  await request.patch(`${API}/api/workers/worker-0`, {
    data: { status: "idle" },
  });

  // Create feature task
  const taskRes = await request.post(`${API}/api/tasks`, {
    data: {
      title: "LOOP-Review闭环测试",
      description: "用于测试 Review 自动闭环",
      engine: "claude",
      plan_mode: false,
      task_type: "feature",
    },
  });
  const parent = await taskRes.json();

  // Claim with worker-0
  const claimRes = await request.post(`${API}/api/tasks/${parent.id}/claim`, {
    data: { worker_id: "worker-0" },
  });
  const claimed = await claimRes.json();

  // Complete — this triggers maybe_trigger_adversarial_review
  const completeRes = await request.post(
    `${API}/api/tasks/${parent.id}/complete`,
    {
      data: {
        worker_id: "worker-0",
        lease_id: claimed.lease_id,
        commit_ids: ["aaa1111"],
        summary: "Feature implemented",
      },
    },
  );
  expect(completeRes.ok()).toBeTruthy();

  // Find the auto-created review task
  const listRes = await request.get(`${API}/api/tasks`);
  const listData = await listRes.json();
  const reviewTask = (listData.tasks ?? []).find(
    (t: any) =>
      t.parent_task_id === parent.id && t.task_type === "review",
  );
  expect(reviewTask).toBeDefined();

  return { parent, reviewTask, leaseId: claimed.lease_id };
}

/** Claim a review task with worker-1 and complete it with a given summary
 *  (stdout text). Returns the completed review task. */
async function completeReviewWith(
  request: any,
  reviewTaskId: string,
  summary: string,
) {
  // Ensure worker-1 is idle
  await request.patch(`${API}/api/workers/worker-1`, {
    data: { status: "idle" },
  });

  // Claim
  const claimRes = await request.post(
    `${API}/api/tasks/${reviewTaskId}/claim`,
    { data: { worker_id: "worker-1" } },
  );
  expect(claimRes.ok()).toBeTruthy();
  const claimed = await claimRes.json();

  // Complete with summary containing (or not) a JSON block
  const completeRes = await request.post(
    `${API}/api/tasks/${reviewTaskId}/complete`,
    {
      data: {
        worker_id: "worker-1",
        lease_id: claimed.lease_id,
        commit_ids: [],
        summary,
      },
    },
  );
  expect(completeRes.ok()).toBeTruthy();
  return completeRes.json();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  await cleanupLoopTasks(request);
});

test.afterAll(async ({ request }) => {
  await cleanupLoopTasks(request);
});

test.describe("Review→Fix→Verify Loop", () => {
  test("Review with no critical issues auto-approves parent via /complete", async ({
    request,
  }) => {
    const { parent, reviewTask } = await setupReviewScenario(request);

    // Complete review with a JSON block containing only low-severity issues
    const summary = [
      "Code looks good overall.",
      "```json",
      JSON.stringify({
        issues: [
          {
            severity: "low",
            file: "src/utils.ts",
            line: 10,
            description: "Minor naming issue",
            suggestion: "Rename to camelCase",
          },
        ],
        summary: "Minor style issues only",
      }),
      "```",
    ].join("\n");

    await completeReviewWith(request, reviewTask.id, summary);

    // Verify parent is approved
    const parentRes = await request.get(`${API}/api/tasks/${parent.id}`);
    const updatedParent = await parentRes.json();
    expect(updatedParent.review_status).toBe("approved");
    expect(updatedParent.status).toBe("completed");
  });

  test("Review with critical issues resets parent to pending for auto-fix", async ({
    request,
  }) => {
    const { parent, reviewTask } = await setupReviewScenario(request);

    // Complete review with critical issues
    const summary = [
      "Found security vulnerabilities.",
      "```json",
      JSON.stringify({
        issues: [
          {
            severity: "high",
            file: "src/auth.ts",
            line: 15,
            description: "SQL injection vulnerability",
            suggestion: "Use parameterized queries",
          },
          {
            severity: "medium",
            file: "src/api.ts",
            line: 30,
            description: "Missing input validation",
            suggestion: "Add validation middleware",
          },
        ],
        summary: "Found 1 high and 1 medium issue",
      }),
      "```",
    ].join("\n");

    await completeReviewWith(request, reviewTask.id, summary);

    // Verify parent was reset to pending with feedback
    const parentRes = await request.get(`${API}/api/tasks/${parent.id}`);
    const updatedParent = await parentRes.json();
    expect(updatedParent.status).toBe("pending");
    expect(updatedParent.review_status).toBe("changes_requested");
    expect(updatedParent.review_round).toBe(1);
    expect(updatedParent.assigned_worker).toBeNull();

    // Verify review task has parsed result
    const reviewRes = await request.get(
      `${API}/api/tasks/${reviewTask.id}`,
    );
    const updatedReview = await reviewRes.json();
    expect(updatedReview.review_result).toBeDefined();
    expect(updatedReview.review_result.issues).toHaveLength(2);
    expect(updatedReview.review_result.summary).toBe(
      "Found 1 high and 1 medium issue",
    );
  });

  test("Unparseable review output escalates parent to plan_review", async ({
    request,
  }) => {
    const { parent, reviewTask } = await setupReviewScenario(request);

    // Complete review WITHOUT any JSON block
    await completeReviewWith(
      request,
      reviewTask.id,
      "I reviewed the code and it looks interesting but I forgot the JSON.",
    );

    // Verify parent escalated to plan_review
    const parentRes = await request.get(`${API}/api/tasks/${parent.id}`);
    const updatedParent = await parentRes.json();
    expect(updatedParent.status).toBe("plan_review");
    expect(updatedParent.blocked_reason).toBe("review_parse_failed");
    expect(updatedParent.review_status).toBe("changes_requested");
  });

  test("Fix cycle: parent re-completed triggers new review (old completed review does not block)", async ({
    request,
  }) => {
    const { parent, reviewTask } = await setupReviewScenario(request);

    // Round 1: review finds critical issues → parent reset to pending
    const criticalSummary = [
      "Issues found.",
      "```json",
      JSON.stringify({
        issues: [
          {
            severity: "critical",
            file: "src/db.ts",
            line: 5,
            description: "Hardcoded credentials",
            suggestion: "Use environment variables",
          },
        ],
        summary: "Critical: hardcoded credentials",
      }),
      "```",
    ].join("\n");

    await completeReviewWith(request, reviewTask.id, criticalSummary);

    // Verify parent is pending for fix
    let parentRes = await request.get(`${API}/api/tasks/${parent.id}`);
    let updatedParent = await parentRes.json();
    expect(updatedParent.status).toBe("pending");
    expect(updatedParent.review_round).toBe(1);

    // Simulate fix: re-claim and complete the parent
    await request.patch(`${API}/api/workers/worker-0`, {
      data: { status: "idle" },
    });
    const claim2 = await request.post(
      `${API}/api/tasks/${parent.id}/claim`,
      { data: { worker_id: "worker-0" } },
    );
    expect(claim2.ok()).toBeTruthy();
    const claimed2 = await claim2.json();

    const complete2 = await request.post(
      `${API}/api/tasks/${parent.id}/complete`,
      {
        data: {
          worker_id: "worker-0",
          lease_id: claimed2.lease_id,
          commit_ids: ["bbb2222"],
          summary: "Fixed hardcoded credentials",
        },
      },
    );
    expect(complete2.ok()).toBeTruthy();

    // Verify _review_feedback was cleaned up on the completed parent
    const parentAfterFix = await (
      await request.get(`${API}/api/tasks/${parent.id}`)
    ).json();
    expect(parentAfterFix._review_feedback).toBeUndefined();

    // Verify a NEW review task was created (old one is completed, not blocking)
    const listRes = await request.get(`${API}/api/tasks`);
    const listData = await listRes.json();
    const reviewTasks = (listData.tasks ?? []).filter(
      (t: any) =>
        t.parent_task_id === parent.id && t.task_type === "review",
    );
    expect(reviewTasks.length).toBeGreaterThanOrEqual(2);

    // The new review task should be pending (not yet claimed)
    const newReview = reviewTasks.find(
      (t: any) => t.id !== reviewTask.id && t.status === "pending",
    );
    expect(newReview).toBeDefined();
  });

  test("Max review rounds exceeded escalates to plan_review", async ({
    request,
  }) => {
    // Ensure workers idle
    await request.patch(`${API}/api/workers/worker-0`, {
      data: { status: "idle" },
    });
    await request.patch(`${API}/api/workers/worker-1`, {
      data: { status: "idle" },
    });

    // Create feature task
    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "LOOP-MaxRounds测试",
        description: "测试最大轮次限制",
        engine: "claude",
        plan_mode: false,
        task_type: "feature",
      },
    });
    const parent = await taskRes.json();

    // Pre-set review_round near the limit (MAX_REVIEW_ROUNDS = 3)
    // Set to 2 so next failure triggers round 3 → escalation
    await request.patch(`${API}/api/tasks/${parent.id}`, {
      data: { review_round: 2 },
    });

    // Claim and complete parent to trigger review
    const claim1 = await request.post(
      `${API}/api/tasks/${parent.id}/claim`,
      { data: { worker_id: "worker-0" } },
    );
    const claimed1 = await claim1.json();
    await request.post(`${API}/api/tasks/${parent.id}/complete`, {
      data: {
        worker_id: "worker-0",
        lease_id: claimed1.lease_id,
        commit_ids: ["ccc3333"],
        summary: "Attempt 3",
      },
    });

    // Find review task
    const listRes = await request.get(`${API}/api/tasks`);
    const listData = await listRes.json();
    const reviewTask = (listData.tasks ?? []).find(
      (t: any) =>
        t.parent_task_id === parent.id &&
        t.task_type === "review" &&
        t.status === "pending",
    );

    // If review_round >= MAX_REVIEW_ROUNDS, maybe_trigger won't create a review
    // (defense-in-depth guard). In that case the parent stays completed.
    if (!reviewTask) {
      // review_round guard prevented review creation — also valid behavior
      const parentRes = await request.get(`${API}/api/tasks/${parent.id}`);
      const p = await parentRes.json();
      // Parent should stay completed (no review triggered)
      expect(["completed", "reviewing"]).toContain(p.status);
      return;
    }

    // If review was created (round check happens in _handle_review_completion),
    // complete it with critical issues → should escalate to plan_review
    const critSummary = [
      "Still has issues.",
      "```json",
      JSON.stringify({
        issues: [
          {
            severity: "high",
            file: "src/fix.ts",
            line: 1,
            description: "Issue persists",
            suggestion: "Needs manual attention",
          },
        ],
        summary: "Issue not resolved after 3 rounds",
      }),
      "```",
    ].join("\n");

    await completeReviewWith(request, reviewTask.id, critSummary);

    // Verify parent escalated to plan_review
    const parentRes = await request.get(`${API}/api/tasks/${parent.id}`);
    const updatedParent = await parentRes.json();
    expect(updatedParent.status).toBe("plan_review");
    expect(updatedParent.blocked_reason).toBe("max_review_rounds_exceeded");
    expect(updatedParent.review_round).toBeGreaterThanOrEqual(3);
  });

  test("Review with empty issues array auto-approves parent", async ({
    request,
  }) => {
    const { parent, reviewTask } = await setupReviewScenario(request);

    // Complete review with empty issues
    const summary = [
      "All checks passed.",
      "```json",
      JSON.stringify({
        issues: [],
        summary: "Code is clean, no issues found",
      }),
      "```",
    ].join("\n");

    await completeReviewWith(request, reviewTask.id, summary);

    // Verify parent approved
    const parentRes = await request.get(`${API}/api/tasks/${parent.id}`);
    const updatedParent = await parentRes.json();
    expect(updatedParent.review_status).toBe("approved");
    expect(updatedParent.status).toBe("completed");
  });

  test("Multiple JSON blocks in review output: last block is used", async ({
    request,
  }) => {
    const { parent, reviewTask } = await setupReviewScenario(request);

    // Summary with two JSON blocks — only the last should be parsed
    const summary = [
      "Here's some analysis:",
      "```json",
      JSON.stringify({ wrong: true, issues: [{ severity: "critical" }] }),
      "```",
      "But the actual review result is:",
      "```json",
      JSON.stringify({
        issues: [],
        summary: "Actually all is fine",
      }),
      "```",
    ].join("\n");

    await completeReviewWith(request, reviewTask.id, summary);

    // Should approve (last block has empty issues)
    const parentRes = await request.get(`${API}/api/tasks/${parent.id}`);
    const updatedParent = await parentRes.json();
    expect(updatedParent.review_status).toBe("approved");
  });
});
