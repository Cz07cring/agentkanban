# Agent Kanban - 多 AI 引擎协同任务管理系统

> 基于胡渊鸣 "提高 Agentic Coding 吞吐量 10 倍" 方法论，结合 **Claude Code CLI** 与 **OpenAI Codex CLI** 双引擎协同，构建的可落地系统设计文档。

---

## 一、系统概述

### 1.1 核心理念

- **全程自动化**：从任务提交到代码合并，全链路自动化运行，人类只需提交任务和处理少量关键决策
- **Context, not Control**：不要微管理 AI，专注于提供清晰的上下文和需求描述
- **闭环反馈**：让 AI 能写代码 → 运行 → 检查 → 调试，形成端到端的反馈循环
- **并行化**：多个 AI 引擎实例通过 Git Worktree 并行工作，实现 1 分钟 1 个 commit
- **持续记忆**：通过 CLAUDE.md / CODEX.md + PROGRESS.md 让 AI "长记性"，同样的错误不犯两次
- **多引擎协同**：Claude 擅长长时任务调度与自主决策，Codex 擅长代码分析与结构化输出，两者互补优于单引擎
- **智能路由**：根据任务类型自动选择最佳 AI 引擎，最大化效率与质量

### 1.2 自动化等级说明

本系统目标是 **Level 4 自动化**（全程无人值守运行），仅在极少数场景需要人类介入。

| 自动化等级 | 说明 | 本系统 |
|-----------|------|--------|
| Level 1 | 人类主导，AI 辅助 | - |
| Level 2 | AI 执行，人类逐步确认 | - |
| Level 3 | AI 自主运行，人类定期检查 | - |
| **Level 4** | **全程无人值守，仅异常时人类介入** | **当前目标** |

> **⚠️ 需要人类帮助的场景汇总（全文共 7 处，用 `🔴 人类介入点` 标记）：**
>
> | # | 场景 | 触发条件 | 通知方式 |
> |---|------|---------|---------|
> | 1 | Plan Mode 审批 | 用户勾选了 Plan 模式 | Web 推送 / 手机通知 |
> | 2 | 对抗式 Review 3 轮未通过 | 连续 3 轮交叉 Review 仍有 critical 问题 | Web 推送 / 手机通知 |
> | 3 | 双引擎同时故障 | Claude + Codex 都不可用 | 紧急短信/电话告警 |
> | 4 | Worker 连续失败 | 同一 Worker 连续 3 次任务失败 | Web 推送 |
> | 5 | 初始环境搭建 | 首次部署系统 | 一次性操作 |
> | 6 | API Key / 订阅管理 | Key 过期或额度用尽 | Web 推送 |
> | 7 | SSH 紧急恢复 | Web Manager 崩溃且自动重启失败 | 监控告警 |
>
> **除以上 7 个场景外，系统全程自动运行，无需人类参与。**

### 1.3 系统架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                    Web Manager (前端 PWA)                         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  任务管理看板 (Kanban Board)                                 │ │
│  │  ┌────┐ ┌────┐ ┌─────┐ ┌────┐ ┌──┐ ┌────┐                │ │
│  │  │待开发│ │开发中│ │待Review│ │已完成│ │失败│ │已取消│                │ │
│  │  └────┘ └────┘ └─────┘ └────┘ └──┘ └────┘                │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌─────────┐ ┌──────────┐ ┌────────────┐ ┌────────────┐       │
│  │语音输入框 │ │Plan 模式  │ │ 翻译切换    │ │ 引擎选择    │       │
│  └─────────┘ └──────────┘ └────────────┘ └────────────┘       │
└───────────────────────┬─────────────────────────────────────────┘
                        │ HTTPS API
┌───────────────────────▼─────────────────────────────────────────┐
│              Task Dispatcher (Python 后端)                        │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Ralph Loop: 取任务 → 智能路由 → 分配引擎 → 监控 → 回收      │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌──────────────────┐ ┌──────────────────┐                     │
│  │  任务路由引擎       │ │  引擎健康检查      │                     │
│  │  (规则 + 关键词)    │ │  (故障转移)        │                     │
│  └──────────────────┘ └──────────────────┘                     │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  dev-tasks.json (共享任务队列) + dev-task.lock (文件锁)       │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────┬──────────┬──────────┬──────────┬─────────────────────────┘
       │          │          │          │
┌──────▼──┐ ┌─────▼───┐ ┌───▼───────┐ ┌▼──────────┐
│Claude   │ │Claude   │ │Codex     │ │Codex      │  ...
│Worker 1 │ │Worker 2 │ │Worker 3  │ │Worker 4   │
│port:5200│ │port:5201│ │port:5202 │ │port:5203  │
│worktree │ │worktree │ │worktree  │ │worktree   │
├─────────┤ ├─────────┤ ├──────────┤ ├───────────┤
│  data/  │ │  data/  │ │  data/   │ │  data/    │ (隔离的实验数据)
└────┬────┘ └────┬────┘ └─────┬────┘ └─────┬─────┘
     │           │            │             │
     └───────────┼────────────┼─────────────┘
                 │ git push / merge
         ┌───────▼───────┐
         │  主仓库 (main) │
         │   GitHub      │
         └───────────────┘
```

### 1.4 技术栈选型

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | Next.js / React | Web 管理界面，支持 PWA (iPhone Safari) |
| 后端 | Python (FastAPI) | Task Dispatcher，subprocess 调度双引擎 |
| AI 引擎 1 | Claude Code CLI | 长时任务、计划制定、自主开发、Bug 修复 |
| AI 引擎 2 | OpenAI Codex CLI | 代码分析、Review、重构、结构化输出 |
| 版本控制 | Git + Git Worktree | 并行开发隔离 |
| 数据存储 | JSON 文件 / SQLite | 任务队列、配置、进度记录 |
| 语音识别 | Whisper API / 浏览器 Web Speech API | 语音转文字输入 |
| 部署 | EC2 / 云服务器 | 容器化运行，24 小时可用 |
| 远程访问 | Nginx + HTTPS + Tailscale | 安全远程管理 |

---

## 二、多 AI 引擎架构

### 2.1 引擎对比

| 对比维度 | Claude Code CLI | Codex CLI |
|---------|----------------|-----------|
| 非交互模式 | `claude -p [prompt] --dangerously-skip-permissions --output-format stream-json` | `codex exec [prompt] --json --full-auto` |
| 沙箱机制 | 需要容器隔离（`--dangerously-skip-permissions` 在容器内可控） | 自带 Landlock (Linux) / Seatbelt (macOS) 沙箱 |
| 强项 | 自主长时运行、计划制定、任务分解、上下文管理、复杂 Bug 修复 | 代码分析、Code Review、重构、结构化输出、精准定点修改 |
| 输出格式 | stream-json (tool events: `assistant`, `tool_use`, `result`) | JSONL (thread/turn/item events: `message.start`, `output_text.delta`) |
| 会话恢复 | 有限（通过 `--resume` 可继续对话） | `codex exec resume --last` 或指定 session ID |
| Web 搜索 | 需要通过工具调用 (WebSearch tool) | 内置 `web_search` 工具 |
| 项目指令 | `CLAUDE.md` | `codex.md` 或 `AGENTS.md` |
| 并发安全 | 容器隔离 + worktree | 沙箱原生隔离 + worktree |
| 输出 Schema | 无 | `--output-schema` 强制结构化输出 |
| 适用模型 | Claude Opus / Sonnet | GPT-4.1 / o4-mini / o3 |

### 2.2 引擎能力矩阵

```
任务类型          Claude Code 适配度    Codex CLI 适配度    推荐引擎
───────────────────────────────────────────────────────────────
新功能开发            ★★★★★              ★★★☆☆           Claude
Bug 修复              ★★★★★              ★★★☆☆           Claude
计划制定/需求拆解      ★★★★★              ★★☆☆☆           Claude
代码 Review           ★★★☆☆              ★★★★★           Codex
代码重构              ★★★☆☆              ★★★★★           Codex
代码分析/审计          ★★★☆☆              ★★★★★           Codex
结构化数据提取         ★★☆☆☆              ★★★★★           Codex
集成测试              ★★★★☆              ★★★☆☆           Claude
安全审查              ★★★☆☆              ★★★★☆           Codex
文档生成              ★★★★☆              ★★★☆☆           Claude
```

### 2.3 双引擎协同示意

```
                    ┌─────────────┐
                    │  用户提交任务  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  任务路由引擎  │
                    │ (全自动路由)  │
                    └──┬───────┬──┘
                       │       │
            ┌──────────▼┐   ┌─▼──────────┐
            │ Claude     │   │ Codex      │
            │ Worker Pool│   │ Worker Pool│
            │ (开发/修复) │   │ (分析/Review)│
            └──────┬─────┘   └─────┬──────┘
                   │               │
                   └──────┬────────┘
                          │
                   ┌──────▼──────┐
                   │  对抗式 Review │
                   │  (交叉验证)    │
                   └──────┬──────┘
                          │
                   ┌──────▼──────┐
                   │  合并到主分支  │
                   └─────────────┘
