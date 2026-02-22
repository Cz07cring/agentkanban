# 任务卡片/详情重构截图验收标准

## 对比基线
- 看板总览基线：`01-layout-and-stats.png`、`30-full-board-overview.png`
- 详情面板基线：`08a-detail-panel-open.png`、`17a-detail-panel-open.png`
- Review 与错误态补充：`10a-status-reviewing.png`、`15-task-error-log.png`

## 验收目标（首屏 3 秒规则）
在重构后截图中，测试人员应在 3 秒内完成以下识别：
1. **任务状态**：无需滚动即可看到状态标签（如开发中/待审批/失败）。
2. **下一步动作**：详情面板首屏直接可见可执行操作（状态流转、分配 Worker、触发 Review、重试等）。
3. **信息分层**：
   - 第一层只展示标题、状态、引擎、优先级。
   - 第二层（创建时间、耗时、task_type）默认折叠或弱化，不抢占视觉焦点。

## 视觉与排版检查点
- 卡片 badge 样式保持统一（圆角、边框、字号一致），不出现明显“单独配色”突兀块。
- 正文字号不低于 13px，标题与段落间距明显优于旧版拥挤状态。
- `plan_content` / `review_result` / `error_log` 为可折叠区域，默认不影响首屏关键信息阅读。

## 建议截图命名
- `31-task-card-hierarchy.png`
- `32-detail-panel-top-priority-blocks.png`
- `33-detail-panel-accordion-open.png`
