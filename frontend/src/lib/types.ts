export type TaskStatus =
  | "pending"
  | "in_progress"
  | "plan_review"
  | "reviewing"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskType =
  | "feature"
  | "bugfix"
  | "review"
  | "refactor"
  | "analysis"
  | "plan"
  | "audit";

export type Engine = "auto" | "claude" | "codex";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: "high" | "medium" | "low";
  task_type: TaskType;
  engine: Engine;
  routed_engine: Engine | null;
  parent_task_id: string | null;
  sub_tasks: string[];
  depends_on: string[];
  plan_mode: boolean;
  plan_content: string | null;
  assigned_worker: string | null;
  worktree_branch: string | null;
  review_status: string | null;
  review_engine: Engine | null;
  review_result: ReviewResult | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  commit_ids: string[];
  error_log: string | null;
  retry_count: number;
  max_retries: number;
}

export interface ReviewResult {
  issues: ReviewIssue[];
  summary: string;
}

export interface ReviewIssue {
  severity: "critical" | "high" | "medium" | "low";
  file: string;
  line: number;
  description: string;
  suggestion: string;
}

export interface Worker {
  id: string;
  engine: Engine;
  port: number;
  worktree_path: string;
  status: "idle" | "busy" | "error";
  capabilities: TaskType[];
  current_task_id: string | null;
  pid: number | null;
  started_at: string | null;
  total_tasks_completed: number;
  health: {
    last_heartbeat: string;
    consecutive_failures: number;
    avg_task_duration_ms: number;
  };
}

export interface TasksData {
  tasks: Task[];
  meta: {
    last_updated: string;
    total_completed: number;
    success_rate: number;
    claude_tasks: number;
    codex_tasks: number;
  };
}

export const KANBAN_COLUMNS: {
  id: TaskStatus;
  label: string;
  color: string;
}[] = [
  { id: "pending", label: "待开发", color: "bg-slate-500" },
  { id: "in_progress", label: "开发中", color: "bg-blue-500" },
  { id: "reviewing", label: "待 Review", color: "bg-amber-500" },
  { id: "completed", label: "已完成", color: "bg-emerald-500" },
  { id: "failed", label: "失败", color: "bg-red-500" },
  { id: "cancelled", label: "已取消", color: "bg-gray-500" },
];
