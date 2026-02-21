/**
 * API-level E2E tests - Tests the full backend flow without browser.
 * These tests can run in any environment (CI, sandbox, local).
 */
import { test, expect } from "@playwright/test";

const API = "http://127.0.0.1:8000";

// Cleanup E2E test tasks before each test
test.beforeEach(async ({ request }) => {
  const res = await request.get(`${API}/api/tasks`);
  const data = await res.json();
  for (const task of data.tasks) {
    if (task.title.startsWith("E2E-")) {
      await request.delete(`${API}/api/tasks/${task.id}`);
    }
  }
});

test.describe("Backend API E2E", () => {
  test("Health check returns ok with engine status", async ({ request }) => {
    const res = await request.get(`${API}/api/health`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.engines.claude).toBe(true);
    expect(data.engines.codex).toBe(true);
    expect(data.timestamp).toBeTruthy();
  });

  test("Workers endpoint returns 5 workers (3 Claude + 2 Codex)", async ({
    request,
  }) => {
    const res = await request.get(`${API}/api/workers`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.workers).toHaveLength(5);

    const claude = data.workers.filter(
      (w: { engine: string }) => w.engine === "claude"
    );
    const codex = data.workers.filter(
      (w: { engine: string }) => w.engine === "codex"
    );
    expect(claude).toHaveLength(3);
    expect(codex).toHaveLength(2);

    // Verify worker structure
    for (const w of data.workers) {
      expect(w.id).toBeTruthy();
      expect(w.port).toBeGreaterThanOrEqual(5200);
      expect(["idle", "busy", "error"]).toContain(w.status);
      expect(w.capabilities).toBeInstanceOf(Array);
      expect(w.health).toBeDefined();
    }
  });

  test("Engine health endpoint shows correct worker counts", async ({
    request,
  }) => {
    const res = await request.get(`${API}/api/engines/health`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.engines.claude.healthy).toBe(true);
    expect(data.engines.claude.workers_total).toBe(3);
    expect(data.engines.claude.workers_busy).toBeGreaterThanOrEqual(0);
    expect(data.engines.codex.healthy).toBe(true);
    expect(data.engines.codex.workers_total).toBe(2);
    expect(data.engines.codex.workers_busy).toBeGreaterThanOrEqual(0);
  });

  test("Create task with auto routing", async ({ request }) => {
    const res = await request.post(`${API}/api/tasks`, {
      data: {
        title: "E2E-自动路由测试",
        description: "测试自动引擎选择",
        engine: "auto",
        plan_mode: false,
      },
    });
    expect(res.ok()).toBeTruthy();
    const task = await res.json();

    expect(task.id).toMatch(/^task-\d+$/);
    expect(task.status).toBe("pending");
    expect(task.engine).toBe("auto");
    expect(task.routed_engine).toBeTruthy();
    expect(task.created_at).toBeTruthy();
    expect(task.retry_count).toBe(0);
    expect(task.max_retries).toBe(3);
  });

  test("Task type classification from keywords", async ({ request }) => {
    // Feature task
    const feature = await (
      await request.post(`${API}/api/tasks`, {
        data: {
          title: "E2E-实现用户登录功能",
          description: "添加登录页面",
          engine: "auto",
          plan_mode: false,
        },
      })
    ).json();
    expect(feature.task_type).toBe("feature");
    expect(feature.routed_engine).toBe("claude");

    // Bugfix task
    const bugfix = await (
      await request.post(`${API}/api/tasks`, {
        data: {
          title: "E2E-修复页面崩溃 bug",
          description: "crash on login",
          engine: "auto",
          plan_mode: false,
        },
      })
    ).json();
    expect(bugfix.task_type).toBe("bugfix");
    expect(bugfix.routed_engine).toBe("claude");

    // Review task
    const review = await (
      await request.post(`${API}/api/tasks`, {
        data: {
          title: "E2E-Code Review 安全模块",
          description: "审查安全性",
          engine: "auto",
          plan_mode: false,
        },
      })
    ).json();
    expect(review.task_type).toBe("review");
    expect(review.routed_engine).toBe("codex");

    // Refactor task
    const refactor = await (
      await request.post(`${API}/api/tasks`, {
        data: {
          title: "E2E-重构数据库模块",
          description: "优化查询性能",
          engine: "auto",
          plan_mode: false,
        },
      })
    ).json();
    expect(refactor.task_type).toBe("refactor");
    expect(refactor.routed_engine).toBe("codex");

    // Analysis task
    const analysis = await (
      await request.post(`${API}/api/tasks`, {
        data: {
          title: "E2E-分析系统性能",
          description: "审计 API 端点",
          engine: "auto",
          plan_mode: false,
        },
      })
    ).json();
    expect(analysis.task_type).toBe("analysis");
    expect(analysis.routed_engine).toBe("codex");

    // Plan task
    const plan = await (
      await request.post(`${API}/api/tasks`, {
        data: {
          title: "E2E-设计微服务架构",
          description: "计划拆分方案",
          engine: "auto",
          plan_mode: false,
        },
      })
    ).json();
    expect(plan.task_type).toBe("plan");
    expect(plan.routed_engine).toBe("claude");
  });

  test("Force engine selection overrides auto routing", async ({
    request,
  }) => {
    // Force Codex for a feature task (normally routes to Claude)
    const task = await (
      await request.post(`${API}/api/tasks`, {
        data: {
          title: "E2E-强制 Codex 引擎",
          description: "创建新功能",
          engine: "codex",
          plan_mode: false,
        },
      })
    ).json();
    expect(task.routed_engine).toBe("codex");

    // Force Claude for a review task (normally routes to Codex)
    const task2 = await (
      await request.post(`${API}/api/tasks`, {
        data: {
          title: "E2E-强制 Claude Review",
          description: "code review 任务",
          engine: "claude",
          plan_mode: false,
        },
      })
    ).json();
    expect(task2.routed_engine).toBe("claude");
  });

  test("Full task lifecycle: pending -> in_progress -> completed/reviewing", async ({
    request,
  }) => {
    // Create
    const task = await (
      await request.post(`${API}/api/tasks`, {
        data: {
          title: "E2E-完整生命周期",
          description: "测试状态流转",
          engine: "auto",
          plan_mode: false,
        },
      })
    ).json();
    expect(task.status).toBe("pending");
    expect(task.started_at).toBeNull();
    expect(task.completed_at).toBeNull();

    // Start
    const started = await (
      await request.patch(`${API}/api/tasks/${task.id}`, {
        data: { status: "in_progress" },
      })
    ).json();
    expect(started.status).toBe("in_progress");
    expect(started.started_at).toBeTruthy();

    // Complete
    const completed = await (
      await request.patch(`${API}/api/tasks/${task.id}`, {
        data: { status: "completed" },
      })
    ).json();
    expect(["completed", "reviewing"]).toContain(completed.status);
    expect(completed.completed_at).toBeTruthy();

    // Verify via GET
    const fetched = await (
      await request.get(`${API}/api/tasks/${completed.id}`)
    ).json();
    expect(["completed", "reviewing"]).toContain(fetched.status);
    expect(fetched.completed_at).toBeTruthy();
  });

  test("Task failure and retry lifecycle", async ({ request }) => {
    const task = await (
      await request.post(`${API}/api/tasks`, {
        data: {
          title: "E2E-失败重试测试",
          description: "测试失败后重试",
          engine: "auto",
          plan_mode: false,
        },
      })
    ).json();

    // Start
    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { status: "in_progress" },
    });

    // Fail
    const failRes = await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { status: "failed", error_log: "测试失败：模拟错误" },
    });
    expect(failRes.ok()).toBeTruthy();
    const failed = await failRes.json();
    expect(failed.status).toBe("failed");
    expect(failed.error_log).toBe("测试失败：模拟错误");

    // Retry - back to pending
    const retried = await (
      await request.patch(`${API}/api/tasks/${task.id}`, {
        data: { status: "pending" },
      })
    ).json();
    expect(retried.status).toBe("pending");
  });

  test("Delete task", async ({ request }) => {
    const task = await (
      await request.post(`${API}/api/tasks`, {
        data: {
          title: "E2E-删除测试",
          description: "即将被删除",
          engine: "auto",
          plan_mode: false,
        },
      })
    ).json();

    const deleteRes = await request.delete(`${API}/api/tasks/${task.id}`);
    expect(deleteRes.ok()).toBeTruthy();

    const verifyRes = await request.get(`${API}/api/tasks/${task.id}`);
    expect(verifyRes.status()).toBe(404);
  });

  test("Delete non-existent task returns 404", async ({ request }) => {
    const res = await request.delete(`${API}/api/tasks/task-nonexistent`);
    expect(res.status()).toBe(404);
  });

  test("Get non-existent task returns 404", async ({ request }) => {
    const res = await request.get(`${API}/api/tasks/task-nonexistent`);
    expect(res.status()).toBe(404);
  });

  test("Plan mode task creation", async ({ request }) => {
    const task = await (
      await request.post(`${API}/api/tasks`, {
        data: {
          title: "E2E-Plan 模式测试",
          description: "需要先制定计划",
          engine: "auto",
          plan_mode: true,
        },
      })
    ).json();
    expect(task.plan_mode).toBe(true);
    expect(task.plan_content).toBeNull();

    // Update with plan content
    const updated = await (
      await request.patch(`${API}/api/tasks/${task.id}`, {
        data: {
          plan_content: "1. 分析需求\n2. 设计接口\n3. 实现功能",
        },
      })
    ).json();
    expect(updated.plan_content).toBe(
      "1. 分析需求\n2. 设计接口\n3. 实现功能"
    );
  });

  test("Approve plan auto-generates and persists sub tasks", async ({
    request,
  }) => {
    const created = await (
      await request.post(`${API}/api/tasks`, {
        data: {
          title: "E2E-Plan自动拆分",
          description: "自动拆分并落库",
          engine: "auto",
          plan_mode: true,
        },
      })
    ).json();

    await request.patch(`${API}/api/tasks/${created.id}`, {
      data: {
        plan_content: "1. 实现 API\n2. 编写测试\n3. 走代码审查",
      },
    });

    const approvedRes = await request.post(
      `${API}/api/tasks/${created.id}/approve-plan`,
      { data: { approved: true } }
    );
    expect(approvedRes.ok()).toBeTruthy();
    const approved = await approvedRes.json();

    expect(approved.task.status).toBe("blocked_by_subtasks");
    expect(approved.sub_tasks.length).toBeGreaterThan(0);
    expect(approved.task.sub_tasks.length).toBe(approved.sub_tasks.length);

    const fetched = await (
      await request.get(`${API}/api/tasks/${created.id}`)
    ).json();
    expect(fetched.status).toBe("blocked_by_subtasks");
    expect(fetched.sub_tasks.length).toBeGreaterThan(0);
  });

  test("Task timeline and attempts endpoints are available", async ({
    request,
  }) => {
    const task = await (
      await request.post(`${API}/api/tasks`, {
        data: {
          title: "E2E-审计轨迹测试",
          description: "验证 timeline 和 attempts",
          engine: "auto",
          plan_mode: false,
        },
      })
    ).json();

    const timelineRes = await request.get(
      `${API}/api/tasks/${task.id}/timeline`
    );
    expect(timelineRes.ok()).toBeTruthy();
    const timeline = await timelineRes.json();
    expect(Array.isArray(timeline.timeline)).toBeTruthy();

    const attemptsRes = await request.get(
      `${API}/api/tasks/${task.id}/attempts`
    );
    expect(attemptsRes.ok()).toBeTruthy();
    const attempts = await attemptsRes.json();
    expect(Array.isArray(attempts.attempts)).toBeTruthy();
  });

  test("Task execution protocol endpoints work (claim + heartbeat + fail)", async ({
    request,
  }) => {
    const task = await (
      await request.post(`${API}/api/tasks`, {
        data: {
          title: "E2E-执行协议测试",
          description: "claim/heartbeat/fail",
          engine: "auto",
          plan_mode: false,
        },
      })
    ).json();

    // Set retry_count near max_retries so fail endpoint exhausts retries
    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { retry_count: 2, max_retries: 3 },
    });

    const claimRes = await request.post(`${API}/api/tasks/${task.id}/claim`, {
      data: { worker_id: "worker-0" },
    });
    expect(claimRes.ok()).toBeTruthy();
    const claimed = await claimRes.json();
    expect(claimed.lease_id).toBeTruthy();
    expect(claimed.task.status).toBe("in_progress");

    const heartbeatRes = await request.post(
      `${API}/api/tasks/${task.id}/heartbeat`,
      {
        data: { worker_id: "worker-0", lease_id: claimed.lease_id },
      }
    );
    expect(heartbeatRes.ok()).toBeTruthy();

    const failRes = await request.post(`${API}/api/tasks/${task.id}/fail`, {
      data: {
        worker_id: "worker-0",
        lease_id: claimed.lease_id,
        error_log: "E2E simulated failure",
        exit_code: 99,
      },
    });
    expect(failRes.ok()).toBeTruthy();
    const failed = await failRes.json();
    expect(failed.status).toBe("failed");
    expect(failed.last_exit_code).toBe(99);
  });

  test("Events endpoint and ack flow", async ({ request }) => {
    // trigger an event
    await request.post(`${API}/api/tasks`, {
      data: {
        title: "E2E-事件测试",
        description: "触发事件并确认",
        engine: "auto",
        plan_mode: false,
      },
    });

    const eventsRes = await request.get(`${API}/api/events`);
    expect(eventsRes.ok()).toBeTruthy();
    const events = await eventsRes.json();
    expect(Array.isArray(events.events)).toBeTruthy();
    expect(events.events.length).toBeGreaterThan(0);

    const first = events.events[0];
    const ackRes = await request.post(`${API}/api/events/${first.id}/ack`, {
      data: { by: "e2e" },
    });
    expect(ackRes.ok()).toBeTruthy();
    const acked = await ackRes.json();
    expect(acked.acknowledged).toBe(true);
  });

  test("Meta statistics update correctly", async ({ request }) => {
    // Create and complete a task
    const task = await (
      await request.post(`${API}/api/tasks`, {
        data: {
          title: "E2E-统计测试",
          description: "验证 meta 统计",
          engine: "auto",
          plan_mode: false,
        },
      })
    ).json();

    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { status: "in_progress" },
    });
    await request.patch(`${API}/api/tasks/${task.id}`, {
      data: { status: "completed" },
    });

    // Check meta
    const data = await (await request.get(`${API}/api/tasks`)).json();
    expect(data.meta.last_updated).toBeTruthy();
    expect(data.meta.total_completed).toBeGreaterThanOrEqual(1);
    expect(data.meta.success_rate).toBeGreaterThanOrEqual(0);
    expect(data.meta.success_rate).toBeLessThanOrEqual(1);
  });

  test("Task update with assigned_worker", async ({ request }) => {
    const task = await (
      await request.post(`${API}/api/tasks`, {
        data: {
          title: "E2E-Worker 分配测试",
          description: "测试 Worker 分配",
          engine: "auto",
          plan_mode: false,
        },
      })
    ).json();

    const updated = await (
      await request.patch(`${API}/api/tasks/${task.id}`, {
        data: {
          status: "in_progress",
          assigned_worker: "worker-0",
        },
      })
    ).json();
    expect(updated.assigned_worker).toBe("worker-0");
    expect(updated.status).toBe("in_progress");
  });

  test("Get individual worker by ID", async ({ request }) => {
    const res = await request.get(`${API}/api/workers/worker-0`);
    expect(res.ok()).toBeTruthy();
    const worker = await res.json();
    expect(worker.id).toBe("worker-0");
    expect(worker.engine).toBe("claude");
    expect(worker.port).toBe(5200);

    // Non-existent worker
    const res404 = await request.get(`${API}/api/workers/worker-999`);
    expect(res404.status()).toBe(404);
  });

  test("Task priority setting", async ({ request }) => {
    for (const priority of ["high", "medium", "low"]) {
      const task = await (
        await request.post(`${API}/api/tasks`, {
          data: {
            title: `E2E-优先级${priority}`,
            description: "优先级测试",
            engine: "auto",
            plan_mode: false,
            priority,
          },
        })
      ).json();
      expect(task.priority).toBe(priority);
    }
  });

  test("Frontend proxy: API accessible through Next.js", async ({
    request,
  }) => {
    // Test that the frontend proxies API requests to the backend
    const res = await request.get("http://127.0.0.1:3000/api/health");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.status).toBe("ok");

    const tasksRes = await request.get("http://127.0.0.1:3000/api/tasks");
    expect(tasksRes.ok()).toBeTruthy();

    const workersRes = await request.get("http://127.0.0.1:3000/api/workers");
    expect(workersRes.ok()).toBeTruthy();
  });
});
