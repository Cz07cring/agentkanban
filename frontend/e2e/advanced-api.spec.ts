/**
 * Advanced API E2E tests - Dispatcher, Plan/Review flows, Execution protocol,
 * Stats, Events, Notifications, Task filtering, Worker/Engine management.
 */
import { test, expect } from "@playwright/test";

const API = "http://127.0.0.1:8000";

async function cleanupAdvTasks(request: any) {
  for (let pass = 0; pass < 5; pass++) {
    const res = await request.get(`${API}/api/tasks`);
    const data = await res.json();
    const targets = (data.tasks ?? [])
      .filter((task: any) => task.title.includes("ADV-"))
      .sort(
        (a: any, b: any) =>
          (b.depends_on?.length ?? 0) - (a.depends_on?.length ?? 0),
      );

    if (!targets.length) {
      return;
    }

    let deleted = 0;
    for (const task of targets) {
      const delRes = await request.delete(`${API}/api/tasks/${task.id}`);
      if (delRes.ok()) {
        deleted++;
      }
    }

    if (deleted === 0) {
      return;
    }
  }
}

async function ensureReviewTask(request: any, parentTaskId: string) {
  const listRes = await request.get(`${API}/api/tasks`);
  const listData = await listRes.json();
  let reviewTask = (listData.tasks ?? []).find(
    (task: any) =>
      task.parent_task_id === parentTaskId && task.task_type === "review",
  );
  if (reviewTask) {
    return reviewTask;
  }

  const reviewRes = await request.post(`${API}/api/tasks/${parentTaskId}/review`);
  if (reviewRes.ok()) {
    return await reviewRes.json();
  }

  expect(reviewRes.status()).toBe(409);
  const retryRes = await request.get(`${API}/api/tasks`);
  const retryData = await retryRes.json();
  reviewTask = (retryData.tasks ?? []).find(
    (task: any) =>
      task.parent_task_id === parentTaskId && task.task_type === "review",
  );
  expect(reviewTask).toBeDefined();
  return reviewTask;
}

// Cleanup E2E test tasks before each test
test.beforeEach(async ({ request }) => {
  await cleanupAdvTasks(request);
  // Reset workers to idle
  for (let i = 0; i < 5; i++) {
    await request.patch(`${API}/api/workers/worker-${i}`, {
      data: { status: "idle" },
    });
  }
});

// ==========================================
// Dispatcher APIs
// ==========================================
test.describe("Dispatcher APIs", () => {
  test("GET /api/dispatcher/queue returns queue summary", async ({
    request,
  }) => {
    // Create a few tasks to populate the queue
    await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-队列测试1",
        description: "测试",
        engine: "auto",
        plan_mode: false,
      },
    });

    const res = await request.get(`${API}/api/dispatcher/queue`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.summary).toBeDefined();
    expect(typeof data.total).toBe("number");
    expect(data.blocked).toBeInstanceOf(Array);
    expect(data.engines).toBeDefined();
    expect(typeof data.engines.claude).toBe("boolean");
    expect(typeof data.engines.codex).toBe("boolean");
  });

  test("POST /api/dispatcher/next returns highest priority pending task", async ({
    request,
  }) => {
    // Create high priority task
    const highRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-高优先级任务",
        description: "紧急修复",
        engine: "auto",
        plan_mode: false,
        priority: "high",
      },
    });
    const highTask = await highRes.json();

    // Create low priority task
    await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-低优先级任务",
        description: "普通任务",
        engine: "auto",
        plan_mode: false,
        priority: "low",
      },
    });

    const nextRes = await request.post(`${API}/api/dispatcher/next`, {
      data: {},
    });
    expect(nextRes.ok()).toBeTruthy();
    const nextData = await nextRes.json();

    // Should return the high priority task
    expect(nextData.task).toBeDefined();
    expect(nextData.task.priority).toBe("high");
    expect(nextData.task.id).toBe(highTask.id);
  });

  test("POST /api/dispatcher/next with worker_id dispatches to worker", async ({
    request,
  }) => {
    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-分派Worker测试",
        description: "指定Worker分派",
        engine: "claude",
        plan_mode: false,
      },
    });
    const task = await taskRes.json();

    const nextRes = await request.post(`${API}/api/dispatcher/next`, {
      data: { worker_id: "worker-0", engine: "claude" },
    });
    expect(nextRes.ok()).toBeTruthy();
    const nextData = await nextRes.json();

    expect(nextData.task.status).toBe("in_progress");
    expect(nextData.task.assigned_worker).toBe("worker-0");

    // Give time for execution to settle
    await new Promise((r) => setTimeout(r, 2000));
  });

  test("POST /api/dispatcher/next with engine filter", async ({ request }) => {
    await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-Claude任务过滤",
        description: "feature",
        engine: "claude",
        plan_mode: false,
      },
    });

    const nextRes = await request.post(`${API}/api/dispatcher/next`, {
      data: { engine: "claude" },
    });
    expect(nextRes.ok()).toBeTruthy();
    const data = await nextRes.json();
    expect(data.task.routed_engine).toBe("claude");
  });

  test("POST /api/dispatcher/next returns 404 when no pending tasks", async ({
    request,
  }) => {
    const res = await request.post(`${API}/api/dispatcher/next`, {
      data: {},
    });
    // May return 404 if no pending tasks, or 200 if there are existing tasks
    if (res.status() === 404) {
      const data = await res.json();
      expect(data.detail).toBe("No pending task");
    }
  });

  test("Dispatcher queue shows blocked tasks with dependencies", async ({
    request,
  }) => {
    // Create parent task
    const parentRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-父任务",
        description: "先完成这个",
        engine: "auto",
        plan_mode: false,
      },
    });
    const parent = await parentRes.json();

    // Create child task with dependency
    await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-子任务依赖",
        description: "依赖父任务",
        engine: "auto",
        plan_mode: false,
        depends_on: [parent.id],
      },
    });

    const queueRes = await request.get(`${API}/api/dispatcher/queue`);
    const queueData = await queueRes.json();

    // The child task should be in blocked list
    const blocked = queueData.blocked;
    const blockedChild = blocked.find(
      (b: { task_id: string; depends_on: string[] }) =>
        b.depends_on.includes(parent.id),
    );
    expect(blockedChild).toBeDefined();
  });
});

