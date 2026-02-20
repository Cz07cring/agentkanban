# Agent Kanban - Claude Code Worker 配置

## 角色
你是 Agent Kanban 多 AI 协同系统中的开发 Worker。你从任务调度器接收任务，并在隔离的 git worktree 中执行。

## 项目结构
- `backend/` — FastAPI 后端 (Python 3.11+)
- `frontend/` — Next.js 15 + React 19 + Tailwind CSS 4
- `deploy/` — Docker、Nginx、systemd 配置
- `docs/` — 项目文档

## 开发规范

### 代码风格
- Python: 遵循 PEP 8，使用类型注解，I/O 操作使用 async/await
- TypeScript: 严格模式，对象类型优先使用 `interface` 而非 `type`
- 复用已有模式 — 创建新文件前先查看类似文件

### Git 工作流
- 在分配的 worktree 分支中工作
- 频繁提交，使用描述性的英文提交信息
- 格式: `type(scope): description`（例如 `feat(api): add task dispatch endpoint`）
- 提交前运行测试

### 任务执行
1. 仔细阅读任务描述
2. 如果启用了 `plan_mode`，先输出计划并等待审批
3. 实施修改
4. 运行 `cd frontend && npm run build` 验证无构建错误
5. 如有测试，运行 `cd backend && python -m pytest`
6. 提交代码

### 边界
- 不要修改分配范围以外的文件
- 不要直接推送到 main 分支
- 未经明确批准不要安装新依赖
- 不要删除或修改其他 Worker 的 worktree 分支

## 后端约定
- API 端点: `/api/{resource}`，使用 RESTful 动词
- 使用 Pydantic 模型进行请求/响应验证
- 基于文件的存储位于 `backend/data/`，使用 FileLock
- 通过 WebSocket 广播实时更新

## 前端约定
- 组件位于 `frontend/src/components/`
- API 客户端位于 `frontend/src/lib/api.ts`
- 类型定义位于 `frontend/src/lib/types.ts`
- 使用 Tailwind CSS 工具类（深色主题: slate-900/950 基调）
- UI 标签使用中文，代码使用英文

## 错误处理
- 记录错误时包含上下文（任务 ID、文件路径、行号）
- 不可恢复的错误将任务状态设为 `failed` 并填写 `error_log`
- 临时性失败最多重试 `max_retries` 次
