# UI 约定（Kanban Console）

本文档用于统一前端视觉语义与术语，降低多人协作时的样式与文案偏差。

## 1. 颜色语义

### 1.1 任务状态色
- `pending`：`bg-slate-500/20 text-slate-400`
- `in_progress`：`bg-blue-500/20 text-blue-400`
- `plan_review`：`bg-purple-500/20 text-purple-400`
- `blocked_by_subtasks`：`bg-indigo-500/20 text-indigo-400`
- `reviewing`：`bg-amber-500/20 text-amber-400`
- `completed`：`bg-emerald-500/20 text-emerald-400`
- `failed`：`bg-red-500/20 text-red-400`
- `cancelled`：`bg-gray-500/20 text-gray-400`

### 1.2 优先级色
- `high`：红
- `medium`：琥珀
- `low`：灰

### 1.3 引擎 badge 色
- `Claude`：橙色
- `Codex`：绿色
- `Auto`：灰色

### 1.4 事件等级色
- `critical`：红
- `error`：橙
- `warning`：琥珀
- `info`：灰

> 所有颜色映射统一从 `frontend/src/lib/ui-tokens.ts` 获取。

## 2. 文案与术语策略

统一从 `frontend/src/lib/i18n-zh.ts` 获取词典，规则如下：

- 保留英文术语：`Plan` / `Review` / `Worker` / `Claude` / `Codex` / `Auto`
- 业务动作与状态使用中文：如“待开发”“已完成”“触发 Review”
- 避免同义词混用（例如“审核/审查/Review”在状态语义上统一用 `Review`）

## 3. 字号层级

- 页面标题：`text-2xl` 或 `text-xl`
- 分组标题：`text-sm font-medium`
- 正文：`text-sm`
- 次要信息：`text-xs text-slate-400/500`
- 标签/状态 badge：`text-[10px]` 或 `text-xs`

## 4. 圆角与间距

优先使用 token：

- 圆角：`rounded` / `rounded-lg` / `rounded-xl`
- 常用间距：`p-4`、`space-y-4`、`gap-2`、`gap-3`

> 统一入口：`frontend/src/lib/ui-tokens.ts` 的 `UI_CLASS_TOKENS`。

## 5. 组件状态约定

- 可点击卡片：hover 仅提升对比度，不改变布局
- 异步加载：使用低干扰提示（`text-xs` + 中性背景）
- 错误信息：红色语义 + 轻边框（不使用纯实心底色）
- 空状态：使用 `text-xs text-slate-500`，文案简短明确（如“暂无任务”）

## 6. 实施建议

- 新增视觉语义前，先补 `ui-tokens.ts`
- 新增/调整术语前，先补 `i18n-zh.ts`
- 页面中避免内联写死同类映射，优先复用 token 与词典