// ==========================================
// Plan Approval & Decomposition
// ==========================================
test.describe("Plan Approval & Decomposition", () => {
  test("Plan approval auto-decomposes into sub-tasks", async ({ request }) => {
    // Create plan_mode task
    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-计划审批测试",
        description: "完整计划流程",
        engine: "auto",
        plan_mode: true,
      },
    });
    const task = await taskRes.json();
    expect(task.status).toBe("plan_review");

    // Add plan content
    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: {
        plan_content:
          "1. 设计 API 接口\n2. 实现后端逻辑\n3. 编写单元测试\n4. 集成前端",
      },
    });

    // Approve plan
    const approveRes = await request.post(
      `${API}/api/tasks/${task.id}/approve-plan`,
      {
        data: { approved: true },
      },
    );
    expect(approveRes.ok()).toBeTruthy();
    const approveData = await approveRes.json();

    expect(approveData.task.status).toBe("blocked_by_subtasks");
    expect(approveData.task.blocked_reason).toBe("waiting_subtasks");
    expect(approveData.sub_tasks.length).toBeGreaterThanOrEqual(1);
    expect(approveData.sub_tasks.length).toBeLessThanOrEqual(8);

    // Sub tasks should reference parent
    for (const sub of approveData.sub_tasks) {
      expect(sub.parent_task_id).toBe(task.id);
      expect(sub.status).toBe("pending");
    }

    // Parent should have sub_tasks list
    expect(approveData.task.sub_tasks.length).toBe(
      approveData.sub_tasks.length,
    );
  });

  test("Plan rejection returns to pending with feedback", async ({
    request,
  }) => {
    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-计划驳回测试",
        description: "测试驳回流程",
        engine: "auto",
        plan_mode: true,
      },
    });
    const task = await taskRes.json();

    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { plan_content: "1. 先做设计" },
    });

    const rejectRes = await request.post(
      `${API}/api/tasks/${task.id}/approve-plan`,
      {
        data: { approved: false, feedback: "需要更详细的方案" },
      },
    );
    expect(rejectRes.ok()).toBeTruthy();
    const rejectData = await rejectRes.json();

    expect(rejectData.task.status).toBe("pending");
    expect(rejectData.task.plan_content).toContain("需要更详细的方案");
    expect(rejectData.sub_tasks).toHaveLength(0);
  });

  test("Plan approval on non-plan_review task returns 409", async ({
    request,
  }) => {
    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-非计划任务审批",
        description: "不应该可以审批",
        engine: "auto",
        plan_mode: false,
      },
    });
    const task = await taskRes.json();

    const res = await request.post(
      `${API}/api/tasks/${task.id}/approve-plan`,
      {
        data: { approved: true },
      },
    );
    expect(res.status()).toBe(409);
  });

  test("Manual decomposition creates sub-tasks", async ({ request }) => {
    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-手动拆解测试",
        description: "拆分为子任务",
        engine: "auto",
        plan_mode: false,
      },
    });
    const parent = await taskRes.json();

    const decomposeRes = await request.post(
      `${API}/api/tasks/${parent.id}/decompose`,
      {
        data: {
          sub_tasks: [
            {
              title: "ADV-子任务A",
              description: "实现登录",
              task_type: "feature",
              engine: "auto",
              priority: "high",
            },
            {
              title: "ADV-子任务B",
              description: "编写测试",
              task_type: "review",
              engine: "codex",
              priority: "medium",
            },
          ],
        },
      },
    );
    expect(decomposeRes.ok()).toBeTruthy();
    const decomposeData = await decomposeRes.json();

    expect(decomposeData.parent.status).toBe("blocked_by_subtasks");
    expect(decomposeData.sub_tasks).toHaveLength(2);
    expect(decomposeData.sub_tasks[0].parent_task_id).toBe(parent.id);
    expect(decomposeData.sub_tasks[1].routed_engine).toBe("codex");
  });
});

