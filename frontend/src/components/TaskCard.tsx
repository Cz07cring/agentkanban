"use client";

import { Task, TaskStatus } from "@/lib/types";

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "N/A";
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours().toString().padStart(2, "0");
  const mins = date.getMinutes().toString().padStart(2, "0");
  return `${month}月${day}日 ${hours}:${mins}`;
}

function getElapsedTime(startedAt: string, completedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const diffMs = end - start;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  return `${hours} 小时 ${mins % 60} 分钟`;
}

const BADGE_TOKENS = {
  base: "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium",
  subtle: "bg-slate-700/40 text-slate-300 border-slate-600/50",
  priority: {
    high: "bg-red-500/20 text-red-300 border-red-500/30",
    medium: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    low: "bg-slate-600/30 text-slate-300 border-slate-500/40",
  },
  status: {
    pending: "bg-slate-600/30 text-slate-300 border-slate-500/40",
    in_progress: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    plan_review: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    blocked_by_subtasks: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
    reviewing: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    completed: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    failed: "bg-red-500/20 text-red-300 border-red-500/30",
    cancelled: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
  } as Record<TaskStatus, string>,
  engine: {
    claude: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    codex: "bg-green-500/20 text-green-300 border-green-500/30",
    auto: "bg-slate-600/30 text-slate-300 border-slate-500/40",
  } as Record<string, string>,
};

const priorityLabels: Record<string, string> = { high: "高", medium: "中", low: "低" };
const statusLabels: Record<TaskStatus, string> = {
  pending: "待开发",
  in_progress: "开发中",
  plan_review: "待审批",
  blocked_by_subtasks: "子任务中",
  reviewing: "待 Review",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
const engineLabels: Record<string, string> = { claude: "Claude", codex: "Codex", auto: "Auto" };
const taskTypeLabels: Record<string, string> = {
  feature: "功能",
  bugfix: "修复",
  review: "审查",
  refactor: "重构",
  analysis: "分析",
  plan: "计划",
  audit: "审计",
};

export default function TaskCard({ task, onExpand }: { task: Task; onExpand?: (task: Task) => void }) {
  const engine = task.routed_engine || task.engine;

  return (
    <div
      className="bg-slate-800/80 border border-slate-700/50 rounded-lg p-3 hover:border-slate-600/80 transition-all cursor-pointer group"
      data-task-id={task.id}
      data-task-status={task.status}
      onClick={() => onExpand?.(task)}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-500 font-mono">#{task.id.replace("task-", "")}</span>
        {task.plan_mode && <span className={`${BADGE_TOKENS.base} ${BADGE_TOKENS.subtle}`}>Plan</span>}
      </div>

      <h3 className="text-sm font-semibold text-slate-100 mb-2 leading-snug">{task.title}</h3>

      <div className="flex flex-wrap gap-1.5 mb-2">
        <span className={`${BADGE_TOKENS.base} ${BADGE_TOKENS.status[task.status]}`}>{statusLabels[task.status]}</span>
        <span className={`${BADGE_TOKENS.base} ${BADGE_TOKENS.engine[engine] || BADGE_TOKENS.engine.auto}`}>
          {engineLabels[engine] || engineLabels.auto}
        </span>
        <span className={`${BADGE_TOKENS.base} ${BADGE_TOKENS.priority[task.priority]}`}>{priorityLabels[task.priority]}</span>
      </div>

      <p className="text-xs text-slate-400 mb-2 line-clamp-2 leading-relaxed">{task.description}</p>

      <details className="mt-2 border-t border-slate-700/40 pt-2">
        <summary className="text-[11px] text-slate-500 cursor-pointer list-none">次要信息</summary>
        <div className="mt-2 space-y-1.5 text-[11px] text-slate-500">
          <div className="flex items-center justify-between">
            <span>创建时间</span>
            <span>{formatTime(task.created_at)}</span>
          </div>
          {task.started_at && (
            <div className="flex items-center justify-between">
              <span>耗时</span>
              <span>{getElapsedTime(task.started_at, task.completed_at)}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span>任务类型</span>
            <span>{taskTypeLabels[task.task_type] || task.task_type}</span>
          </div>
          {task.assigned_worker && <div className="truncate">Worker: {task.assigned_worker}</div>}
        </div>
      </details>

      {task.error_log && (
        <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-[11px] text-red-400 line-clamp-3">{task.error_log}</div>
      )}

      {onExpand && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onExpand(task);
          }}
          className="mt-2 w-full text-xs text-slate-500 hover:text-slate-300 transition-colors py-1 opacity-0 group-hover:opacity-100"
        >
          展开详情
        </button>
      )}
    </div>
  );
}