```

---

## 三、智能任务路由引擎

### 3.1 路由决策流程

```
用户提交任务
     │
     ▼
  任务分类器 (规则 + 关键词匹配)
     │
     ├── 新功能开发 / 长时任务 ──────→ Claude Code Worker
     ├── 代码 Review / 重构 ──────→ Codex CLI Worker
     ├── Bug 修复 ──────────────→ Claude Code Worker
     ├── 代码分析 / 审计 ────────→ Codex CLI Worker
     ├── 计划制定 / 需求拆解 ─────→ Claude Code (Plan Mode)
     ├── 结构化数据提取 ─────────→ Codex CLI (--output-schema)
     ├── 安全审查 ──────────────→ Codex CLI Worker
     └── 复杂任务 ──────────────→ Claude 拆解 → 子任务分发到两个引擎
```

### 3.2 路由规则配置

```json
{
  "routing_rules": [
    {
      "task_type": "feature",
      "keywords": ["开发", "实现", "新增", "添加", "创建", "implement", "add", "create"],
      "preferred_engine": "claude",
      "fallback_engine": "codex"
    },
    {
      "task_type": "review",
      "keywords": ["review", "审查", "检查", "code review", "PR review"],
      "preferred_engine": "codex",
      "fallback_engine": "claude"
    },
    {
      "task_type": "refactor",
      "keywords": ["重构", "优化", "refactor", "cleanup", "整理"],
      "preferred_engine": "codex",
      "fallback_engine": "claude"
    },
    {
      "task_type": "bugfix",
      "keywords": ["修复", "bug", "fix", "错误", "异常", "crash"],
      "preferred_engine": "claude",
      "fallback_engine": "codex"
    },
    {
      "task_type": "analysis",
      "keywords": ["分析", "审计", "analyze", "audit", "检测", "扫描"],
      "preferred_engine": "codex",
      "fallback_engine": "claude"
    },
    {
      "task_type": "plan",
      "keywords": ["计划", "拆解", "设计", "plan", "design", "架构"],
      "preferred_engine": "claude",
      "fallback_engine": "codex"
    }
  ]
}
```

### 3.3 路由伪代码

```python
def route_task(task: dict) -> str:
    """根据任务类型和关键词自动匹配，返回最佳引擎（全自动，无需人类参与）"""
    # 1. 用户提交时可预选引擎（可选，不选则全自动路由）
    if task.get("engine") and task["engine"] != "auto":
        return task["engine"]

    # 2. 自动：基于任务类型匹配
    task_type = task.get("task_type")
    if task_type:
        for rule in ROUTING_RULES:
            if rule["task_type"] == task_type:
                engine = rule["preferred_engine"]
                if is_engine_healthy(engine):
                    return engine
                return rule["fallback_engine"]

    # 3. 基于关键词匹配
    text = f"{task['title']} {task['description']}".lower()
    for rule in ROUTING_RULES:
        if any(kw in text for kw in rule["keywords"]):
            engine = rule["preferred_engine"]
            if is_engine_healthy(engine):
                return engine
            return rule["fallback_engine"]

    # 4. 默认使用 Claude
    return "claude"
```

---

## 四、任务拆解（Task Decomposition）

### 4.1 Claude 作为 Tech Lead

Claude Code 在 Plan Mode 下作为 "Tech Lead"，将大任务拆解为子任务，并为每个子任务分配最佳引擎：

```
大任务: "开发用户认证系统"
     │
     ▼ Claude Code (Plan Mode) 拆解
     │
     ├── 子任务 1: 设计数据库 schema ────→ Claude Worker
     ├── 子任务 2: 实现注册 API ──────→ Claude Worker
     ├── 子任务 3: 实现登录 API ──────→ Claude Worker
     ├── 子任务 4: Review 安全性 ─────→ Codex Worker
     └── 子任务 5: 集成测试 ─────────→ Claude Worker
```

### 4.2 任务拆解触发条件

| 条件 | 说明 | 自动化 |
|------|------|--------|
| 用户勾选 Plan 模式 | 强制先拆解再执行 | 自动拆解，Plan 审批需人类 |
| 任务描述超过 200 字 | 系统自动判定为复杂任务，触发拆解 | 全自动 |
| 包含多个功能点 | 关键词如 "并且"、"同时"、"以及" 自动检测 | 全自动 |
| 预设复杂度标签 | 用户提交时可选 "复杂任务" 标签（可选） | 全自动 |

### 4.3 拆解结果数据结构

```json
{
  "id": "task-001",
  "title": "开发用户认证系统",
  "task_type": "feature",
  "is_parent": true,
  "sub_tasks": ["task-001-1", "task-001-2", "task-001-3", "task-001-4", "task-001-5"],
  "decomposed_by": "claude",
  "decomposed_at": "2026-02-20T10:00:00Z"
}
```

子任务示例：

```json
{
  "id": "task-001-4",
  "title": "Review 用户认证系统安全性",
  "parent_task_id": "task-001",
  "task_type": "review",
  "engine": "codex",
  "depends_on": ["task-001-2", "task-001-3"],
  "status": "pending"
}
```

---

## 五、对抗式 Review（Adversarial Review）

### 5.1 核心理念

借鉴 claude-octopus 思路：一个引擎写代码，另一个引擎 Review，形成 "对抗式质量保障"。两个引擎的知识盲区不同，交叉验证能发现单引擎遗漏的问题。

### 5.2 Review 流程

```
Claude Worker 完成开发                          ┐
     │                                          │
     ▼                                          │
Codex Worker 做 Code Review (全自动)             │
     │                                          │ 全自动
     ▼                                          │ 无需人类
  解析 Review 结果                               │
     │                                          │
     ├── 全部通过 → 自动合并到主分支               │
     │                                          ┘
     └── 发现问题
            │
            ▼
      自动反馈给 Claude Worker 修复               ┐ 全自动循环
            │                                    │ (最多 3 轮)
            ▼                                    │
      Codex Worker 自动重新 Review                ┘
            │
            └── 3 轮仍未通过
                     │
                     ▼
            🔴 人类介入点 #2: 需要人类帮助！
               系统自动发送通知到手机
               人类审查问题，决定修复方向
```

> **🔴 人类介入点 #2**：对抗式 Review 连续 3 轮未通过时，系统暂停该任务并通过 Web 推送/手机通知提醒人类。这是罕见情况，通常 1-2 轮即可通过。

### 5.3 Review 调用示例

```python
def trigger_adversarial_review(task_id: str, branch: str):
    """用 Codex CLI 对 Claude 完成的代码做 Review"""
    diff = get_branch_diff(branch)

    review_prompt = f"""
请对以下代码变更做 Code Review，关注：
1. 逻辑正确性
2. 安全漏洞 (SQL 注入、XSS、命令注入等)
3. 性能问题
4. 代码风格与可维护性
5. 测试覆盖率

变更内容:
{diff}

输出格式: JSON，包含 issues 数组，每个 issue 有 severity (critical/high/medium/low), file, line, description, suggestion
"""

    result = subprocess.run(
        [
            "codex", "exec", review_prompt,
            "--json", "--full-auto"
        ],
        capture_output=True, text=True
    )
    return parse_review_result(result.stdout)