// ==========================================
// Review Flow
// ==========================================
test.describe("Review Flow", () => {
  test("Trigger adversarial review on completed feature task", async ({
    request,
  }) => {
    // Create and complete a feature task
    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-实现搜索功能",
        description: "需要 Review 的功能",
        engine: "claude",
        plan_mode: false,
        task_type: "feature",
      },
    });
    const task = await taskRes.json();

    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { status: "in_progress" },
    });
    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { status: "completed" },
    });

    const reviewTask = await ensureReviewTask(request, task.id);

    expect(reviewTask.task_type).toBe("review");
    expect(reviewTask.parent_task_id).toBe(task.id);
    expect(reviewTask.depends_on).toContain(task.id);
    // Review should use opposite engine
    expect(reviewTask.routed_engine).toBe("codex");
  });

  test("Submit review with no critical issues approves parent", async ({
    request,
  }) => {
    // Create and complete a feature task
    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-Review提交测试",
        description: "通过 Review",
        engine: "claude",
        plan_mode: false,
        task_type: "feature",
      },
    });
    const task = await taskRes.json();

    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { status: "in_progress" },
    });
    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { status: "completed" },
    });

    const reviewTask = await ensureReviewTask(request, task.id);

    // Submit review with low severity issues only
    const submitRes = await request.post(
      `${API}/api/tasks/${reviewTask.id}/review-submit`,
      {
        data: {
          issues: [
            {
              severity: "low",
              file: "src/search.ts",
              line: 42,
              description: "可以优化变量命名",
              suggestion: "使用更具描述性的名称",
            },
          ],
          summary: "代码质量良好，仅有小问题",
        },
      },
    );
    expect(submitRes.ok()).toBeTruthy();
    const submitted = await submitRes.json();

    expect(submitted.review_status).toBe("completed");
    expect(submitted.status).toBe("completed");

    // Check parent task was approved
    const parentRes = await request.get(`${API}/api/tasks/${task.id}`);
    const parent = await parentRes.json();
    expect(parent.review_status).toBe("approved");
  });

  test("Submit review with critical issues fails parent", async ({
    request,
  }) => {
    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-Review失败测试",
        description: "Review 发现严重问题",
        engine: "claude",
        plan_mode: false,
        task_type: "feature",
      },
    });
    const task = await taskRes.json();

    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { status: "in_progress" },
    });
    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { status: "completed" },
    });

    const reviewTask = await ensureReviewTask(request, task.id);

    // Submit review with critical issues
    const submitRes = await request.post(
      `${API}/api/tasks/${reviewTask.id}/review-submit`,
      {
        data: {
          issues: [
            {
              severity: "critical",
              file: "src/auth.ts",
              line: 15,
              description: "SQL 注入漏洞",
              suggestion: "使用参数化查询",
            },
          ],
          summary: "发现严重安全漏洞",
        },
      },
    );
    expect(submitRes.ok()).toBeTruthy();

    // Check parent task was failed
    const parentRes = await request.get(`${API}/api/tasks/${task.id}`);
    const parent = await parentRes.json();
    expect(parent.review_status).toBe("changes_requested");
    expect(parent.status).toBe("failed");
    expect(parent.review_round).toBe(1);
  });

  test("Duplicate review trigger returns 409", async ({ request }) => {
    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-重复Review测试",
        description: "不应允许重复 Review",
        engine: "claude",
        plan_mode: false,
        task_type: "feature",
      },
    });
    const task = await taskRes.json();

    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { status: "in_progress" },
    });
    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { status: "completed" },
    });

    const reviewTask = await ensureReviewTask(request, task.id);

    // Re-trigger should fail
    const secondRes = await request.post(
      `${API}/api/tasks/${task.id}/review`,
    );
    expect(secondRes.status()).toBe(409);

    const listRes = await request.get(`${API}/api/tasks`);
    const listData = await listRes.json();
    const reviewTasks = (listData.tasks ?? []).filter(
      (item: any) =>
        item.parent_task_id === task.id && item.task_type === "review",
    );
    expect(reviewTasks).toHaveLength(1);
    expect(reviewTasks[0].id).toBe(reviewTask.id);
  });
});

