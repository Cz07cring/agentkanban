# Agent Kanban - 进度与经验日志

## 目的
记录 AI 辅助开发过程中的经验教训、常见问题和解决方案。Worker 在开始任务前应查阅此文件。

---

## 经验总结

### 前端
- Next.js 15 使用 App Router — 所有页面组件位于 `src/app/`
- Tailwind CSS 4 使用 `@import "tailwindcss"` 替代 `@tailwind` 指令
- API 调用通过 Next.js 重写规则代理（`/api/*` → 后端端口 8000）
- WebSocket 直连后端（Next.js 重写不支持代理 WebSocket）

### 后端
- 基于文件的存储，使用 `FileLock` 处理并发访问
- 任务 ID 为顺序编号: `task-001`、`task-002` 等
- 智能路由: 功能/修复类 → Claude，审查/重构类 → Codex
- 每次任务变更时通过 WebSocket 广播

### 常见陷阱
- 提交前端修改前务必运行 `npm run build`
- 查阅 `frontend/src/lib/types.ts` 获取最新类型定义
- 后端 CORS 当前设为 `allow_origins=["*"]` — 生产环境需限制

---

## 已解决的问题

| 日期 | 问题 | 解决方案 |
|------|------|----------|
| 2026-02-20 | 项目初始化 | 创建 7 列看板布局 |

---

## 架构决策

| 决策 | 原因 | 日期 |
|------|------|------|
| 基于文件存储 | 简单，无需数据库，单服务器场景足够 | 2026-02-20 |
| 双引擎路由 | Claude 处理创意类任务，Codex 处理分析类 | 2026-02-20 |
| WebSocket 实时通信 | 即时 UI 更新，无需轮询 | 2026-02-20 |