```

### 5.4 反向 Review（Codex 开发 → Claude Review）

同样支持反向流程，当 Codex Worker 完成重构/分析任务后，可以由 Claude 验证：

```python
def trigger_reverse_review(task_id: str, branch: str):
    """用 Claude 对 Codex 完成的代码做 Review"""
    diff = get_branch_diff(branch)

    review_prompt = (
        f"请 Review 以下代码变更，从架构合理性、业务逻辑完整性、"
        f"异常处理、用户体验角度给出反馈：\n\n{diff}"
    )

    result = subprocess.run(
        [
            "claude", "-p", review_prompt,
            "--dangerously-skip-permissions",
            "--output-format", "stream-json"
        ],
        capture_output=True, text=True
    )
    return parse_claude_review(result.stdout)
```

---

## 六、核心模块设计

### 6.1 任务生命周期 (Kanban 状态机)

```
待开发 (Pending)
  │
  │ [自动分配 Worker + 自动引擎路由]              ← 全自动
  ▼
开发中 (In Progress)
  │
  ├─── [Plan 模式] ──→ 待审批 (Plan Review)
  │                         │
  │                         │ 🔴 需要人类帮助：审批计划
  │                         ▼
  │                    开发中 (Implementing)       ← 审批后全自动
  │                         │
  ├─────────────────────────┘
  │
  │ [自动完成开发]                                 ← 全自动
  ▼
待 Review ──→ 对抗式 Review (自动交叉引擎验证)     ← 全自动
  │
  ├─── [自动通过] ──→ 自动合并 ──→ 已完成 (Completed)
  │
  ├─── [Review 问题] ──→ 自动修复 ──→ 自动重新 Review (最多 3 轮)
  │                                        │
  │                                        └── 3 轮未过 → 🔴 需要人类帮助
  │
  ├─── [失败] ──→ 自动重试 (最多 3 次) ──→ 待开发
  │                                        │
  │                                        └── 3 次仍失败 → 🔴 需要人类帮助
  │
  └─── [取消] ──→ 已取消 (Cancelled)
```

### 6.2 任务数据结构 (dev-tasks.json)

```json
{
  "tasks": [
    {
      "id": "task-001",
      "title": "开发新闻总结功能",
      "description": "每 10 分钟爬取最新 AI 新闻，用 ChatGPT 总结，按优先级排列",
      "status": "pending",
      "priority": "high",
      "task_type": "feature",
      "engine": "auto",
      "routed_engine": null,
      "parent_task_id": null,
      "sub_tasks": [],
      "depends_on": [],
      "plan_mode": true,
      "plan_content": null,
      "plan_questions": [],
      "assigned_worker": null,
      "worktree_branch": null,
      "review_status": null,
      "review_engine": null,
      "review_result": null,
      "created_at": "2026-02-20T10:00:00Z",
      "started_at": null,
      "completed_at": null,
      "commit_ids": [],
      "error_log": null,
      "retry_count": 0,
      "max_retries": 3
    }
  ],
  "meta": {
    "last_updated": "2026-02-20T10:00:00Z",
    "total_completed": 209,
    "success_rate": 0.95,
    "claude_tasks": 150,
    "codex_tasks": 59
  }
}
```

### 6.3 Worker 数据结构

```json
{
  "workers": [
    {
      "id": "worker-1",
      "engine": "claude",
      "port": 5200,
      "worktree_path": "/app/worktrees/worker-1",
      "status": "idle",
      "capabilities": ["feature", "bugfix", "plan", "test"],
      "current_task_id": null,
      "pid": null,
      "started_at": null,
      "total_tasks_completed": 42,
      "health": {
        "last_heartbeat": "2026-02-20T10:05:00Z",
        "consecutive_failures": 0,
        "avg_task_duration_ms": 240000
      }
    },
    {
      "id": "worker-3",
      "engine": "codex",
      "port": 5202,
      "worktree_path": "/app/worktrees/worker-3",
      "status": "idle",
      "capabilities": ["review", "refactor", "analysis", "audit"],
      "current_task_id": null,
      "pid": null,
      "started_at": null,
      "total_tasks_completed": 28,
      "health": {
        "last_heartbeat": "2026-02-20T10:05:00Z",
        "consecutive_failures": 0,
        "avg_task_duration_ms": 120000
      }
    }
  ]
}
```

---

## 七、CLAUDE.md 规范

> CLAUDE.md 是 Claude Code Worker 的 "灵魂"，它定义了每个 Claude Code 实例的行为准则。不适合频繁修改，一旦稳定就尽量保持不变。

```markdown
# CLAUDE.md

## 项目概述
[项目名称] - [一句话描述]
技术栈：[前端框架] + [后端框架] + [数据库]

## 你的角色
你是一个自动化开发 Worker。收到任务后独立完成开发，不要询问用户确认。
完成任务后执行 exit 退出。

## 开发流程（每次任务必须遵循）

### 1. 获取任务（自动）
- 由 Dispatcher 自动分配，或从 `data/dev-tasks.json` 自动获取下一个待处理任务

### 2. 创建分支
```bash
git checkout -b task/[task-id]-[short-description]
```

### 3. 开发 & 测试
- 编写代码，确保功能完整
- 运行测试：`npm test`
- 如果测试失败，修复后再提交

### 4. 提交代码
```bash
git add -A
git commit -m "feat/fix/refactor: [描述] (task-id: [id])"
```

### 5. 合并到主分支
```bash
git fetch origin && git merge origin/main
```
- 解决可能的冲突（见冲突处理章节）

### 6. 更新任务状态
- 将 dev-tasks.json 中的任务状态更新为 completed
- 记录 commit ID

### 7. 经验沉淀
- 遇到问题或完成重要改动后，在 PROGRESS.md 中记录

### 8. 退出
```bash
exit
```

## 多实例并行开发 (Git Worktree)

### 架构说明
支持多个 Claude Code 实例并行工作，每个实例在独立的 git worktree 中执行任务。

### 共享文件 (symlink)
- `dev-tasks.json` - 任务队列
- `dev-task.lock` - 文件锁
- `api-key.json` - API 密钥

### 禁止 symlink
- `PROGRESS.md` - 直接用 `git -C` 编辑主仓库文件

### Worktree 操作
```bash
# 创建 worktree
git worktree add ../worktrees/worker-N -b worker-N-branch

# 清理 worktree
git worktree remove ../worktrees/worker-N
```

## 冲突处理

### Rebase 失败时的处理流程
1. 如果是 "unstaged changes" 错误，先 commit 或 stash 当前改动
2. 如果有 merge conflicts:
   - 查看冲突文件：`git status`
   - 读取冲突文件内容，理解双方改动意图
   - AI 自动解决冲突（分析双方改动意图，保留正确的代码）
   - `git add <resolved-files>`
   - `git rebase --continue`
3. 重复直到 rebase 完成

### 测试失败时的处理流程
1. 运行测试：`npm test`
2. 如果失败，分析错误信息
3. 修复代码中的 bug
4. 重新运行测试，直到全部通过
5. 提交修复：`git commit -m "fix: ..."`

**不要放弃**：遇到 rebase 或测试失败时，必须解决问题后才能继续，不能直接标记任务失败。

## 经验教训沉淀
每次遇到问题或完成重要改动后，要在 PROGRESS.md 中记录：
- 遇到了什么问题
- 如何解决的
- 以后如何避免
- **必须附上 git commit ID**

**同样的问题不要犯两次！**

## 代码规范
- 中英文之间、中文和数字之间、英文和数字之间必须有一个半角空格
- 中英文引号不能混用
- 代码提交信息使用英文，遵循 Conventional Commits
- 每个功能必须有对应的测试
```

---

## 八、CODEX.md 规范

> Codex CLI 使用 `codex.md` 或 `AGENTS.md` 作为项目指令文件。此文件定义 Codex Worker 的行为准则，与 CLAUDE.md 平级。

```markdown
# CODEX.md (codex.md)

## 项目概述
[项目名称] - [一句话描述]
技术栈：[前端框架] + [后端框架] + [数据库]

## 你的角色
你是一个自动化 Code Review 和代码分析 Worker。
收到任务后独立完成分析/重构，输出结构化结果。

## 工作模式

### Code Review 模式
收到待 Review 的分支后：
1. 读取分支 diff
2. 逐文件分析：逻辑正确性、安全漏洞、性能问题、代码风格
3. 输出结构化 Review 结果 (JSON)
4. 严重问题标记 critical/high，建议标记 medium/low

### 代码分析模式
收到分析请求后：
1. 扫描指定目录/文件
2. 分析代码结构、依赖关系、复杂度
3. 输出分析报告 (JSON)