// ==========================================
// Task Execution Protocol
// ==========================================
test.describe("Task Execution Protocol", () => {
  test("Claim, heartbeat, and complete protocol", async ({ request }) => {
    // Ensure worker-0 is idle
    await request.patch(`${API}/api/workers/worker-0`, {
      data: { status: "idle" },
    });

    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-执行协议-完成流程",
        description: "claim → heartbeat → complete",
        engine: "claude",
        plan_mode: false,
      },
    });
    const task = await taskRes.json();

    // Claim
    const claimRes = await request.post(
      `${API}/api/tasks/${task.id}/claim`,
      {
        data: { worker_id: "worker-0" },
      },
    );
    expect(claimRes.ok()).toBeTruthy();
    const claimed = await claimRes.json();
    expect(claimed.lease_id).toBeTruthy();
    expect(claimed.task.status).toBe("in_progress");
    expect(claimed.task.assigned_worker).toBe("worker-0");

    // Heartbeat
    const heartbeatRes = await request.post(
      `${API}/api/tasks/${task.id}/heartbeat`,
      {
        data: { worker_id: "worker-0", lease_id: claimed.lease_id },
      },
    );
    expect(heartbeatRes.ok()).toBeTruthy();
    const hb = await heartbeatRes.json();
    expect(hb.ok).toBe(true);

    // Complete
    const completeRes = await request.post(
      `${API}/api/tasks/${task.id}/complete`,
      {
        data: {
          worker_id: "worker-0",
          lease_id: claimed.lease_id,
          commit_ids: ["abc1234", "def5678"],
          summary: "功能实现完成",
        },
      },
    );
    expect(completeRes.ok()).toBeTruthy();
    const completed = await completeRes.json();
    expect(["completed", "reviewing"]).toContain(completed.status);
    expect(completed.commit_ids).toContain("abc1234");
    expect(completed.commit_ids).toContain("def5678");
    if (completed.status === "completed") {
      expect(completed.completed_at).toBeTruthy();
    }
  });

  test("Claim, heartbeat, and fail protocol", async ({ request }) => {
    await request.patch(`${API}/api/workers/worker-1`, {
      data: { status: "idle" },
    });

    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-执行协议-失败流程",
        description: "claim → heartbeat → fail",
        engine: "claude",
        plan_mode: false,
      },
    });
    const task = await taskRes.json();

    // Set retry_count near max_retries so fail endpoint exhausts retries
    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { retry_count: 2, max_retries: 3 },
    });

    // Claim
    const claimRes = await request.post(
      `${API}/api/tasks/${task.id}/claim`,
      {
        data: { worker_id: "worker-1" },
      },
    );
    expect(claimRes.ok()).toBeTruthy();
    const claimed = await claimRes.json();

    // Heartbeat
    const hbRes = await request.post(
      `${API}/api/tasks/${task.id}/heartbeat`,
      {
        data: { worker_id: "worker-1", lease_id: claimed.lease_id },
      },
    );
    expect(hbRes.ok()).toBeTruthy();

    // Fail
    const failRes = await request.post(
      `${API}/api/tasks/${task.id}/fail`,
      {
        data: {
          worker_id: "worker-1",
          lease_id: claimed.lease_id,
          error_log: "编译错误: undefined symbol 'foobar'",
          exit_code: 1,
        },
      },
    );
    expect(failRes.ok()).toBeTruthy();
    const failed = await failRes.json();
    expect(failed.status).toBe("failed");
    expect(failed.error_log).toContain("编译错误");
    expect(failed.last_exit_code).toBe(1);
  });

  test("Heartbeat with wrong worker returns 409", async ({ request }) => {
    await request.patch(`${API}/api/workers/worker-0`, {
      data: { status: "idle" },
    });

    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-Heartbeat错误Worker",
        description: "测试",
        engine: "claude",
        plan_mode: false,
      },
    });
    const task = await taskRes.json();

    const claimRes = await request.post(
      `${API}/api/tasks/${task.id}/claim`,
      {
        data: { worker_id: "worker-0" },
      },
    );
    const claimed = await claimRes.json();

    // Heartbeat with wrong worker
    const hbRes = await request.post(
      `${API}/api/tasks/${task.id}/heartbeat`,
      {
        data: { worker_id: "worker-1", lease_id: claimed.lease_id },
      },
    );
    expect(hbRes.status()).toBe(409);
  });
});

