import { TaskStatus, TaskType } from "@/lib/types";

/**
 * 术语策略：
 * - 产品术语与技术角色名保留英文首字母大写（Plan / Review / Worker / Claude / Codex）。
 * - 业务动作与状态采用中文。
 */
export const TERMS = {
  plan: "Plan",
  review: "Review",
  worker: "Worker",
  claude: "Claude",
  codex: "Codex",
  auto: "Auto",
} as const;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "待开发",
  in_progress: "开发中",
  plan_review: "待审批",
  blocked_by_subtasks: "子任务中",
  reviewing: `待 ${TERMS.review}`,
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export const TASK_PRIORITY_LABELS: Record<"high" | "medium" | "low", string> = {
  high: "高",
  medium: "中",
  low: "低",
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  feature: "功能",
  bugfix: "修复",
  review: "审查",
  refactor: "重构",
  analysis: "分析",
  plan: "计划",
  audit: "审计",
};

export const EVENT_LEVEL_LABELS: Record<"info" | "warning" | "error" | "critical", string> = {
  info: "信息",
  warning: "警告",
  error: "错误",
  critical: "严重",
};
