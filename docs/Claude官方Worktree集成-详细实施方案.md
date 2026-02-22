# Claude 官方 Worktree 集成详细实施方案（评审稿）

> 目标：在当前 Agent Kanban 体系中，**平滑接入 Claude 官方 Worktree 能力**，同时保留现有 git worktree 稳定路径，做到“可切换、可灰度、可回滚、可审计”。

---

## 0. 官方文档研读状态

- 已先执行官方文档访问动作（docs.anthropic.com 的 Claude Code 相关页面）。
- 当前环境受代理限制返回 `403 Forbidden`，暂无法直接抓取正文。
- 本方案先按工程最佳实践落地（可切换/可回退/可观测），待网络放通后做“命令参数级”对齐。

---

## 1. 背景与问题定义

你当前系统已经具备：
- 多 worker 并行执行；
- 每个 worker 独立 worktree；
- 任务调度与健康检查闭环。

但实际治理上还存在三个痛点：
1. **worktree 逻辑分散且偏实现导向**：未来接官方能力时可能反复改主流程；
2. **缺少统一策略层**：不同 worktree 创建方式（纯 git / 官方命令）缺少一致的观测与回退策略；
3. **上线风险不可控**：没有明确灰度与回滚标准。

本方案要解决的不是“能不能用”，而是“如何在生产中可持续、可维护地用”。

---

## 2. 方案目标与非目标

## 2.1 目标（Must Have）

1. 支持双模式：
   - `git`（默认，稳定保底）；
   - `claude`（接官方 Worktree 命令）。
2. `claude` 失败自动回退 `git`，业务不中断。
3. 配置化切换（环境变量控制），不改业务 API。
4. 可观测：日志能明确“本次用了哪个 provider、是否 fallback、失败原因”。
5. 可灰度：先单 worker / 单项目 / 单环境试点。

## 2.2 非目标（Not in this phase）

1. 暂不改任务路由规则与引擎分配算法；
2. 暂不改 UI；
3. 暂不一次性把 merge/rebase 流水线全部重构（后续二期）。

---

## 3. 总体架构设计

## 3.1 分层

### A. Provider 抽象层（新增）
- 统一入口：`ensure_worktree(...)`
- 负责 provider 选择、执行、fallback、错误归一化。

### B. Orchestrator 业务层（现有 main）
- 只关心“拿到可用 worktree 路径”；
- 不关心具体是 git 还是 claude 创建。

### C. 配置层
- `WORKTREE_PROVIDER=git|claude|auto`
- `CLAUDE_WORKTREE_CMD`（官方命令模板）

---

## 4. 关键业务流程（端到端）

## 4.1 任务调度触发 worktree 准备

1. Dispatcher 选中任务和 worker。
2. 执行 `_prepare_worktree_for_task(...)`。
3. 若 worker worktree 不存在，调用 `_ensure_worktree(...)`。
4. `_ensure_worktree(...)` 调 Provider 抽象。
5. Provider 按配置执行：
   - `git`：原生 `git worktree add`；
   - `claude`：执行官方命令模板。
6. 若 `claude` 失败：记录 warning 并 fallback `git`。
7. 返回 worktree path，进入 task branch 准备与执行。

## 4.2 异常处理策略

- `claude` 命令异常（退出码非 0、超时、模板错误）：fallback `git`。
- `git` 也失败：退回 repo root（现有兜底行为）。
- 所有失败路径都写日志，且保留上下文（worker、repo、branch、provider）。

---

## 5. 配置规范（建议）

## 5.1 环境变量定义

- `WORKTREE_PROVIDER`
  - 可选：`git` / `claude` / `auto`
  - 默认：`git`（建议灰度可用 `auto`）
- `CLAUDE_WORKTREE_CMD`
  - 字符串模板，支持占位符：`{repo}` `{path}` `{branch}`
  - 仅在 `WORKTREE_PROVIDER=claude` 时生效

## 5.2 推荐配置示例

### 开发环境（默认）
```bash
WORKTREE_PROVIDER=git
```

### 灰度环境（官方集成）
```bash
WORKTREE_PROVIDER=claude
CLAUDE_WORKTREE_CMD='claude worktree create --repo "{repo}" --path "{path}" --branch "{branch}"'
```

### 自适应模式（推荐试点）
```bash
WORKTREE_PROVIDER=auto
CLAUDE_WORKTREE_CMD='claude worktree create --repo "{repo}" --path "{path}" --branch "{branch}"'
```

> 说明：具体子命令以 Claude 官方最终 CLI 为准；这里是模板占位写法。