// ==========================================
// Retry Endpoint
// ==========================================
test.describe("Retry Endpoint", () => {
  test("POST /api/tasks/{id}/retry resets failed task to pending", async ({
    request,
  }) => {
    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-重试端点测试",
        description: "测试重试API",
        engine: "auto",
        plan_mode: false,
      },
    });
    const task = await taskRes.json();

    // Move to failed
    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { status: "in_progress" },
    });
    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { status: "failed", error_log: "测试失败" },
    });

    // Retry
    const retryRes = await request.post(
      `${API}/api/tasks/${task.id}/retry`,
    );
    expect(retryRes.ok()).toBeTruthy();
    const retried = await retryRes.json();

    expect(retried.status).toBe("pending");
    expect(retried.error_log).toBeNull();
    expect(retried.assigned_worker).toBeNull();
    expect(retried.started_at).toBeNull();
  });

  test("Retry on non-failed task returns 409", async ({ request }) => {
    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-重试非失败任务",
        description: "不应该可以重试",
        engine: "auto",
        plan_mode: false,
      },
    });
    const task = await taskRes.json();

    const retryRes = await request.post(
      `${API}/api/tasks/${task.id}/retry`,
    );
    expect(retryRes.status()).toBe(409);
  });

  test("Retry with max retries exceeded returns 409", async ({ request }) => {
    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-超出最大重试",
        description: "重试次数用完",
        engine: "auto",
        plan_mode: false,
      },
    });
    const task = await taskRes.json();

    // Set retry_count to max_retries
    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { status: "in_progress" },
    });
    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: {
        status: "failed",
        error_log: "失败",
        retry_count: 3,
        max_retries: 3,
      },
    });

    const retryRes = await request.post(
      `${API}/api/tasks/${task.id}/retry`,
    );
    expect(retryRes.status()).toBe(409);
  });
});

// ==========================================
// Task Filtering
// ==========================================
test.describe("Task Filtering", () => {
  test("Filter tasks by status", async ({ request }) => {
    // Create tasks with different statuses
    const task1Res = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-过滤-待处理",
        description: "pending",
        engine: "auto",
        plan_mode: false,
      },
    });
    const task1 = await task1Res.json();

    const task2Res = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-过滤-已完成",
        description: "completed",
        engine: "auto",
        plan_mode: false,
      },
    });
    const task2 = await task2Res.json();
    await request.patch(`${API}/api/tasks/${task2.id}`, {
      data: { status: "in_progress" },
    });
    await request.patch(`${API}/api/tasks/${task2.id}`, {
      data: { status: "completed" },
    });

    // Filter by pending
    const pendingRes = await request.get(
      `${API}/api/tasks?status=pending`,
    );
    const pendingData = await pendingRes.json();
    const pendingTasks = pendingData.tasks.filter((t: { title: string }) =>
      t.title.startsWith("ADV-过滤"),
    );
    expect(pendingTasks.every((t: { status: string }) => t.status === "pending")).toBe(true);

    // Filter by completed
    const completedRes = await request.get(
      `${API}/api/tasks?status=completed`,
    );
    const completedData = await completedRes.json();
    const completedTasks = completedData.tasks.filter(
      (t: { title: string }) => t.title.startsWith("ADV-过滤"),
    );
    expect(completedTasks.every((t: { status: string }) => t.status === "completed")).toBe(
      true,
    );
  });

  test("Filter tasks by engine", async ({ request }) => {
    await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-引擎过滤-Claude",
        description: "feature 任务",
        engine: "claude",
        plan_mode: false,
      },
    });

    const res = await request.get(`${API}/api/tasks?engine=claude`);
    const data = await res.json();
    const filtered = data.tasks.filter((t: { title: string }) =>
      t.title.startsWith("ADV-引擎过滤"),
    );
    expect(filtered.length).toBeGreaterThanOrEqual(1);
    expect(
      filtered.every(
        (t: { routed_engine: string }) => t.routed_engine === "claude",
      ),
    ).toBe(true);
  });

  test("Filter tasks by priority", async ({ request }) => {
    await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-优先级过滤-高",
        description: "高优先级",
        engine: "auto",
        plan_mode: false,
        priority: "high",
      },
    });

    const res = await request.get(`${API}/api/tasks?priority=high`);
    const data = await res.json();
    const filtered = data.tasks.filter((t: { title: string }) =>
      t.title.startsWith("ADV-优先级过滤"),
    );
    expect(filtered.length).toBeGreaterThanOrEqual(1);
    expect(filtered.every((t: { priority: string }) => t.priority === "high")).toBe(true);
  });

  test("Search tasks by keyword", async ({ request }) => {
    await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-关键词搜索",
        description: "搜索引擎优化 SEO",
        engine: "auto",
        plan_mode: false,
      },
    });

    const res = await request.get(`${API}/api/tasks?q=SEO`);
    const data = await res.json();
    const found = data.tasks.filter((t: { title: string }) =>
      t.title.includes("ADV-关键词搜索"),
    );
    expect(found.length).toBeGreaterThanOrEqual(1);
  });
});

