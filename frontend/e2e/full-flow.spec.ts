import { test, expect, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const API = "http://localhost:8000/api";
const PREFIX = "[E2E]";
const SCREENSHOTS_DIR = path.join("e2e", "screenshots");

async function screenshot(page: Page, name: string) {
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, `${name}.png`),
    fullPage: true,
  });
}

async function cleanTestTasks(page: Page) {
  // Use both global and project-scoped endpoints to ensure full cleanup
  const endpoints = [
    `${API}/tasks`,
    `${API}/projects/proj-default/tasks`,
  ];

  for (let pass = 0; pass < 5; pass++) {
    let allTargets: any[] = [];

    for (const endpoint of endpoints) {
      try {
        const res = await page.request.get(endpoint);
        if (res.ok()) {
          const data = await res.json();
          const targets = (data.tasks ?? []).filter((task: any) =>
            task.title.includes(PREFIX),
          );
          allTargets.push(...targets);
        }
      } catch {
        // ignore fetch errors
      }
    }

    // Deduplicate by task id
    const seen = new Set<string>();
    const unique = allTargets.filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

    // Sort: tasks with dependencies first
    unique.sort(
      (a: any, b: any) =>
        (b.depends_on?.length ?? 0) - (a.depends_on?.length ?? 0),
    );

    if (!unique.length) {
      return;
    }

    let deleted = 0;
    for (const task of unique) {
      // Try project-scoped delete first, then global
      let delRes = await page.request.delete(
        `${API}/projects/proj-default/tasks/${task.id}`,
      );
      if (!delRes.ok()) {
        delRes = await page.request.delete(`${API}/tasks/${task.id}`);
      }
      if (delRes.ok()) {
        deleted++;
      }
    }

    if (deleted === 0) {
      return;
    }
  }
}

async function openTaskDetail(page: Page, titleText: string) {
  const card = page
    .locator("[data-task-id]")
    .filter({ has: page.getByRole("heading", { name: titleText }) })
    .first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  const detail = page.getByTestId("task-detail");
  await expect(detail).toBeVisible({ timeout: 5000 });
  return detail;
}

async function createTaskUI(
  page: Page,
  input: {
    title: string;
    description?: string;
    engine?: "auto" | "claude" | "codex";
    plan?: boolean;
  },
) {
  const textarea = page.locator("textarea").filter({ hasText: "" }).first();
  await textarea.fill(
    `${input.title}${input.description ? `\n${input.description}` : ""}`,
  );
  if (input.plan) {
    await page.getByText("Plan 模式").click();
  }
  if (input.engine && input.engine !== "auto") {
    await page
      .getByRole("button", {
        name: input.engine === "claude" ? "Claude" : "Codex",
      })
      .click();
  }
  await page.getByRole("button", { name: "添加" }).click();
  await expect(
    page.getByRole("heading", { name: input.title }).first(),
  ).toBeVisible({ timeout: 5000 });
}

async function createTaskAPI(
  page: Page,
  create: Record<string, unknown>,
  patch?: Record<string, unknown>,
): Promise<string> {
  // Use project-scoped endpoint so tasks appear in the UI
  const res = await page.request.post(
    `${API}/projects/proj-default/tasks`,
    { data: create },
  );
  const task = await res.json();
  if (patch) {
    await page.request.patch(
      `${API}/projects/proj-default/tasks/${task.id}`,
      { data: patch },
    );
  }
  return task.id;
}

async function setAllWorkersStatus(page: Page, status: "idle" | "busy") {
  const workersRes = await page.request.get(`${API}/workers`);
  const workersData = await workersRes.json();
  for (const worker of workersData.workers ?? []) {
    await page.request.patch(`${API}/workers/${worker.id}`, {
      data: {
        status,
        current_task_id: null,
      },
    });
  }
}

