# Claude 官方 Worktree 文档研读记录与当前代码优化建议

## 1) 研读动作记录

本次先执行了官方文档拉取尝试，再做方案细化。实际操作：

- 访问尝试：
  - `https://docs.anthropic.com/en/docs/claude-code`
  - `https://docs.anthropic.com/en/docs/claude-code/overview`
  - `https://docs.anthropic.com/en/docs/claude-code/git-worktrees`
  - `https://docs.anthropic.com/en/docs/claude-code/common-workflows`
  - `https://docs.anthropic.com/en/docs/claude-code/settings`
- 结果：当前环境出网代理返回 `403 Forbidden`，无法直接抓取网页正文。

> 结论：当前仓库内先按“可验证、可回退”的工程策略推进集成；待网络放通后，把官方命令行参数和行为补齐到最终配置模板。

---

## 2) 结合官方集成预期，对当前代码做的优化方向

## 2.1 已落实的工程化优化

1. **Provider 策略增强**
   - 增加 `auto` 模式：有官方命令模板时优先 Claude，否则走 git。

2. **模板校验增强**
   - `CLAUDE_WORKTREE_CMD` 强制要求包含 `{repo}` `{path}` `{branch}`。
   - 避免因为模板漏参数导致运行时不确定行为。

3. **可执行文件存在性校验**
   - 在执行外部命令前检查可执行文件是否存在；缺失时明确报错并 fallback。

4. **错误路径健壮性**
   - 增补 `KeyError` 等模板渲染异常的处理，确保统一回退到 git。

5. **测试补齐**
   - 新增 provider 单元测试：git 路径、claude 成功、claude 失败回退、auto 模式双路径。

---

## 3) 待你确认后继续的“官方文档对齐”清单

待官方文档可访问后，按以下清单逐项对齐：

1. **官方命令与参数**
   - 校验 `CLAUDE_WORKTREE_CMD` 示例是否需要替换为官方推荐子命令。

2. **目录与分支约定**
   - 对齐官方建议的 worktree 命名和 branch 命名规范。

3. **权限模型**
   - 确认官方在 CI/daemon 场景下的权限建议（token、sandbox、cwd）并固化到部署文档。

4. **错误码/可观测**
   - 对齐官方可识别错误码，补充更细粒度的日志分类。

5. **并发约束**
   - 若官方有并发限制或推荐队列模型，映射到当前 dispatcher 的 worker 并发策略。

---

## 4) 建议你现在的决策

你现在可以先按以下方式推进，不会阻塞迭代：

1. 开发/测试环境先用 `WORKTREE_PROVIDER=auto`。
2. 若 `CLAUDE_WORKTREE_CMD` 就绪则自动走官方命令；否则自动回退 git。
3. 通过新增单测保证回退路径可靠。
4. 等网络放通后再把官方文档细节做“参数级”对齐（不需要推翻现有架构）。