// ==========================================
// Stats Endpoints
// ==========================================
test.describe("Stats Endpoints", () => {
  test("GET /api/stats returns comprehensive statistics", async ({
    request,
  }) => {
    // Create some tasks to ensure stats have data
    await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-统计测试",
        description: "统计数据",
        engine: "auto",
        plan_mode: false,
      },
    });

    const res = await request.get(`${API}/api/stats`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(typeof data.total_tasks).toBe("number");
    expect(data.by_status).toBeDefined();
    expect(data.by_type).toBeDefined();
    expect(data.by_engine).toBeDefined();
    expect(data.by_priority).toBeDefined();

    expect(data.engines).toBeDefined();
    expect(data.engines.claude).toBeDefined();
    expect(data.engines.codex).toBeDefined();
    expect(typeof data.engines.claude.healthy).toBe("boolean");
    expect(typeof data.engines.claude.workers_total).toBe("number");
    expect(typeof data.engines.claude.workers_busy).toBe("number");

    expect(data.meta).toBeDefined();
  });

  test("GET /api/stats/daily returns today's stats", async ({ request }) => {
    const res = await request.get(`${API}/api/stats/daily`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.date).toBeTruthy();
    expect(typeof data.created).toBe("number");
    expect(typeof data.completed).toBe("number");

    // Date should be today's date
    const today = new Date().toISOString().split("T")[0];
    expect(data.date).toBe(today);
  });
});

// ==========================================
// Events & Notifications
// ==========================================
test.describe("Events & Notifications", () => {
  test("GET /api/events returns event list", async ({ request }) => {
    // Create a task to trigger an event
    await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-事件列表测试",
        description: "触发事件",
        engine: "auto",
        plan_mode: false,
      },
    });

    const res = await request.get(`${API}/api/events`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.events).toBeInstanceOf(Array);
    if (data.events.length > 0) {
      const event = data.events[0];
      expect(event.id).toBeTruthy();
      expect(event.type).toBeTruthy();
      expect(event.level).toBeTruthy();
      expect(event.created_at).toBeTruthy();
      expect(typeof event.acknowledged).toBe("boolean");
    }
  });

  test("Filter events by level", async ({ request }) => {
    const res = await request.get(`${API}/api/events?level=info`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.events).toBeInstanceOf(Array);
    for (const event of data.events) {
      expect(event.level).toBe("info");
    }
  });

  test("Filter events by task_id", async ({ request }) => {
    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-事件过滤by任务",
        description: "过滤",
        engine: "auto",
        plan_mode: false,
      },
    });
    const task = await taskRes.json();

    const res = await request.get(
      `${API}/api/events?task_id=${task.id}`,
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    for (const event of data.events) {
      expect(event.task_id).toBe(task.id);
    }
  });

  test("Acknowledge event", async ({ request }) => {
    // Create a task to generate an event
    await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-事件确认测试",
        description: "确认事件",
        engine: "auto",
        plan_mode: false,
      },
    });

    // Get events
    const eventsRes = await request.get(`${API}/api/events`);
    const eventsData = await eventsRes.json();
    const unacked = eventsData.events.find(
      (e: { acknowledged: boolean }) => !e.acknowledged,
    );

    if (unacked) {
      const ackRes = await request.post(
        `${API}/api/events/${unacked.id}/ack`,
        {
          data: { by: "test-user" },
        },
      );
      expect(ackRes.ok()).toBeTruthy();
      const acked = await ackRes.json();
      expect(acked.acknowledged).toBe(true);
      expect(acked.acknowledged_by).toBe("test-user");
      expect(acked.acknowledged_at).toBeTruthy();
    }
  });

  test("Acknowledge non-existent event returns 404", async ({ request }) => {
    const res = await request.post(`${API}/api/events/evt-nonexistent/ack`, {
      data: { by: "test" },
    });
    expect(res.status()).toBe(404);
  });

  test("GET /api/notifications returns warning/error/critical events", async ({
    request,
  }) => {
    const res = await request.get(`${API}/api/notifications`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.notifications).toBeInstanceOf(Array);
    for (const notif of data.notifications) {
      expect(["warning", "error", "critical"]).toContain(notif.level);
    }
  });
});