---

## 6. 数据与可观测性设计

## 6.1 日志字段（必须）

建议每次 ensure worktree 输出结构化日志字段：
- `event=worktree_ensure`
- `worker_id`
- `repo_path`
- `worktree_path`
- `branch`
- `provider_configured`
- `provider_selected`
- `fallback_used`（bool）
- `error_type`
- `error_message`
- `duration_ms`

## 6.2 指标（建议）

建议新增 4 个核心指标：
1. `worktree.ensure.total`
2. `worktree.ensure.failed`
3. `worktree.provider.claude.fallback_to_git`
4. `worktree.ensure.latency_ms`

用于回答三个治理问题：
- 现在稳定吗？
- 官方 provider 成功率多少？
- fallback 频率是否可接受？

---

## 7. 安全与稳健性约束

1. `CLAUDE_WORKTREE_CMD` 必须是白名单命令（上线环境建议只允许固定前缀）；
2. 模板渲染后禁止注入危险参数（避免 shell 拼接风险）；
3. 超时控制：官方命令 60s、git 命令 30s；
4. 所有异常都要可追踪，不允许 silent failure。

---

## 8. 发布与灰度策略（强烈建议按此执行）

## 8.1 四阶段灰度

### 阶段 0：本地/测试环境
- provider=claude；
- 单项目验证；
- 观察 fallback 和失败日志。

### 阶段 1：生产影子验证
- 仅 1 个 worker 使用 claude；
- 其余 worker 继续 git。

### 阶段 2：小流量
- 20% worker 切到 claude；
- 维持 24h。

### 阶段 3：全量
- 成功率达标后全量；
- 保留 git 回退开关。

## 8.2 达标阈值（建议）

- `claude provider success rate >= 95%`
- `fallback ratio <= 5%`
- 不出现“任务无法执行”的 P1 故障

---

## 9. 回滚策略

回滚只需要改配置：
```bash
WORKTREE_PROVIDER=git
```

生效后立即恢复纯 git 路径，不需要代码回滚。若出现严重故障，按顺序执行：
1. 切回 `git`；
2. 重启 dispatcher；
3. 清理异常 worktree；
4. 对失败任务执行 retry。

---

## 10. 测试计划（编码前就应约定）

## 10.1 单元测试

1. provider=git 正常创建。
2. provider=claude 成功时返回 claude。
3. provider=claude 失败时 fallback git。
4. `CLAUDE_WORKTREE_CMD` 为空时 fallback git。
5. 占位符缺失/格式错误时有明确报错。

## 10.2 集成测试

1. 调度任务时首次创建 worktree。
2. 已存在 worktree 复用路径。
3. claude 失败后任务仍能进入执行流程。
4. 多 worker 并发创建不会互相污染。

## 10.3 回归测试

1. 现有 `git` 模式所有核心流程不退化；
2. 任务状态机不受影响；
3. 失败恢复机制不受影响。

---

## 11. 里程碑与排期（建议）

## M1（0.5 天）
- 方案评审冻结
- 配置规范确认

## M2（1 天）
- provider 抽象实现
- 日志字段补齐

## M3（1 天）
- 单元测试 + 集成测试
- README/运维手册更新

## M4（0.5 天）
- 灰度发布 + 观察
- 输出复盘结论

总计：**3 天可上线首版**。

---

## 12. 验收标准（DoD）

满足以下全部条件才算完成：
1. `WORKTREE_PROVIDER` 可无重启切换（或重启后立即生效）；
2. `claude` 失败可自动 fallback `git`；
3. 日志可定位每次 provider 决策；
4. 回滚仅需改配置，不改代码；
5. 测试覆盖上述关键路径；
6. 生产灰度 24h 无 P1。

---

## 13. 二期建议（你确认后可继续）

二期建议做“治理增强包”：
1. **rebase-first gate**：fetch → rebase → test → merge；
2. **symlink 治理白/黑名单**：共享文件策略自动校验；
3. **provider 权重策略**：claude 与 git 动态切换（按成功率）。

---

## 14. 给你的决策建议（结论）

从业务与治理角度，建议你采用：
- **短期**：保持当前可插拔方案，先灰度接入官方 worktree；
- **中期**：补可观测和质量门禁；
- **长期**：把 worktree/provider 抽象升级为统一执行平台的一部分。

这条路的优点是：
- 不推翻现有系统；
- 风险低；
- 可以快速验证官方集成价值；
- 后续扩展（例如更多 provider）成本很低。

