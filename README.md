# Agent Kanban 开发与部署手册

> 按照 `SYSTEM.md` 的架构落地的最小可用版本，包含后台调度 API、前端 PWA 看板，以及双引擎 (Claude / Codex) 协同所需的基础流程。

## 一键本地启动

### 1) 后端 (FastAPI)
```bash
cd backend
pip install -r requirements.txt  # 或 uv pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
- API: `http://127.0.0.1:8000/api/*`
- WS:  `ws://127.0.0.1:8000/ws/tasks`

### 2) 前端 (Next.js + Tailwind)
```bash
cd frontend
npm install
npm run dev -- --port 3000
```
- 已在 `next.config.ts` 配置反向代理，前端的 `/api`、`/ws` 会自动指向本地 8000 端口。

## 目录与项目分类（服务器侧）

推荐在服务器上按照引擎与用途拆分目录，便于扩容和备份：

```
/srv/agent-kanban/
├── main-repo/               # 主仓库（main 分支）
│   ├── backend/             # FastAPI Dispatcher
│   ├── frontend/            # Next.js Web Manager
│   ├── CLAUDE.md            # Claude Worker 行为规范
│   ├── codex.md             # Codex Worker 行为规范
│   ├── PROGRESS.md          # 经验库
│   └── data/                # 共享任务与锁
│       ├── dev-tasks.json
│       └── dev-task.lock
├── worktrees/               # Git worktree，按引擎划分
│   ├── claude-0/            # Claude Worker 0
│   ├── claude-1/
│   ├── claude-2/
│   ├── codex-0/             # Codex Worker 0
│   └── codex-1/
└── backups/                 # 自动备份目录（例如 cron 每小时一次）
```

### 项目/任务分类规则
- **feature / bugfix / plan / test** → 默认路由到 **Claude**。
- **review / refactor / analysis / audit** → 默认路由到 **Codex**。
- Plan 任务默认进入 `plan_review` 列，审批后进入开发。
- 支持 `depends_on`：依赖未完成的任务不会被派发。
- 优先级 `high > medium > low`，用于 Ralph Loop 取任务时排序。

## Claude 与 Codex 设置细节

### Claude Code CLI
- 环境变量：`ANTHROPIC_API_KEY` 或 `CLAUDE_API_KEY`（按 CLI 要求）。
- 推荐启动参数：
  ```bash
  claude -p "[prompt]" \
    --dangerously-skip-permissions \
    --output-format stream-json \
    --verbose
  ```
- Plan 模式允许的工具可以在调用时通过 `--allowedTools` 指定（如 `Read,Glob,Grep`）。

### OpenAI Codex CLI
- 环境变量：`OPENAI_API_KEY`。
- 推荐启动参数：
  ```bash
  codex exec "[prompt]" --json --full-auto
  # 需要结构化输出时可加 --output-schema '{...}'
  # 恢复对话：codex exec resume --last
  ```
- Codex 自带沙箱（Seatbelt / Landlock），Claude 则建议运行在容器内并传入 `--dangerously-skip-permissions`。

### Worker 配置（与 `SYSTEM.md` 对齐）
- 默认端口：Claude 5200-5202，Codex 5203-5204。
- 每个 Worker 独立 worktree，`data/`、`CLAUDE.md`/`codex.md` 用 symlink 共享。
- 完成任务后遵循 CLAUDE.md / codex.md 的提交与合并流程。

## 后台 API 与调度要点
- `POST /api/tasks`：创建任务，Plan 任务初始状态为 `plan_review`。
- `PATCH /api/tasks/{id}`：更新状态、计划内容、分配 Worker、错误日志、Review 结果等。
- `POST /api/dispatcher/next`：Ralph Loop 拉取下一个可执行任务（按优先级 + 依赖过滤），自动切到 `in_progress` 并可绑定 `worker_id`。
- **对抗式 Review**：feature/bugfix/refactor 完成后自动生成反向 Review 子任务，交给另一引擎处理。
- `GET /api/engines/health` 与 `PATCH /api/engines/{engine}/health`：查询/标记引擎可用性，支持故障转移逻辑。
- WebSocket `/ws/tasks`：推送 task_created / task_updated / task_deleted 事件。

## 运维提示
- 生产环境建议用 Nginx / Caddy 反代 3000/8000 端口并开启 HTTPS、Basic Auth。
- 通过 Tailscale / Cloudflare Tunnel 建立远程安全访问。
- 设置 cron 备份：每小时复制 `data/` 与 `PROGRESS.md` 到 `/srv/agent-kanban/backups/`，保留最近 72 小时。
- Claude / Codex API 超额、Worker 连续失败、双引擎同时不可用等场景请参见 `SYSTEM.md` 的 7 个红色人类介入点。

有了以上配置，手机端 PWA + 后台 Ralph Loop 就能在无人值守的情况下持续把任务流转到 Claude / Codex，保持 1 分钟 1 个 commit 的节奏。