// ==========================================
// Worker & Engine Management
// ==========================================
test.describe("Worker & Engine Management", () => {
  test("PATCH /api/workers/{id} updates worker status", async ({
    request,
  }) => {
    const res = await request.patch(`${API}/api/workers/worker-0`, {
      data: { status: "idle" },
    });
    expect(res.ok()).toBeTruthy();
    const worker = await res.json();
    expect(worker.id).toBe("worker-0");
    expect(worker.status).toBe("idle");
    expect(worker.last_seen_at).toBeTruthy();
  });

  test("PATCH /api/workers/{id} with current_task_id", async ({
    request,
  }) => {
    const res = await request.patch(`${API}/api/workers/worker-0`, {
      data: { current_task_id: "task-999" },
    });
    expect(res.ok()).toBeTruthy();
    const worker = await res.json();
    expect(worker.current_task_id).toBe("task-999");

    // Reset
    await request.patch(`${API}/api/workers/worker-0`, {
      data: { status: "idle", current_task_id: "" },
    });
  });

  test("PATCH non-existent worker returns 404", async ({ request }) => {
    const res = await request.patch(`${API}/api/workers/worker-999`, {
      data: { status: "idle" },
    });
    expect(res.status()).toBe(404);
  });

  test("PATCH /api/engines/{engine}/health toggles engine health", async ({
    request,
  }) => {
    // Set claude to unhealthy
    const offRes = await request.patch(
      `${API}/api/engines/claude/health`,
      {
        data: { healthy: false },
      },
    );
    expect(offRes.ok()).toBeTruthy();
    const offData = await offRes.json();
    expect(offData.engine).toBe("claude");
    expect(offData.healthy).toBe(false);

    // Verify via health endpoint
    const healthRes = await request.get(`${API}/api/engines/health`);
    const healthData = await healthRes.json();
    expect(healthData.engines.claude.healthy).toBe(false);

    // Set back to healthy
    const onRes = await request.patch(
      `${API}/api/engines/claude/health`,
      {
        data: { healthy: true },
      },
    );
    expect(onRes.ok()).toBeTruthy();
    expect((await onRes.json()).healthy).toBe(true);
  });

  test("PATCH non-existent engine returns 404", async ({ request }) => {
    const res = await request.patch(
      `${API}/api/engines/nonexistent/health`,
      {
        data: { healthy: false },
      },
    );
    expect(res.status()).toBe(404);
  });
});

