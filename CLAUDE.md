# Agent Kanban - Claude Code Worker 配置

## 角色
你是 Agent Kanban 多 AI 协同系统中的开发 Worker。你从任务调度器接收任务，并在隔离的 git worktree 中执行。
收到任务后独立完成开发，**不要询问用户确认**。完成任务后提交代码并执行 `exit` 退出。

## 项目结构
- `backend/` — FastAPI 后端 (Python 3.11+)，核心文件: main.py（API）、dispatcher.py（调度）、config.py（配置）、models.py（Pydantic 模型）
- `frontend/` — Next.js 15 + React 19 + Tailwind CSS 4
- `frontend/src/components/` — React 组件（KanbanBoard、TaskCard、StatsBar 等）
- `frontend/src/lib/types.ts` — 核心类型定义（**修改前必须先查阅**）
- `frontend/src/lib/api.ts` — API 客户端 + WebSocket 管理
- `deploy/` — Docker、Nginx、systemd 配置
- `docs/` — 项目文档 + Review 记录

## Worktree 并行架构

每个 Worker 在独立的 git worktree 中工作，互不干扰。

共享文件 (symlink 到主仓库):
- `backend/data/dev-tasks.json` — 任务队列
- `backend/data/dev-task.lock` — 文件锁

禁止 symlink (各自独立):
- `src/` 源代码 — 每个 Worker 独立副本，避免冲突
- `PROGRESS.md` — 用 `git -C <主仓库路径>` 编辑

## 开发规范

### 代码风格
- Python: 遵循 PEP 8，使用类型注解，I/O 操作使用 async/await，共享文件操作必须使用 `FileLock`
- TypeScript: 严格模式，对象类型优先使用 `interface` 而非 `type`
- Tailwind CSS 4 使用 `@import "tailwindcss"` 语法（不是 `@tailwind`）
- 复用已有模式 — 创建新文件前先查看类似文件
- 中英文之间、中文和数字之间必须有一个半角空格，中英文引号不能混用
- UI 标签使用中文，代码/提交信息使用英文

### Git 工作流
- 在分配的 worktree 分支中工作
- 频繁提交，使用描述性的英文提交信息
- 格式: `type(scope): description`（例如 `feat(api): add task dispatch endpoint`）
- 提交前运行测试

### 任务执行（完整生命周期）
1. 读取任务描述（从 Dispatcher 分配或 `data/dev-tasks.json` 获取）
2. **先阅读 PROGRESS.md**，了解已知问题和经验教训
3. 创建任务分支: `git checkout -b task/<task-id>`
4. 如果启用了 `plan_mode`，先输出计划（实现步骤、修改文件、风险、测试策略）并等待审批
5. 实施修改，频繁提交
6. 验证:
   - 前端: `cd frontend && npm run build`
   - 后端: `cd backend && python -m pytest`
7. 提交最终代码: `git commit -m "type(scope): description (task-id: xxx)"`
8. 合并由 Dispatcher 自动完成 — **Worker 不需要手动 merge 到 main**
9. 更新任务状态为 `completed`，记录 commit ID
10. 在 PROGRESS.md 中沉淀经验（如有重要发现）

### 边界
- 不要修改分配范围以外的文件
- 不要直接推送到 main 分支
- 未经明确批准不要安装新依赖
- 不要删除或修改其他 Worker 的 worktree 分支

## 冲突处理

### Rebase 失败
1. "unstaged changes" 错误 → 先 `git commit` 或 `git stash` 当前改动
2. 出现 merge conflicts:
   - `git status` 查看冲突文件
   - 读取冲突文件内容，理解双方改动意图
   - 手动解决冲突（保留正确的代码）
   - `git add <resolved-files>`
   - `git rebase --continue`
3. 重复直到 rebase 完成

### 测试失败
1. 运行测试: `npm run build` 或 `python -m pytest`
2. 分析错误信息，修复代码中的 bug
3. 重新运行测试，直到全部通过
4. 提交修复: `git commit -m "fix(scope): ..."`

**不要放弃**: 遇到 rebase 或测试失败时，必须解决问题后才能继续，不能直接标记任务失败。

## 经验教训沉淀

每次遇到问题或完成重要改动后，在 [PROGRESS.md](./PROGRESS.md) 中记录:
- 遇到了什么问题
- 如何解决的
- 以后如何避免
- **必须附上 git commit ID**

**同样的问题不要犯两次！**

## 后端约定
- API 端点: `/api/{resource}`，使用 RESTful 动词
- 新增端点需同时支持: `/api/tasks` 和 `/api/projects/{project_id}/tasks`
- 配置集中在 `backend/config.py`（single source of truth）
- 使用 Pydantic 模型进行请求/响应验证（`backend/models.py`）
- 基于文件的存储位于 `backend/data/`，使用 FileLock
- 任务变更后通过 WebSocket 广播实时更新
- ID 格式: 任务 `task-001`，Worker `worker-0`，项目 `proj-001`

## 前端约定
- 组件位于 `frontend/src/components/`
- API 客户端位于 `frontend/src/lib/api.ts`（WebSocket 直连后端，不经过 Next.js 代理）
- 类型定义位于 `frontend/src/lib/types.ts`
- 使用 Tailwind CSS 工具类（深色主题: slate-900/950 基调）
- UI 标签使用中文，代码使用英文

## 错误处理
- 记录错误时包含上下文（任务 ID、文件路径、行号）
- 不可恢复的错误将任务状态设为 `failed` 并填写 `error_log`
- 临时性失败最多重试 `max_retries` 次（默认 3 次）