### 重构模式
收到重构请求后：
1. 理解重构目标
2. 创建分支执行重构
3. 确保测试通过
4. 提交代码

## 输出格式要求
所有输出必须是结构化 JSON，方便 Dispatcher 解析：

```json
{
  "task_id": "task-xxx",
  "result": "pass|fail|issues_found",
  "issues": [
    {
      "severity": "critical|high|medium|low",
      "file": "src/xxx.ts",
      "line": 42,
      "description": "SQL 注入风险",
      "suggestion": "使用参数化查询"
    }
  ],
  "summary": "发现 2 个高危问题，3 个建议改进"
}
```

## 开发流程

### 1. 获取任务（自动）
- 由 Dispatcher 自动分配任务指令

### 2. 创建分支（重构模式）
```bash
git checkout -b task/[task-id]-[short-description]
```

### 3. 执行任务
- Review: 分析 diff，输出结构化结果
- 分析: 扫描代码，输出报告
- 重构: 修改代码，运行测试

### 4. 提交结果
- Review/分析: 输出 JSON 结果到 stdout
- 重构: git commit + push

## 代码规范
- 与 CLAUDE.md 保持一致的代码规范
- 中英文之间、中文和数字之间、英文和数字之间必须有一个半角空格
- 代码提交信息使用英文，遵循 Conventional Commits
```

---

## 九、PROGRESS.md 规范

> PROGRESS.md 是 AI 的 "经验库"，用于积累教训，避免重复犯错。每个 Worker（无论引擎）都应在完成任务后更新。

```markdown
# PROGRESS.md - 开发进度与经验记录

## 最近更新
- [2026-02-20] task-210: 实现新闻总结功能 (engine: claude, commit: abc1234)
- [2026-02-20] task-211: Review 新闻总结安全性 (engine: codex, result: 2 issues found)

## 经验教训

### [2026-02-20] 数据库并发写入问题
- **问题**：多个 Worker 同时写入 dev-tasks.json 导致数据丢失
- **解决**：引入 dev-task.lock 文件锁机制
- **避免**：所有对共享文件的写操作必须先获取锁
- **引擎**: Claude Worker
- **Commit**: def5678

### [2026-02-20] Codex Review 发现 XSS 漏洞
- **问题**：Claude Worker 实现的新闻展示未对 HTML 转义
- **解决**：Codex Review 发现后，Claude Worker 修复，添加 DOMPurify
- **避免**：所有用户输入展示都需要转义处理
- **引擎**: Codex Review → Claude Fix
- **Commit**: xyz9012

### [2026-02-19] Worktree 合并冲突
- **问题**：Worker-2 的改动覆盖了 Worker-1 的修复
- **解决**：强制要求每个 Worker 在提交前先 fetch + rebase
- **避免**：CLAUDE.md 中明确 rebase 流程
- **引擎**: Claude Worker
- **Commit**: ghi9012

## 架构决策记录

### ADR-001: 使用 JSON 文件而非数据库
- **决策**：任务队列使用 JSON 文件存储
- **原因**：单用户系统，无需复杂查询；AI Worker 直接读写 JSON 更方便
- **权衡**：并发性能不如数据库，但通过文件锁可以满足 5 个 Worker 的需求

### ADR-002: 双引擎协同架构
- **决策**：Claude Code + Codex CLI 双引擎，智能路由分配
- **原因**：Claude 擅长自主开发，Codex 擅长分析与 Review，互补效果优于单引擎
- **权衡**：增加系统复杂度，但代码质量和任务成功率显著提升

## 已知问题
- [ ] Web Manager 偶尔崩溃需要 ssh 重启
- [ ] 语音识别在嘈杂环境下准确率下降
- [ ] Codex CLI 在大文件 Review 时偶有超时
```

---

## 十、Task Dispatcher (Ralph Loop) 设计

### 10.1 核心调度逻辑（双引擎版）

```python
# task_dispatcher.py - 双引擎调度伪代码

import subprocess
import json
import time
from pathlib import Path
from filelock import FileLock

TASKS_FILE = "data/dev-tasks.json"
LOCK_FILE = "data/dev-task.lock"
MAX_WORKERS = 5
WORKER_BASE_PORT = 5200

# 引擎配置
ENGINE_CONFIG = {
    "claude": {
        "command": ["claude", "-p"],
        "flags": ["--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose"],
        "capabilities": ["feature", "bugfix", "plan", "test"],
    },
    "codex": {
        "command": ["codex", "exec"],
        "flags": ["--json", "--full-auto"],
        "capabilities": ["review", "refactor", "analysis", "audit"],
    }
}