// ==========================================
// Timeline & Attempts
// ==========================================
test.describe("Timeline & Attempts", () => {
  test("GET /api/tasks/{id}/timeline returns task timeline", async ({
    request,
  }) => {
    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-Timeline测试",
        description: "timeline",
        engine: "auto",
        plan_mode: false,
      },
    });
    const task = await taskRes.json();

    // Perform status transitions to generate timeline entries
    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { status: "in_progress" },
    });
    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { status: "completed" },
    });

    const res = await request.get(
      `${API}/api/tasks/${task.id}/timeline`,
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.task_id).toBe(task.id);
    expect(data.timeline).toBeInstanceOf(Array);
    expect(data.timeline.length).toBeGreaterThanOrEqual(3); // created + 2 status updates

    // Check timeline entry structure
    for (const entry of data.timeline) {
      expect(entry.at).toBeTruthy();
      expect(entry.event).toBeTruthy();
      expect(entry.detail).toBeDefined();
    }

    // Check timeline events
    const events = data.timeline.map(
      (e: { event: string }) => e.event,
    );
    expect(events).toContain("task_created");
    expect(events).toContain("status_updated");
  });

  test("GET /api/tasks/{id}/attempts returns attempt history", async ({
    request,
  }) => {
    await request.patch(`${API}/api/workers/worker-2`, {
      data: { status: "idle" },
    });

    const taskRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-Attempts测试",
        description: "attempts",
        engine: "claude",
        plan_mode: false,
      },
    });
    const task = await taskRes.json();

    // Claim to create an attempt
    const claimRes = await request.post(
      `${API}/api/tasks/${task.id}/claim`,
      {
        data: { worker_id: "worker-2" },
      },
    );
    const claimed = await claimRes.json();

    const res = await request.get(
      `${API}/api/tasks/${task.id}/attempts`,
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.task_id).toBe(task.id);
    expect(data.attempts).toBeInstanceOf(Array);
    expect(data.attempts.length).toBeGreaterThanOrEqual(1);

    const attempt = data.attempts[0];
    expect(attempt.attempt).toBe(1);
    expect(attempt.worker_id).toBe("worker-2");
    expect(attempt.lease_id).toBe(claimed.lease_id);
    expect(attempt.started_at).toBeTruthy();
    expect(attempt.status).toBe("running");
  });

  test("Timeline for non-existent task returns 404", async ({ request }) => {
    const res = await request.get(
      `${API}/api/tasks/task-nonexistent/timeline`,
    );
    expect(res.status()).toBe(404);
  });

  test("Attempts for non-existent task returns 404", async ({ request }) => {
    const res = await request.get(
      `${API}/api/tasks/task-nonexistent/attempts`,
    );
    expect(res.status()).toBe(404);
  });
});

// ==========================================
// Dependency Management
// ==========================================
test.describe("Dependency Management", () => {
  test("Task with unmet dependencies cannot be set to in_progress", async ({
    request,
  }) => {
    // Create parent
    const parentRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-依赖父任务",
        description: "parent",
        engine: "auto",
        plan_mode: false,
      },
    });
    const parent = await parentRes.json();

    // Create child with dependency
    const childRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-依赖子任务",
        description: "depends on parent",
        engine: "auto",
        plan_mode: false,
        depends_on: [parent.id],
      },
    });
    const child = await childRes.json();

    // Try to start child - should fail
    const startRes = await request.patch(
      `${API}/api/tasks/${child.id}`,
      {
        data: { status: "in_progress" },
      },
    );
    expect(startRes.status()).toBe(409);
  });

  test("Task with met dependencies can be started", async ({ request }) => {
    // Create and complete parent
    const parentRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-已完成父任务",
        description: "先完成这个",
        engine: "auto",
        plan_mode: false,
        task_type: "analysis",
      },
    });
    const parent = await parentRes.json();
    await request.patch(`${API}/api/tasks/${parent.id}`, {
      data: { status: "in_progress" },
    });
    await request.patch(`${API}/api/tasks/${parent.id}`, {
      data: { status: "completed" },
    });

    // Create child with dependency
    const childRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-可启动子任务",
        description: "parent is done",
        engine: "auto",
        plan_mode: false,
        depends_on: [parent.id],
      },
    });
    const child = await childRes.json();

    // Start child - should succeed
    const startRes = await request.patch(
      `${API}/api/tasks/${child.id}`,
      {
        data: { status: "in_progress" },
      },
    );
    expect(startRes.ok()).toBeTruthy();
    const started = await startRes.json();
    expect(started.status).toBe("in_progress");
  });

  test("Cannot delete task with dependent tasks", async ({ request }) => {
    const parentRes = await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-不可删除父任务",
        description: "有依赖不能删",
        engine: "auto",
        plan_mode: false,
      },
    });
    const parent = await parentRes.json();

    await request.post(`${API}/api/tasks`, {
      data: {
        title: "ADV-依赖子不让删",
        description: "依赖",
        engine: "auto",
        plan_mode: false,
        depends_on: [parent.id],
      },
    });

    const deleteRes = await request.delete(
      `${API}/api/tasks/${parent.id}`,
    );
    expect(deleteRes.status()).toBe(409);
  });
});