async function withManualStateControl(page: Page, run: () => Promise<void>) {
  await setAllWorkersStatus(page, "busy");
  try {
    await run();
  } finally {
    await setAllWorkersStatus(page, "idle");
  }
}

test.describe.serial("Agent Kanban - Full E2E Flow", () => {
  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await cleanTestTasks(page);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await page.goto("/tasks", {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        await page.waitForSelector("h1", { timeout: 15000 });
        return;
      } catch {
        await page.waitForTimeout(500);
      }
    }
    await page.goto("/tasks", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("h1", { timeout: 30000 });
  });

  test("01 - 页面布局与 Kanban 列", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "任务看板" }),
    ).toBeVisible();
    await expect(page.getByText(/个任务/)).toBeVisible();

    for (const col of [
      "待开发",
      "开发中",
      "待审批",
      "子任务中",
      "待 Review",
      "已完成",
      "失败",
      "已取消",
    ]) {
      await expect(
        page.getByRole("heading", { name: col, exact: true }),
      ).toBeVisible();
    }

    const statusBadge = page.getByText("在线").or(page.getByText("离线"));
    await expect(statusBadge.first()).toBeVisible();
    await screenshot(page, "01-page-layout-columns-stats");
  });

  test("02 - 创建 Auto 引擎任务", async ({ page }) => {
    await screenshot(page, "02a-before-create");
    await createTaskUI(page, {
      title: `${PREFIX} 实现新功能`,
      description: "用 JWT 验证用户身份",
    });
    await screenshot(page, "02b-auto-task-created");
  });

  test("03 - 创建 Claude 引擎任务", async ({ page }) => {
    await createTaskUI(page, {
      title: `${PREFIX} 修复数据库连接 bug`,
      description: "修复连接池泄漏",
      engine: "claude",
    });
    await screenshot(page, "03-claude-task-created");
  });

  test("04 - 创建 Codex 引擎任务", async ({ page }) => {
    await createTaskUI(page, {
      title: `${PREFIX} Code Review 安全审查`,
      description: "审查 API 安全性",
      engine: "codex",
    });
    await screenshot(page, "04-codex-task-created");
  });

  test("05 - 创建 Plan 模式任务", async ({ page }) => {
    await createTaskUI(page, {
      title: `${PREFIX} 设计微服务架构`,
      description: "需要先做设计评审",
      plan: true,
    });
    const card = page
      .locator("[data-task-id]")
      .filter({
        has: page.getByRole("heading", { name: `${PREFIX} 设计微服务架构` }),
      })
      .first();
    await expect(card.getByText("Plan")).toBeVisible();
    await screenshot(page, "05-plan-mode-task");
  });

  test("06 - Cmd+Enter 快捷键提交", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.fill(`${PREFIX} 快捷键提交测试`);
    await textarea.press("Meta+Enter");
    await expect(
      page.getByRole("heading", { name: `${PREFIX} 快捷键提交测试` }),
    ).toBeVisible({ timeout: 5000 });
    await screenshot(page, "06-keyboard-shortcut-submit");
  });

  test("07 - 引擎选择切换", async ({ page }) => {
    const autoBtn = page.getByRole("button", { name: "Auto" });
    await screenshot(page, "07a-engine-auto");
    await page.getByRole("button", { name: "Claude" }).click();
    await screenshot(page, "07b-engine-claude");
    await page.getByRole("button", { name: "Codex" }).click();
    await screenshot(page, "07c-engine-codex");
    await autoBtn.click();
    await screenshot(page, "07d-engine-auto-again");
  });

  test("08 - 任务详情面板 - 打开与关闭", async ({ page }) => {
    await createTaskUI(page, {
      title: `${PREFIX} 详情面板测试`,
      description: "测试详情面板功能",
    });
    const detail = await openTaskDetail(page, `${PREFIX} 详情面板测试`);
    await expect(detail.getByText("优先级")).toBeVisible();
    await expect(detail.getByText("任务类型")).toBeVisible();
    await expect(detail.getByText("创建时间")).toBeVisible();
    await screenshot(page, "08a-detail-panel-open");
    await detail.getByRole("button", { name: "关闭对话框" }).click();
    await expect(page.getByTestId("task-detail")).toBeHidden();
    await screenshot(page, "08b-detail-panel-closed");
  });

  test("09 - 状态流转: 待开发 -> 开发中 -> 已完成", async ({ page }) => {
    await withManualStateControl(page, async () => {
      await createTaskUI(page, {
        title: `${PREFIX} 完整生命周期`,
        description: "测试状态流转",
      });
      const detail = await openTaskDetail(page, `${PREFIX} 完整生命周期`);
      await detail.getByRole("button", { name: "开发中" }).click();
      await expect(
        detail.getByRole("button", { name: "已完成" }),
      ).toBeVisible({ timeout: 5000 });
      await screenshot(page, "09a-status-in-progress");
      await detail.getByRole("button", { name: "已完成" }).click();
      await expect(detail.getByText("已完成").first()).toBeVisible({
        timeout: 5000,
      });
      await screenshot(page, "09b-status-completed");
      await detail.getByRole("button", { name: "关闭对话框" }).click();
    });
  });

  test("10 - 状态流转: 开发中 -> 待 Review -> 已完成", async ({ page }) => {
    await withManualStateControl(page, async () => {
      await createTaskUI(page, {
        title: `${PREFIX} Review 流程`,
        description: "测试 Review 状态流转",
      });
      const detail = await openTaskDetail(page, `${PREFIX} Review 流程`);
      await detail.getByRole("button", { name: "开发中" }).click();
      await expect(
        detail.getByRole("button", { name: "待 Review" }),
      ).toBeVisible({ timeout: 5000 });
      await detail.getByRole("button", { name: "待 Review" }).click();
      await expect(
        detail.getByRole("button", { name: "已完成" }),
      ).toBeVisible({ timeout: 5000 });
      await screenshot(page, "10a-status-reviewing");
      await detail.getByRole("button", { name: "已完成" }).click();
      await expect(detail.getByText("已完成").first()).toBeVisible({
        timeout: 5000,
      });
      await screenshot(page, "10b-review-completed");
      await detail.getByRole("button", { name: "关闭对话框" }).click();
    });
  });

  test("11 - 状态流转: 失败与重试", async ({ page }) => {
    await withManualStateControl(page, async () => {
      await createTaskUI(page, {
        title: `${PREFIX} 失败重试`,
        description: "测试失败重试流程",
      });
      const detail = await openTaskDetail(page, `${PREFIX} 失败重试`);
      await detail.getByRole("button", { name: "开发中" }).click();
      await expect(
        detail.getByRole("button", { name: "失败" }),
      ).toBeVisible({ timeout: 5000 });
      await detail.getByRole("button", { name: "失败" }).click();
      await expect(
        detail.getByRole("button", { name: "待开发" }),
      ).toBeVisible({ timeout: 5000 });
      await screenshot(page, "11a-status-failed");
      await detail.getByRole("button", { name: "待开发" }).click();
      await expect(
        detail.getByRole("button", { name: "开发中" }),
      ).toBeVisible({ timeout: 5000 });
      await screenshot(page, "11b-status-retried");
      await detail.getByRole("button", { name: "关闭对话框" }).click();
    });
  });

  test("12 - 取消任务", async ({ page }) => {
    await withManualStateControl(page, async () => {
      await createTaskUI(page, {
        title: `${PREFIX} 取消测试`,
        description: "测试取消功能",
      });
      const detail = await openTaskDetail(page, `${PREFIX} 取消测试`);
      await detail.getByRole("button", { name: "已取消" }).click();
      await expect(
        detail.getByRole("button", { name: "待开发" }),
      ).toBeVisible({ timeout: 5000 });
      await screenshot(page, "12-task-cancelled");
      await detail.getByRole("button", { name: "关闭对话框" }).click();
    });
  });

  test("13 - 删除任务", async ({ page }) => {
    await createTaskUI(page, {
      title: `${PREFIX} 删除测试`,
      description: "测试删除功能",
    });
    await screenshot(page, "13a-before-delete");
    const detail = await openTaskDetail(page, `${PREFIX} 删除测试`);
    page.on("dialog", (dialog) => dialog.accept());
    await detail.getByRole("button", { name: "删除" }).click();
    await page.waitForTimeout(1000);
    await expect(
      page.getByRole("heading", { name: `${PREFIX} 删除测试` }),
    ).toBeHidden();
    await screenshot(page, "13b-after-delete");
  });

  test("14 - 任务详情: Plan 和 Commits 展示", async ({ page }) => {
    await createTaskAPI(
      page,
      {
        title: `${PREFIX} 会议安排功能`,
        description: "集成日历 API",
        engine: "auto",
        plan_mode: true,
      },
      {
        plan_content:
          "集成 Google Calendar API，实现会议创建、修改和提醒功能",
        commit_ids: ["ghi9012", "jkl3456"],
      },
    );
    await page.reload();
    await page.waitForSelector("h1", { timeout: 15000 });
    const detail = await openTaskDetail(page, `${PREFIX} 会议安排功能`);
    await expect(detail.getByText(/开发计划|Plan 审批/)).toBeVisible();
    await expect(
      detail.getByText("集成 Google Calendar API"),
    ).toBeVisible();
    await expect(detail.getByText("Commits")).toBeVisible();
    await expect(detail.getByText("ghi9012")).toBeVisible();
    await expect(detail.getByText("jkl3456")).toBeVisible();
    await screenshot(page, "14-task-plan-commits");
    await detail.getByRole("button", { name: "关闭对话框" }).click();
  });

  test("15 - 任务详情: 错误日志与重试次数", async ({ page }) => {
    await createTaskAPI(
      page,
      {
        title: `${PREFIX} 文档导出失败`,
        description: "PDF 导出功能",
        engine: "auto",
      },
      {
        status: "failed",
        error_log: "puppeteer 中文字体加载失败，PDF 渲染异常",
        retry_count: 2,
        started_at: new Date().toISOString(),
      },
    );
    await page.reload();
    await page.waitForSelector("h1", { timeout: 15000 });
    const detail = await openTaskDetail(page, `${PREFIX} 文档导出失败`);
    await expect(detail.getByText("错误日志")).toBeVisible();
    await expect(
      detail.getByText("puppeteer 中文字体加载失败"),
    ).toBeVisible();
    await expect(detail.getByText(/重试次数/)).toBeVisible();
    await screenshot(page, "15-task-error-log");
    await detail.getByRole("button", { name: "关闭对话框" }).click();
  });

  test("16 - 任务详情: Worker 分配信息", async ({ page }) => {
    await createTaskAPI(
      page,
      {
        title: `${PREFIX} 中英文间距修复`,
        description: "修复 CSS 排版",
        engine: "auto",
      },
      {
        status: "in_progress",
        assigned_worker: "worker-0",
        started_at: new Date().toISOString(),
      },
    );
    await page.reload();
    await page.waitForSelector("h1", { timeout: 15000 });
    const detail = await openTaskDetail(page, `${PREFIX} 中英文间距修复`);
    await expect(detail.getByText("分配 Worker")).toBeVisible();
    await expect(detail.getByText("worker-0")).toBeVisible();
    await screenshot(page, "16-task-worker-info");
    await detail.getByRole("button", { name: "关闭对话框" }).click();
  });

  test("17 - 智能路由: Feature -> Claude", async ({ request }) => {
    const res = await request.post(`${API}/tasks`, {
      data: {
        title: `${PREFIX} 实现新报表功能`,
        description: "新增看板拖拽",
        engine: "auto",
      },
    });
    const task = await res.json();
    expect(task.task_type).toBe("feature");
    expect(task.routed_engine).toBe("claude");
    await request.delete(`${API}/tasks/${task.id}`);
  });

  test("18 - 智能路由: Review -> Codex", async ({ request }) => {
    const res = await request.post(`${API}/tasks`, {
      data: {
        title: `${PREFIX} 安全审查`,
        description: "code review 检查",
        engine: "auto",
      },
    });
    const task = await res.json();
    expect(task.task_type).toBe("review");
    expect(task.routed_engine).toBe("codex");
    await request.delete(`${API}/tasks/${task.id}`);
  });

  test("19 - 智能路由: Bugfix -> Claude", async ({ request }) => {
    const res = await request.post(`${API}/tasks`, {
      data: {
        title: `${PREFIX} 修复登录页 crash bug`,
        description: "紧急修复",
        engine: "auto",
      },
    });
    const task = await res.json();
    expect(task.task_type).toBe("bugfix");
    expect(task.routed_engine).toBe("claude");
    await request.delete(`${API}/tasks/${task.id}`);
  });

  test("20 - 智能路由: Refactor -> Codex", async ({ request }) => {
    const res = await request.post(`${API}/tasks`, {
      data: {
        title: `${PREFIX} 重构用户模块`,
        description: "优化代码结构",
        engine: "auto",
      },
    });
    const task = await res.json();
    expect(task.task_type).toBe("refactor");
    expect(task.routed_engine).toBe("codex");
    await request.delete(`${API}/tasks/${task.id}`);
  });

  test("21 - API: Workers 列表", async ({ request }) => {
    const res = await request.get(`${API}/workers`);
    const data = await res.json();
    expect(data.workers).toHaveLength(5);
    const claudeWorkers = data.workers.filter(
      (w: { engine: string }) => w.engine === "claude",
    );
    const codexWorkers = data.workers.filter(
      (w: { engine: string }) => w.engine === "codex",
    );
    expect(claudeWorkers).toHaveLength(3);
    expect(codexWorkers).toHaveLength(2);
  });

  test("22 - API: 引擎健康状态", async ({ request }) => {
    const res = await request.get(`${API}/engines/health`);
    const data = await res.json();
    expect(data.engines.claude.healthy).toBe(true);
    expect(data.engines.codex.healthy).toBe(true);
    expect(data.engines.claude.workers_total).toBe(3);
    expect(data.engines.codex.workers_total).toBe(2);
  });

  test("23 - API: 系统健康检查", async ({ request }) => {
    const res = await request.get(`${API}/health`);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.engines.claude).toBe(true);
    expect(data.engines.codex).toBe(true);
  });

  test("24 - WebSocket 实时推送", async ({ page }) => {
    await page.waitForTimeout(2000);
    await expect(page.getByText("在线")).toBeVisible({ timeout: 5000 });
    await screenshot(page, "24a-websocket-connected");
    await page.request.post(`${API}/tasks`, {
      data: {
        title: `${PREFIX} WebSocket 推送测试`,
        description: "通过 API 创建，验证 WebSocket 推送",
        engine: "auto",
        plan_mode: false,
      },
    });
    await expect(
      page.getByRole("heading", { name: `${PREFIX} WebSocket 推送测试` }),
    ).toBeVisible({ timeout: 5000 });
    await screenshot(page, "24b-websocket-realtime");
  });

  test("25 - 多任务看板全景", async ({ page }) => {
    const titles = [
      `${PREFIX} 开发支付模块`,
      `${PREFIX} 分析性能瓶颈`,
      `${PREFIX} 修复内存泄漏`,
      `${PREFIX} 重构认证模块`,
    ];
    for (const title of titles) {
      await createTaskUI(page, { title });
    }
    await screenshot(page, "25-multiple-tasks-overview");
  });

  test("26 - 全局看板截图", async ({ page }) => {
    await screenshot(page, "26-final-full-board");
  });
});