class TaskDispatcher:
    """Ralph Loop 实现：双引擎智能调度"""

    def __init__(self):
        self.workers = []
        self.engine_health = {"claude": True, "codex": True}
        self.init_worktrees()

    def init_worktrees(self):
        """初始化 Git Worktree，为每个 Worker 分配引擎"""
        worker_configs = [
            {"engine": "claude", "count": 3},  # 3 个 Claude Worker
            {"engine": "codex", "count": 2},   # 2 个 Codex Worker
        ]
        idx = 0
        for config in worker_configs:
            for _ in range(config["count"]):
                worktree_path = f"../worktrees/worker-{idx}"
                branch_name = f"worker-{idx}-branch"
                subprocess.run([
                    "git", "worktree", "add", worktree_path, "-b", branch_name
                ], check=False)
                self.workers.append({
                    "id": f"worker-{idx}",
                    "engine": config["engine"],
                    "port": WORKER_BASE_PORT + idx,
                    "worktree_path": worktree_path,
                    "status": "idle",
                    "capabilities": ENGINE_CONFIG[config["engine"]]["capabilities"],
                    "process": None,
                    "current_task": None
                })
                idx += 1

    def route_task(self, task):
        """智能任务路由：根据任务类型选择最佳引擎"""
        # 用户提交时可预选引擎（可选，不选则全自动路由）
        if task.get("engine") and task["engine"] != "auto":
            return task["engine"]

        # 基于任务类型
        task_type = task.get("task_type", "feature")
        engine_map = {
            "feature": "claude",
            "bugfix": "claude",
            "plan": "claude",
            "test": "claude",
            "review": "codex",
            "refactor": "codex",
            "analysis": "codex",
            "audit": "codex",
        }
        preferred = engine_map.get(task_type, "claude")

        # 健康检查 + 故障转移
        if not self.engine_health.get(preferred, False):
            fallback = "codex" if preferred == "claude" else "claude"
            if self.engine_health.get(fallback, False):
                return fallback
        return preferred

    def find_idle_worker(self, engine):
        """找到指定引擎的空闲 Worker"""
        for worker in self.workers:
            if worker["engine"] == engine and worker["status"] == "idle":
                return worker
        # 如果指定引擎没有空闲 Worker，尝试其他引擎
        for worker in self.workers:
            if worker["status"] == "idle":
                return worker
        return None

    def get_next_task(self):
        """从任务队列获取下一个待处理任务（带文件锁）"""
        lock = FileLock(LOCK_FILE)
        with lock:
            tasks = json.loads(Path(TASKS_FILE).read_text())
            for task in tasks["tasks"]:
                if task["status"] == "pending":
                    # 检查依赖是否完成
                    if task.get("depends_on"):
                        all_done = all(
                            self._is_task_completed(dep_id, tasks)
                            for dep_id in task["depends_on"]
                        )
                        if not all_done:
                            continue

                    task["status"] = "in_progress"
                    Path(TASKS_FILE).write_text(
                        json.dumps(tasks, ensure_ascii=False, indent=2)
                    )
                    return task
        return None

    def dispatch_task(self, worker, task):
        """将任务分配给指定 Worker（支持双引擎）"""
        engine = worker["engine"]
        prompt = self.build_prompt(task, engine)
        worker["status"] = "busy"
        worker["current_task"] = task["id"]

        config = ENGINE_CONFIG[engine]
        cmd = config["command"] + [prompt] + config["flags"]

        worker["process"] = subprocess.Popen(
            cmd,
            cwd=worker["worktree_path"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )

    def build_prompt(self, task, engine):
        """根据引擎类型构建 prompt"""
        if engine == "codex" and task.get("task_type") == "review":
            return (
                f"请对以下任务的代码做 Code Review：\n"
                f"任务ID：{task['id']}\n"
                f"分支：{task.get('worktree_branch', 'main')}\n"
                f"关注：逻辑正确性、安全漏洞、性能、代码风格\n"
                f"输出 JSON 格式的 Review 结果。"
            )
        if task.get("plan_mode"):
            return (
                f"请为以下任务制定开发计划，不要直接开始编码：\n"
                f"任务：{task['title']}\n"
                f"描述：{task['description']}\n"
                f"请列出：1) 实现步骤 2) 需要修改的文件 "
                f"3) 可能的风险 4) 测试策略"
            )
        return (
            f"执行以下开发任务：\n"
            f"任务ID：{task['id']}\n"
            f"任务：{task['title']}\n"
            f"描述：{task['description']}\n"
            f"完成后按照 CLAUDE.md 流程提交代码并退出。"
        )

    def monitor_worker(self, worker):
        """监控 Worker 状态"""
        if worker["process"] and worker["process"].poll() is not None:
            returncode = worker["process"].returncode
            stdout = worker["process"].stdout.read().decode()

            if returncode == 0:
                self.mark_task_completed(worker["current_task"])
                # 触发对抗式 Review（如果开发任务完成）
                task = self.get_task_by_id(worker["current_task"])
                if task and task.get("task_type") in ("feature", "bugfix"):
                    self.trigger_adversarial_review(task)
            else:
                self.handle_task_failure(worker["current_task"], stdout)
                self.update_engine_health(worker["engine"], success=False)

            worker["status"] = "idle"
            worker["current_task"] = None
            worker["process"] = None

    def trigger_adversarial_review(self, task):
        """触发对抗式 Review：开发引擎完成后，用另一个引擎 Review"""
        review_task = {
            "id": f"{task['id']}-review",
            "title": f"Review: {task['title']}",
            "task_type": "review",
            "engine": "codex" if task.get("routed_engine") == "claude" else "claude",
            "parent_task_id": task["id"],
            "depends_on": [task["id"]],
            "status": "pending"
        }
        self.add_task(review_task)

    def check_engine_health(self):
        """引擎健康检查"""
        for engine_name in ["claude", "codex"]:
            try:
                config = ENGINE_CONFIG[engine_name]
                result = subprocess.run(
                    config["command"] + ["echo hello"] + config["flags"],
                    capture_output=True, timeout=30
                )
                self.engine_health[engine_name] = (result.returncode == 0)
            except (subprocess.TimeoutExpired, FileNotFoundError):
                self.engine_health[engine_name] = False

    def run_loop(self):
        """Ralph Loop 主循环（双引擎版）"""
        health_check_interval = 60  # 每 60 秒检查引擎健康
        last_health_check = 0

        while True:
            now = time.time()

            # 定期健康检查
            if now - last_health_check > health_check_interval:
                self.check_engine_health()
                last_health_check = now

            # 1. 监控所有 Worker
            for worker in self.workers:
                self.monitor_worker(worker)

            # 2. 给空闲 Worker 分配任务
            for worker in self.workers:
                if worker["status"] == "idle":
                    task = self.get_next_task()
                    if task:
                        # 智能路由
                        target_engine = self.route_task(task)
                        task["routed_engine"] = target_engine

                        # 找到匹配引擎的空闲 Worker
                        matched_worker = self.find_idle_worker(target_engine)
                        if matched_worker:
                            self.dispatch_task(matched_worker, task)

            time.sleep(5)  # 每 5 秒检查一次
```

### 10.2 自动备份机制

```bash
# backup.sh - 每小时自动备份（crontab: 0 * * * *）
#!/bin/bash
BACKUP_DIR="/backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r data/ "$BACKUP_DIR/"
cp PROGRESS.md "$BACKUP_DIR/"
# 保留最近 72 小时的备份
find /backups -type d -mtime +3 -exec rm -rf {} +
```

---

## 十一、引擎健康检查与故障转移

### 11.1 健康检查机制

```
┌───────────────────────────────────────────────────┐
│              引擎健康监控                            │
├─────────────┬─────────┬───────────────────────────┤
│ 引擎         │ 状态     │ 详情                      │
├─────────────┼─────────┼───────────────────────────┤
│ Claude Code │ 🟢 正常  │ 延迟: 2.1s  成功率: 98%    │
│ Codex CLI   │ 🟢 正常  │ 延迟: 1.5s  成功率: 97%    │
├─────────────┴─────────┴───────────────────────────┤
│ 故障转移: 启用   检查间隔: 60s   最后检查: 10:05:00  │
└───────────────────────────────────────────────────┘
```

### 11.2 故障转移策略

| 故障场景 | 检测方式 | 转移策略 | 自动化 |
|---------|---------|---------|--------|
| Claude API 限流 (429) | 连续 3 次请求超时或 429 | 自动将新任务路由到 Codex | 全自动 |
| Codex API 限流 (429) | 连续 3 次请求超时或 429 | 自动将新任务路由到 Claude | 全自动 |
| Claude CLI 进程崩溃 | Worker 进程非零退出码 | 自动重启 Worker，3 次失败后自动暂停 | 全自动 |
| Codex CLI 进程崩溃 | Worker 进程非零退出码 | 自动重启 Worker，3 次失败后自动暂停 | 全自动 |
| 单引擎故障 | 一个引擎标记不健康 | 自动故障转移到另一引擎，恢复后自动切回 | 全自动 |
| 网络中断 | 所有 API 请求超时 | 自动暂停调度，网络恢复后自动重试 | 全自动 |
| **双引擎同时故障** | **两个引擎都标记不健康** | **🔴 需要人类帮助！** 自动发送紧急告警 | **人类介入** |

> **🔴 人类介入点 #3**：双引擎同时故障是极端情况（通常意味着网络中断或 API Key 失效）。系统自动发送紧急短信/电话告警，人类需要 SSH 登录检查网络或更新 API Key。

### 11.3 故障转移伪代码

```python
def handle_engine_failure(engine: str, error: str):
    """引擎故障处理"""
    health = engine_health[engine]
    health["consecutive_failures"] += 1
    health["last_error"] = error
    health["last_failure_at"] = now()

    if health["consecutive_failures"] >= 3:
        health["status"] = "unhealthy"
        other_engine = "codex" if engine == "claude" else "claude"

        if engine_health[other_engine]["status"] == "healthy":
            # 全自动故障转移：将排队任务重新路由（无需人类介入）
            reroute_pending_tasks(from_engine=engine, to_engine=other_engine)
            log_info(f"{engine} 引擎故障，已自动切换到 {other_engine}")
        else:
            # 🔴 人类介入点 #3：双引擎都故障，必须通知人类
            pause_dispatcher()
            send_emergency_alert("双引擎均故障，调度已暂停，需要人类帮助！")

def handle_engine_recovery(engine: str):
    """引擎恢复处理"""
    health = engine_health[engine]
    health["consecutive_failures"] = 0
    health["status"] = "healthy"
    health["recovered_at"] = now()
    # 重新平衡负载
    rebalance_workers()
```

---

## 十二、远程访问架构

### 12.1 架构总览

```
┌────────────────────────────────────────────────────────────┐
│  移动设备 / 远程电脑                                         │
│                                                            │
│  iPhone/iPad (Safari PWA)  ←──┐                            │
│  Mac/PC (浏览器)            ←──┤                            │
│  SSH 终端                   ←──┤                            │
└────────────────────────────────┤────────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  安全隧道 (任选其一)       │
                    │                         │
                    │  方案 A: Tailscale VPN   │  ← 推荐：零配置 P2P
                    │  方案 B: Cloudflare Tunnel│  ← 免费，无需公网 IP
                    │  方案 C: SSH 端口转发      │  ← 备用方案
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  云服务器 (EC2)           │
                    │                         │
                    │  ┌───────────────────┐  │
                    │  │ Nginx 反向代理      │  │
                    │  │ - HTTPS (Let's     │  │
                    │  │   Encrypt)         │  │
                    │  │ - Basic Auth       │  │
                    │  │ - WebSocket 代理   │  │
                    │  └─────────┬─────────┘  │
                    │            │             │
                    │  ┌─────────▼─────────┐  │
                    │  │  Web Manager       │  │
                    │  │  (Next.js :3000)   │  │
                    │  └─────────┬─────────┘  │
                    │            │             │
                    │  ┌─────────▼─────────┐  │
                    │  │  Task Dispatcher   │  │
                    │  │  (FastAPI :8000)   │  │
                    │  └──┬──────┬──────┬──┘  │
                    │     │      │      │     │
                    │   Claude  Claude  Codex │
                    │   Worker  Worker  Worker│
                    └─────────────────────────┘
```

### 12.2 Nginx 反代配置示例

```nginx
server {
    listen 443 ssl;
    server_name agent-kanban.example.com;

    ssl_certificate /etc/letsencrypt/live/agent-kanban.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/agent-kanban.example.com/privkey.pem;

    # 基础认证
    auth_basic "Agent Kanban";
    auth_basic_user_file /etc/nginx/.htpasswd;

    # Web Manager
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host $host;
    }

    # WebSocket (实时状态更新)
    location /ws/ {
        proxy_pass http://127.0.0.1:8000/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 12.3 SSH 备用通道

> **🔴 人类介入点 #7**：SSH 通道仅在 Web Manager 崩溃且 systemd 自动重启也失败的极端情况下使用。正常运行时无需 SSH。

当 Web Manager 崩溃且自动恢复失败时，通过 SSH 紧急恢复：

```bash
# 🔴 需要人类帮助：SSH 登录服务器（仅紧急恢复）
ssh user@server-ip

# 检查并重启服务（自动恢复失败时的备用手段）
systemctl status agent-kanban-dispatcher
systemctl restart agent-kanban-dispatcher
systemctl restart agent-kanban-web

# 紧急查看任务队列
cat data/dev-tasks.json | jq '.tasks[] | select(.status == "pending")'

# 紧急启动 Claude Worker（仅自动调度失败时使用）
claude -p "执行任务 task-xxx: ..." --dangerously-skip-permissions --output-format stream-json

# 紧急启动 Codex Worker（仅自动调度失败时使用）
codex exec "Review task-xxx 的代码变更" --json --full-auto

# 查看 Worker 进程
ps aux | grep -E "claude|codex"
```

> **提示**：正常情况下 systemd 会自动重启崩溃的服务（`Restart=always`），SSH 只是最后的安全网。

### 12.4 Tailscale 快速搭建

```bash
# 服务器端安装
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# 客户端 (iPhone/Mac)
# 安装 Tailscale App → 登录同一账户 → 自动组网

# 通过 Tailscale IP 访问
# http://100.x.x.x:3000 (Web Manager)
# ssh user@100.x.x.x (SSH 终端)
```

---

## 十三、Plan Mode 工作流

### 13.1 流程说明

Plan Mode 是提高任务成功率的关键机制。在正式开发前，先让 Claude Code (Plan Mode) 制定计划，必要时拆解为子任务。

> **🔴 人类介入点 #1**：Plan Mode 是本系统中**唯一常规性需要人类参与的环节**。用户勾选 Plan 模式后，AI 生成的计划需要人类审批。如果不勾选 Plan 模式，任务将全自动执行，无需人类参与。

```
用户提交任务（勾选 Plan 模式）
        │
        ▼
  Claude Code 自动生成计划          ← 全自动
  - 实现步骤
  - 需要修改的文件
  - 可能的风险
  - 子任务拆解建议（含引擎分配）
        │
        ▼
  🔴 需要人类帮助：Review 计划       ← 人类介入！
  系统发送通知到手机，等待人类审批
  ┌─────┼──────┐
  │     │      │
  ▼     ▼      ▼
 确认  修改反馈  取消
  │     │
  ▼     └──→ AI 自动重新生成计划
 自动创建子任务（自动路由到对应引擎）  ← 以下全自动
  │
  ▼
 进入 Ralph Loop 自动执行，无需人类
```

> **提示**：如果你希望 100% 无人值守，**不要勾选 Plan 模式**。系统会直接自动执行任务。Plan 模式是可选的质量保障手段，适合重要/高风险任务。

### 13.2 Plan 交互式问题

Plan 模式下，Claude Code 可以向用户提问以明确需求：

```json
{
  "plan_questions": [
    {
      "question": "新闻数据源选择：使用哪种方式获取新闻？",
      "options": [
        "DuckDuckGo HTML Scraping（免费）",
        "NewsAPI.org（免费 100 次/天）",
        "Google News RSS（免费）",
        "多源聚合（DuckDuckGo + Google News RSS，推荐）"
      ],
      "selected": 3
    },
    {
      "question": "新闻更新频率应该设为多少？",
      "options": ["每 5 分钟", "每 15 分钟（推荐）", "每 30 分钟", "每小时"],
      "selected": 1
    }
  ]
}
```

---

## 十四、Web Manager 前端设计

### 14.1 页面结构

```
┌──────────────────────────────────────────────────────┐
│  AI 协同任务管理中心           共 209 个任务  🌐 EN    │
├──────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────┐    │
│  │ 添加新任务... (Cmd/Ctrl+Enter 提交)    [语音] [添加] │    │
│  │ ☐ Plan 模式   引擎: [Auto ▼] Claude | Codex │    │
│  └──────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────┤
│ 待开发 │ 开发中 │ 待Review │ 已完成 │ 失败 │ 已取消     │
│  (12)  │  (3)   │   (2)    │ (186)  │ (4)  │  (2)     │
├────────┼────────┼──────────┼────────┼──────┼──────────┤
│ Card   │ Card   │ Card     │ Card   │ Card │ Card     │
│ Card   │ Card   │ Card     │ Card   │      │          │
│ Card   │ Card   │          │ Card   │      │          │
│ ...    │        │          │ ...    │      │          │
└──────────────────────────────────────────────────────┘
```

### 14.2 任务卡片信息

```
┌─────────────────────────────┐
│ #210 [Plan] [Claude]        │  ← 引擎标签
│ 现在文档和序                  │
│ 需要调整定宽定高...           │
│                             │
│ 创建: 2 月 14 日             │
│ 耗时: 20 分钟                │
│ ┌─────┐                    │
│ │ 展开 │                    │
│ └─────┘                    │
└─────────────────────────────┘

┌─────────────────────────────┐
│ #211 [Review] [Codex]       │  ← Codex Review 任务
│ Review #210 安全性            │
│ 状态: 发现 2 个问题           │
│                             │
│ 创建: 2 月 14 日             │
│ 耗时: 3 分钟                 │
│ ┌─────┐                    │
│ │ 展开 │                    │
│ └─────┘                    │
└─────────────────────────────┘
```

### 14.3 关键交互

| 操作 | 说明 | 后续自动化 |
|------|------|-----------|
| Enter 换行 | 输入框内换行 | - |
| Cmd/Ctrl+Enter 提交 | 提交新任务 | 提交后全自动：路由 → 分配 → 开发 → Review → 合并 |
| 语音按钮 | 启动语音识别，转文字填入输入框 | 自动转写后仍需人类确认提交 |
| Plan 模式复选框 | 勾选后任务先生成计划 | 🔴 需要人类审批计划（不勾则全自动） |
| 引擎选择下拉 | Auto（智能路由）/ Claude / Codex | Auto = 全自动路由，无需选择 |
| 卡片点击展开 | 查看任务详情、日志、Review 结果 | 仅供查看，非必须操作 |
| 拖拽卡片 | 紧急情况下可人为干预任务状态 | 正常运行无需使用 |

### 14.4 移动端适配 (PWA)

```
iPhone Safari → 添加到主屏幕 → 伪 App 体验

┌──────────────┐
│ 任务管理中心   │
├──────────────┤
│ [语音输入框]  │
│ [Auto ▼]     │  ← 引擎选择
│ ┌──────────┐ │
│ │ 开发中(3) │ │
│ │ Card [C] │ │  ← [C] = Claude, [X] = Codex
│ │ Card [C] │ │
│ └──────────┘ │
│ ┌──────────┐ │
│ │ 待Review  │ │
│ │ Card [X] │ │
│ └──────────┘ │
├──────────────┤
│ 文档 会议 邮件│  ← 底部导航
└──────────────┘
```

---

## 十五、语音输入集成

### 15.1 方案选择

| 方案 | 优点 | 缺点 | 推荐场景 |
|------|------|------|---------|
| Web Speech API | 免费、浏览器原生 | 准确率一般、需在线 | 简单指令 |
| OpenAI Whisper API | 高准确率、支持中英文 | 收费（$0.006/分钟） | 生产环境 |
| 本地 Whisper | 免费、离线可用 | 需要 GPU、延迟高 | 隐私敏感场景 |

### 15.2 语音输入 UI 状态

```
非录音状态:
┌────────────────────────────────────┐
│ [上传]  [  输入消息...  ]  [🎤]    │  ← 录音输入栏
│ [编辑]  [导图]  [历史]              │  ← sub-tabs
│ [文档] [会议] [人才] [邮件] [设置]   │  ← 主导航 tabs
└────────────────────────────────────┘

录音中:
┌────────────────────────────────────┐
│ [x]  00:05  [暂停] [停止]           │  ← 红色录音条
│ [编辑]  [导图]  [历史]              │  ← sub-tabs
│ [文档] [会议] [人才] [邮件] [设置]   │  ← 主导航 tabs
└────────────────────────────────────┘
```

---

## 十六、Git Worktree 并行开发规范

### 16.1 目录结构

```
/app/
├── main-repo/              # 主仓库 (main 分支)
│   ├── CLAUDE.md           # Claude Worker 配置
│   ├── codex.md            # Codex Worker 配置（CODEX.md 规范）
│   ├── PROGRESS.md         # 经验记录（所有 Worker 共用）
│   ├── data/
│   │   ├── dev-tasks.json  # 任务队列（共享）
│   │   ├── dev-task.lock   # 文件锁（共享）
│   │   └── api-key.json    # API 密钥（共享）
│   └── src/                # 源代码
│
├── worktrees/
│   ├── worker-0/           # Claude Worker 0
│   │   ├── data/ → symlink to main-repo/data/
│   │   ├── CLAUDE.md → symlink
│   │   └── src/            # 独立的代码副本
│   ├── worker-1/           # Claude Worker 1
│   ├── worker-2/           # Claude Worker 2
│   ├── worker-3/           # Codex Worker 0
│   │   ├── data/ → symlink to main-repo/data/
│   │   ├── codex.md → symlink
│   │   └── src/            # 独立的代码副本
│   ├── worker-4/           # Codex Worker 1
│   └── ...
│
└── backups/                # 自动备份目录
```

### 16.2 Symlink 规则

| 文件 | Symlink? | 说明 |
|------|----------|------|
| `dev-tasks.json` | 是 | 所有 Worker 共享任务队列 |
| `dev-task.lock` | 是 | 所有 Worker 共享文件锁 |
| `api-key.json` | 是 | 所有 Worker 共享 API 密钥 |
| `PROGRESS.md` | **否** | 直接用 `git -C /app/main-repo` 编辑主仓库文件 |
| `CLAUDE.md` | 是 | Claude Worker 共享配置 |
| `codex.md` | 是 | Codex Worker 共享配置 |
| `src/` | **否** | 每个 Worker 独立副本，避免冲突 |
| `data/` (实验数据) | **否** | 每个 Worker 独立数据目录 |

### 16.3 Worker 合并流程

```bash
# 每个 Worker 完成任务后的标准合并流程（Claude 和 Codex Worker 通用）
cd /app/worktrees/worker-N

# 1. 提交当前改动
git add -A
git commit -m "feat: [描述] (task-id: task-xxx)"

# 2. 拉取最新主分支
git fetch origin

# 3. Rebase 到最新 main
git rebase origin/main

# 4. 如果有冲突 → 按冲突处理流程解决

# 5. 推送到远程
git push origin HEAD:main

# 6. 清理 worktree 分支
git checkout main
git branch -d worker-N-branch
```

---

## 十七、监控与可观测性

### 17.1 Dashboard 指标

```
┌──────────────────────────────────────────────────┐
│              系统监控面板（双引擎）                   │
├────────────┬────────┬────────┬───────────────────┤
│ Worker     │ 引擎    │ 状态    │ 当前任务           │
├────────────┼────────┼────────┼───────────────────┤
│ Worker-0   │ Claude │ 🟢 开发中│ task-211: 新闻功能  │
│ Worker-1   │ Claude │ 🟢 开发中│ task-212: 邮件修复  │
│ Worker-2   │ Claude │ ⚪ 空闲  │ -                 │
│ Worker-3   │ Codex  │ 🟢 Review│ task-210: 安全审查  │
│ Worker-4   │ Codex  │ ⚪ 空闲  │ -                 │
├────────────┴────────┴────────┴───────────────────┤
│ 引擎状态                                          │
│ Claude: 🟢 正常  延迟: 2.1s  任务: 150  成功率: 98%│
│ Codex:  🟢 正常  延迟: 1.5s  任务: 59   成功率: 97%│
├──────────────────────────────────────────────────┤
│ 今日统计                                          │
│ 完成: 23 (Claude: 15, Codex: 8)                  │
│ 失败: 2   成功率: 92%                              │
│ 平均耗时: Claude 4.2 分钟  Codex 2.1 分钟          │
│ Commits: 25 (约 1.04 commit/分钟)                 │
│ 对抗式 Review: 15 次 (发现问题: 6 次)              │
└──────────────────────────────────────────────────┘
```

### 17.2 日志收集

每个 Worker 的输出被 Dispatcher 解析，提取关键事件：

**Claude Worker 日志** (stream-json):
```json
{
  "timestamp": "2026-02-20T10:05:23Z",
  "worker_id": "worker-0",
  "engine": "claude",
  "task_id": "task-211",
  "event": "tool_use",
  "tool": "bash",
  "command": "npm test",
  "result": "pass",
  "duration_ms": 3200
}
```

**Codex Worker 日志** (JSONL):
```json
{
  "timestamp": "2026-02-20T10:05:23Z",
  "worker_id": "worker-3",
  "engine": "codex",
  "task_id": "task-210-review",
  "event": "output_text.delta",
  "content": "{\"issues\": [{\"severity\": \"high\", ...}]}",
  "duration_ms": 1800
}
```

### 17.3 告警规则

| 条件 | 动作 | 自动化 |
|------|------|--------|
| 任务执行超过 15 分钟 | 自动标记为超时，自动终止进程 | 全自动 |
| 所有 Worker 空闲但队列有任务 | 自动重启 Dispatcher | 全自动 |
| 磁盘使用率 > 80% | 自动清理旧 backup | 全自动 |
| 某引擎连续 3 次失败 | 自动故障转移，路由到另一引擎 | 全自动 |
| Worker 连续 3 次任务失败 | 自动暂停该 Worker，**🔴 通知人类** | 🔴 人类介入点 #4 |
| 双引擎同时故障 | 自动暂停调度，**🔴 紧急通知人类** | 🔴 人类介入点 #3 |
| 对抗式 Review 连续 3 次不通过 | 自动暂停任务，**🔴 通知人类审查** | 🔴 人类介入点 #2 |

---

## 十八、安全与运维

### 18.1 权限隔离

```
EC2 实例
├── Docker Container (推荐)
│   ├── 非 root 用户运行
│   ├── 只挂载必要目录
│   ├── 网络: 仅暴露 Web Manager 端口
│   ├── Claude Code: --dangerously-skip-permissions
│   │   (在容器内可控，不影响宿主机)
│   └── Codex CLI: 自带沙箱 (Landlock/Seatbelt)
│       (原生安全，无需额外隔离)
```

### 18.2 安全检查清单

> **🔴 人类介入点 #5**：以下清单为**一次性初始搭建**，完成后系统自动运行，无需反复配置。

- [ ] 🔴 Claude Code 运行在隔离容器中（一次性配置）
- [ ] 🔴 Codex CLI 沙箱模式验证正常（一次性验证）
- [ ] 🔴 API Key 配置到环境变量或 `api-key.json`（一次性配置）
- [ ] 🔴 Web Manager 添加基础认证（一次性配置）
- [ ] 🔴 EC2 安全组仅开放必要端口（一次性配置）
- [ ] 自动：每小时自动备份数据（crontab 自动执行）
- [ ] 🔴 HTTPS 加密传输配置（一次性配置，Let's Encrypt 自动续期）
- [ ] 🔴 Tailscale/VPN 加密通道安装（一次性配置）
- [ ] 自动：对抗式 Review 安全审查（每次任务自动触发）

### 18.3 成本估算

| 项目 | 月费用 (估算) |
|------|-------------|
| Claude Max Plan (Claude Code) | $100-200 |
| OpenAI Codex CLI (ChatGPT Pro/API) | $20-200 |
| EC2 (t3.medium) | ~$30 |
| Whisper API (语音) | ~$5-10 |
| 域名 + SSL | ~$1 |
| Tailscale (免费 Personal) | $0 |
| **合计** | **~$156-441/月** |

> 注：双引擎订阅费是主要成本，但代码质量和任务成功率的提升带来更高的投入产出比。通过智能路由减少不必要的 API 调用可以优化成本。
>
> **🔴 人类介入点 #6**：API Key / 订阅需要人类管理。Key 过期或额度用尽时，系统自动检测并通知人类更新。建议设置订阅自动续费，减少人工干预。

---

## 十九、实施路线图

### Phase 1: 基础设施 (1-2 天) — 🔴 需要人类帮助
> **这是唯一需要人类大量参与的阶段。** 完成后系统自动运行。

- [ ] 🔴 EC2 实例 + Docker 环境搭建（人类操作）
- [ ] 🔴 Claude Code CLI 安装配置（人类操作）
- [ ] 🔴 Codex CLI 安装配置（人类操作）
- [ ] 🔴 Git 仓库初始化 + CLAUDE.md + codex.md + PROGRESS.md（人类操作）
- [ ] 🔴 单引擎 (Claude) Ralph Loop 跑通验证（人类验证）

### Phase 2: 双引擎并行化 (2-3 天) — 可由 AI 辅助开发
- [ ] Git Worktree 多 Worker 架构（区分 Claude / Codex Worker）
- [ ] Task Dispatcher 双引擎调度开发
- [ ] 智能任务路由引擎实现
- [ ] dev-tasks.json 扩展（支持 engine、task_type 字段）
- [ ] 🔴 验证 Claude + Codex Worker 并行工作（人类验收）

### Phase 3: Web Manager (3-5 天) — 可由 AI 辅助开发
- [ ] Kanban 看板前端 (React/Next.js)
- [ ] 任务 CRUD API（支持引擎选择）
- [ ] Worker 状态监控面板（双引擎视图）
- [ ] PWA 移动端适配
- [ ] 🔴 远程访问配置 (Nginx + HTTPS + Tailscale)（人类配置服务器）

### Phase 4: 质量保障 (2-3 天) — 全自动运行
- [ ] 对抗式 Review 机制实现（实现后全自动运行）
- [ ] 任务拆解 (Task Decomposition) 实现（实现后全自动运行）
- [ ] 引擎健康检查与故障转移（实现后全自动运行）
- [ ] Plan Mode 集成（Plan 审批需人类，其余自动）

### Phase 5: 增强功能 (2-3 天) — 全自动运行
- [ ] 语音输入集成 (Whisper API)
- [ ] 自动备份机制（crontab 全自动）
- [ ] 告警与通知（自动推送到手机，🔴 异常时需人类响应）
- [ ] 成本监控面板

### Phase 6: 优化迭代 (持续) — 系统自学习 + 人类定期 Review
- [ ] 自动提高任务成功率 (目标 95%+)
- [ ] PROGRESS.md 自动经验积累（双引擎经验）
- [ ] 🔴 CLAUDE.md / codex.md 调优（需人类判断调优方向）
- [ ] 路由规则自动优化（基于历史数据自学习）
- [ ] 🔴 根据使用反馈持续改进（需人类提供反馈）

---

## 附录

### A. 关键命令速查

```bash
# ============ Claude Code CLI ============

# 启动 Claude Code (非交互式，跳过权限，JSON 日志)
claude -p "[prompt]" --dangerously-skip-permissions --output-format stream-json --verbose

# Claude Code 继续会话
claude --resume

# Claude Code Plan 模式
claude -p "[prompt]" --dangerously-skip-permissions --output-format stream-json --allowedTools "Read,Glob,Grep"

# ============ Codex CLI ============

# 启动 Codex CLI (非交互式，全自动，JSON 输出)
codex exec "[prompt]" --json --full-auto

# Codex CLI 带输出 Schema
codex exec "[prompt]" --json --full-auto --output-schema '{"type":"object","properties":{"issues":{"type":"array"}}}'

# Codex CLI 恢复上次会话
codex exec resume --last

# Codex CLI 指定模型
codex exec "[prompt]" --json --full-auto --model gpt-4.1

# ============ Git Worktree ============

# 创建 Git Worktree
git worktree add ../worktrees/worker-N -b worker-N-branch

# 查看所有 Worktree
git worktree list

# 清理 Worktree
git worktree remove ../worktrees/worker-N

# ============ 系统管理 ============

# 备份数据
tar -czf backup-$(date +%Y%m%d).tar.gz data/ PROGRESS.md

# 查看 Worker 进程
ps aux | grep -E "claude|codex"

# 重启 Dispatcher
systemctl restart agent-kanban-dispatcher

# 查看引擎健康状态
curl http://localhost:8000/api/health
```

### B. 成功率提升经验

根据原文作者经验，从 20% 提升到 95% 的关键因素：

1. **CLAUDE.md / codex.md 精确定义流程** - 每一步都不模糊
2. **PROGRESS.md 积累教训** - 让 AI 从错误中学习
3. **stream-json / JSONL 监控** - Dispatcher 能发现并处理异常
4. **Plan Mode 前置确认** - 减少方向性错误
5. **冲突处理标准化** - 不放弃，必须解决后继续
6. **自动备份** - 防止灾难性数据丢失
7. **对抗式 Review** - 双引擎交叉验证，发现单引擎盲区
8. **智能路由** - 让最擅长的引擎处理最适合的任务
9. **故障转移** - 单引擎故障不影响系统运行

### C. 自动化全景图 — 人类介入点速查

> **系统设计目标：99% 全自动运行，人类只在提交任务时参与（15 秒），其余全程无人值守。**

```
人类的一天 (使用 Agent Kanban)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

08:00  📱 手机提交 3 个任务 (语音/文字)           ← 人类操作 (1 分钟)
08:01  🤖 系统自动：路由 → 拆解 → 分配 → 开发      ← 全自动
08:15  🤖 系统自动：Claude 完成任务 1               ← 全自动
08:16  🤖 系统自动：Codex 自动 Review 任务 1        ← 全自动
08:18  🤖 系统自动：Review 通过，自动合并            ← 全自动
08:30  🤖 系统自动：任务 2 完成并合并               ← 全自动
09:00  📱 收到通知：任务 3 的 Plan 需要审批          ← 🔴 人类审批 (30 秒)
09:01  🤖 系统自动：按计划执行任务 3                 ← 全自动
09:20  🤖 系统自动：任务 3 完成并合并               ← 全自动
  ...
18:00  📱 手机查看今日报告：完成 23 个任务           ← 可选查看

人类总参与时间：约 2 分钟 / 天
系统自动运行时间：23 小时 58 分钟 / 天
```

**🔴 需要人类帮助的 7 个场景（按频率排序）：**

| 频率 | # | 场景 | 人类操作 | 耗时 |
|------|---|------|---------|------|
| 日常 | 1 | Plan Mode 审批 | 手机点击 "确认" 或 "修改" | 30 秒/次 |
| 罕见 | 2 | 对抗式 Review 3 轮未通过 | 查看问题，给出修复方向 | 5-10 分钟 |
| 罕见 | 4 | Worker 连续失败 | 查看日志，判断原因 | 5 分钟 |
| 极罕见 | 3 | 双引擎同时故障 | SSH 检查网络/API Key | 10-30 分钟 |
| 极罕见 | 7 | SSH 紧急恢复 | SSH 重启服务 | 5-10 分钟 |
| 一次性 | 5 | 初始环境搭建 | 部署服务器、安装 CLI | 1-2 天 |
| 一次性 | 6 | API Key / 订阅管理 | 配置 Key，设置自动续费 | 10 分钟 |

### D. 参考资源

- Claude Code 官方文档
- OpenAI Codex CLI 官方文档 (codex.openai.com)
- Git Worktree 文档: `man git-worktree`
- Ralph Loop 概念: PingCAP CTO Dongxu Huang
- 原文作者: 胡渊鸣 (Ethan Hu)
- claude-octopus: 多引擎 AI 协同参考
