# Agent Kanban 开发与部署手册

> 面向双引擎（Claude / Codex）协同开发的任务调度系统：包含 FastAPI 后端、Next.js PWA 看板、自动派发与对抗式 Review 流程。

## TL;DR（30 秒快速理解）

- **你要做什么？** 把任务交给系统，让 Claude/Codex 自动领取、执行、Review，并把状态回写到看板。
- **最快上手路径：** 按 [快速开始（本地）](#快速开始本地) 启动前后端，再执行 [5 分钟功能演练](#5-分钟功能演练从创建到完成)。
- **要看细节：**
  - 功能与入口：看 [功能清单（具体到功能）](#功能清单具体到功能)
  - API 用法：看 [按功能的 API 使用说明](#按功能的-api-使用说明)
  - 部署运维：看 [生产部署与运维](#生产部署与运维)

## 目录

- [快速开始（本地）](#快速开始本地)
- [功能清单（具体到功能）](#功能清单具体到功能)
- [5 分钟功能演练（从创建到完成）](#5-分钟功能演练从创建到完成)
- [按功能的 API 使用说明](#按功能的-api-使用说明)
- [系统架构与任务流](#系统架构与任务流)
- [配置矩阵](#配置矩阵)
- [目录与部署建议](#目录与部署建议)
- [生产部署与运维](#生产部署与运维)
- [FAQ（常见问题）](#faq常见问题)
- [文档地图](#文档地图)

## 快速开始（本地）

### 前置条件

- Python 3.10+
- Node.js 18+
- `pip` / `npm` 可用
- 至少一个引擎 API Key：
  - Claude: `ANTHROPIC_API_KEY` 或 `CLAUDE_API_KEY`
  - Codex: `OPENAI_API_KEY`

### 1) 启动后端（FastAPI）

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**成功信号（至少满足 1 条）：**

- 打开 `http://127.0.0.1:8000/api/health` 返回健康 JSON。
- 打开 `http://127.0.0.1:8000/api/engines/health` 返回引擎状态。

### 2) 启动前端（Next.js + Tailwind）

```bash
cd frontend
npm install
npm run dev -- --port 3000
```

**成功信号（至少满足 1 条）：**

- 打开 `http://127.0.0.1:3000` 可看到看板页面。
- 创建任务后列表可刷新（说明前端→后端 API 连通）。

> `next.config.ts` 已配置本地代理，前端请求 `/api` 与 `/ws` 会转发到 `127.0.0.1:8000`。

### 3) 最小连通性验证

```bash
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8000/api/engines/health
curl http://127.0.0.1:8000/api/tasks
```

浏览器控制台验证 WebSocket：

```js
new WebSocket('ws://127.0.0.1:8000/ws/tasks')
```

---

## 功能清单（具体到功能）

以下是系统“可以做什么”，以及你应该调用哪个入口。

### 1) 任务创建与管理

- 创建任务：`POST /api/tasks`
- 查询任务列表：`GET /api/tasks`
- 查询单任务：`GET /api/tasks/{task_id}`
- 更新任务字段：`PATCH /api/tasks/{task_id}`
- 删除任务：`DELETE /api/tasks/{task_id}`

**支持的关键字段（创建时）：**

- `title`：任务标题（必填）
- `description`：任务描述
- `engine`：`auto | claude | codex`
- `task_type`：`feature | bugfix | review | refactor | analysis | plan | audit`（项目子任务拆解接口可扩展）
- `priority`：`high | medium | low`
- `depends_on`：依赖任务 ID 列表
- `acceptance_criteria`：验收标准数组
- `rollback_plan`：回滚方案

### 2) 调度与自动执行

- 获取下一个可执行任务：`POST /api/dispatcher/next`
- 查看调度队列：`GET /api/dispatcher/queue`
- 查看调度状态：`GET /api/dispatcher/status`
- 开关调度器：`POST /api/dispatcher/toggle`
- 手动触发一次调度：`POST /api/dispatcher/trigger`

### 3) Worker 生命周期（协议接口）

- 领取：`POST /api/tasks/{task_id}/claim`
- 心跳：`POST /api/tasks/{task_id}/heartbeat`
- 完成：`POST /api/tasks/{task_id}/complete`
- 失败：`POST /api/tasks/{task_id}/fail`
- 强制派发：`POST /api/tasks/{task_id}/dispatch`

### 4) Plan / 拆解 / 重试

- 审批计划：`POST /api/tasks/{task_id}/approve-plan`
- 拆解子任务：`POST /api/tasks/{task_id}/decompose`
- 重试任务：`POST /api/tasks/{task_id}/retry`

### 5) Review 与质量闭环

- 发起 review：`POST /api/tasks/{task_id}/review`
- 提交 review：`POST /api/tasks/{task_id}/review-submit`
- 查看时间线：`GET /api/tasks/{task_id}/timeline`
- 查看 attempts：`GET /api/tasks/{task_id}/attempts`

### 6) 引擎与 Worker 运维

- 引擎健康检查：`GET /api/engines/health`
- 修改引擎健康：`PATCH /api/engines/{engine}/health`
- Worker 列表：`GET /api/workers`
- Worker 详情：`GET /api/workers/{worker_id}`
- Worker 日志：`GET /api/workers/{worker_id}/logs`

### 7) 项目维度（多项目隔离）

- 项目 CRUD：`/api/projects*`
- 项目内任务：`/api/projects/{project_id}/tasks*`
- 项目统计：`GET /api/projects/{project_id}/stats`
- 项目事件：`GET /api/projects/{project_id}/events`

---

## 5 分钟功能演练（从创建到完成）

下面是“真实可跑”的最小链路，按顺序执行即可看到系统工作。

### Step 1：创建一个 feature 任务

```bash
curl -X POST http://127.0.0.1:8000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "接入任务详情抽屉",
    "description": "在看板中支持点击任务查看详情",
    "task_type": "feature",
    "engine": "auto",
    "priority": "high",
    "acceptance_criteria": [
      "点击任务卡片可打开详情抽屉",
      "抽屉展示标题、状态、负责人"
    ]
  }'
```

### Step 2：查看任务是否入队

```bash
curl http://127.0.0.1:8000/api/tasks
curl http://127.0.0.1:8000/api/dispatcher/queue
```

### Step 3：手动拉取一个待执行任务（模拟 Ralph Loop）

```bash
curl -X POST http://127.0.0.1:8000/api/dispatcher/next \
  -H 'Content-Type: application/json' \
  -d '{"allow_plan_tasks": false}'
```

### Step 4：查看任务状态变化

```bash
curl http://127.0.0.1:8000/api/tasks
curl http://127.0.0.1:8000/api/tasks/<task_id>
```

> 你会看到任务从 `pending` 进入 `in_progress`（视调度和 worker 状态而定）。

### Step 5：查看执行轨迹

```bash
curl http://127.0.0.1:8000/api/tasks/<task_id>/timeline
curl http://127.0.0.1:8000/api/tasks/<task_id>/attempts
```

---

## 按功能的 API 使用说明

> 本节面向“我要做某件事，应该怎么调 API”。

### A. 创建任务（最常用）

```bash
curl -X POST http://127.0.0.1:8000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "修复任务排序",
    "task_type": "bugfix",
    "engine": "codex",
    "priority": "medium",
    "depends_on": ["task-001"],
    "rollback_plan": "若排序异常则回退到旧 comparator"
  }'
```

### B. 审批 Plan 任务

```bash
curl -X POST http://127.0.0.1:8000/api/tasks/<task_id>/approve-plan \
  -H 'Content-Type: application/json' \
  -d '{"approved": true, "feedback": "按 B 方案继续"}'
```

### C. 拆解子任务

```bash
curl -X POST http://127.0.0.1:8000/api/tasks/<task_id>/decompose \
  -H 'Content-Type: application/json' \
  -d '{
    "sub_tasks": [
      {"title": "新增 API 字段", "task_type": "feature", "engine": "claude", "priority": "high"},
      {"title": "补充回归测试", "task_type": "test", "engine": "codex", "priority": "medium"}
    ]
  }'
```

### D. 标记引擎故障/恢复（运维）

```bash
curl -X PATCH http://127.0.0.1:8000/api/engines/claude/health \
  -H 'Content-Type: application/json' \
  -d '{"healthy": false}'
```

### E. 查看统计

```bash
curl http://127.0.0.1:8000/api/stats
curl http://127.0.0.1:8000/api/stats/daily
```

---

## 系统架构与任务流

### 任务状态（你会在看板上看到）

- `pending`：待执行
- `in_progress`：执行中
- `plan_review`：等待人工审批计划
- `blocked_by_subtasks`：等待子任务完成
- `reviewing`：审查中
- `completed`：完成
- `failed`：失败
- `cancelled`：取消

### 默认路由规则

- `feature / bugfix / plan` → 默认到 **Claude**
- `review / refactor / analysis / audit` → 默认到 **Codex**
- 优先级：`high > medium > low`
- `depends_on` 未满足的任务不会被派发

### 自动 Review 机制（对抗式）

对 `feature/bugfix/refactor` 类任务，系统可自动创建反向 review 子任务，交给另一引擎执行，实现“开发引擎 ≠ 审查引擎”的质量闭环。

---

## 配置矩阵

| 配置项 | 组件 | 必填 | 默认值 | 用途 |
|---|---|---|---|---|
| `OPENAI_API_KEY` | Codex CLI | 用 Codex 时必填 | 无 | Codex 调用凭证 |
| `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` | Claude CLI | 用 Claude 时必填 | 无 | Claude 调用凭证 |
| `WORKTREE_PROVIDER` | Dispatcher/Worker | 否 | `git` | `git`/`claude`/`auto` |
| `CLAUDE_WORKTREE_CMD` | Worktree 外部命令 | 视 provider 而定 | 无 | 必须包含 `{repo}` `{path}` `{branch}` |
| Worker 端口 | Worker 池 | 否 | Claude `5200-5202`、Codex `5203-5204` | 多 worker 编排 |

### 推荐 CLI 参数

Claude：

```bash
claude -p "[prompt]" --dangerously-skip-permissions --output-format stream-json --verbose
```

Codex：

```bash
codex exec "[prompt]" --json --full-auto
```

---

## 目录与部署建议

```text
/srv/agent-kanban/
├── main-repo/
│   ├── backend/             # FastAPI Dispatcher
│   ├── frontend/            # Next.js 看板
│   ├── CLAUDE.md            # Claude Worker 规范
│   ├── codex.md             # Codex Worker 规范
│   ├── PROGRESS.md          # 经验库
│   └── data/                # 共享任务与锁
├── worktrees/               # 按引擎拆分 worktree
└── backups/                 # 备份
```

建议：`main-repo` 保持干净可回滚，所有自动执行在 `worktrees/` 内进行，避免污染主仓库。

---

## 生产部署与运维

### 最小上线清单

1. Nginx/Caddy 反向代理 `3000/8000` + HTTPS。
2. API Key 放入系统环境变量（不要写进仓库）。
3. 打开备份策略：每小时备份 `data/` 与 `PROGRESS.md`，保留 72 小时。
4. 建立引擎可用性巡检：定时调用 `GET /api/engines/health`。

### 常用运维动作

- 暂停调度器：`POST /api/dispatcher/toggle`
- 人工触发一次调度：`POST /api/dispatcher/trigger`
- 将故障引擎摘除：`PATCH /api/engines/{engine}/health`
- 查 worker 日志：`GET /api/workers/{worker_id}/logs`

---

## FAQ（常见问题）

### 1) 任务创建成功但不执行？

按顺序检查：

1. `GET /api/engines/health` 是否有可用引擎；
2. `GET /api/dispatcher/status` 是否启用调度；
3. 任务是否被 `depends_on` 阻塞；
4. 是否处于 `plan_review` 等待人工审批。

### 2) 前端看板没实时更新？

- 检查 `/ws/tasks` 连接是否成功（浏览器 Network → WS）。
- 检查前端代理是否正确指向 `127.0.0.1:8000`。

### 3) 某个引擎频繁失败怎么处理？

- 先 `PATCH /api/engines/{engine}/health` 置为 `false`，让任务切到另一引擎。
- 排查 API 配额、CLI 版本、网络连通性后再恢复为 `true`。

### 4) 如何按项目隔离任务数据？

- 使用 `/api/projects` 创建项目，然后使用 `/api/projects/{project_id}/tasks` 进行项目内任务管理。

---

## 文档地图

- `README.md`：上手、功能说明、API 快速用法。
- `SYSTEM.md`：架构原理、调度策略、人工介入点。
- `docs/SETUP-GUIDE.md`：完整安装与初始化。
- `docs/PROJECT-STRUCTURE.md`：模块目录与职责。

