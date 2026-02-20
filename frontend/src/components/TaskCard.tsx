"use client";

import { Task } from "@/lib/types";

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

const priorityColors: Record<string, string> = {
  high: "bg-red-500/20 text-red-400 border-red-500/30",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

const priorityLabels: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

const engineBadge: Record<string, { bg: string; label: string }> = {
  claude: { bg: "bg-orange-500/20 text-orange-400", label: "Claude" },
  codex: { bg: "bg-green-500/20 text-green-400", label: "Codex" },
  auto: { bg: "bg-slate-500/20 text-slate-400", label: "Auto" },
};

const taskTypeLabels: Record<string, string> = {
  feature: "功能",
  bugfix: "修复",
  review: "审查",
  refactor: "重构",
  analysis: "分析",
  plan: "计划",
  audit: "审计",
};

export default function TaskCard({
  task,
  onExpand,
}: {
  task: Task;
  onExpand?: (task: Task) => void;
}) {
  const engine = task.routed_engine || task.engine;
  const badge = engineBadge[engine] || engineBadge.auto;

  return (
    <div
      className="bg-slate-800/80 border border-slate-700/50 rounded-lg p-3 hover:border-slate-600/80 transition-all cursor-pointer group"
      data-task-id={task.id}
      data-task-status={task.status}
      onClick={() => onExpand?.(task)}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-500 font-mono">
          #{task.id.replace("task-", "")}
        </span>
        <div className="flex gap-1">
          {task.plan_mode && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">
              Plan
            </span>
          )}
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.bg}`}>
            {badge.label}
          </span>
        </div>
      </div>

      <h3 className="text-sm font-medium text-slate-200 mb-1 leading-snug">
        {task.title}
      </h3>

      <p className="text-xs text-slate-400 mb-3 line-clamp-2 leading-relaxed">
        {task.description}
      </p>

      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border ${priorityColors[task.priority]}`}
          >
            {priorityLabels[task.priority]}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
            {taskTypeLabels[task.task_type] || task.task_type}
          </span>
        </div>
      </div>

      <div className="mt-2 pt-2 border-t border-slate-700/30 flex items-center justify-between">
        <span className="text-[10px] text-slate-500">
          {formatTime(task.created_at)}
        </span>
        {task.started_at && (
          <span className="text-[10px] text-slate-500">
            耗时 {getElapsedTime(task.started_at, task.completed_at)}
          </span>
        )}
      </div>

      {task.assigned_worker && (
        <div className="mt-1.5 flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-[10px] text-slate-500">
            {task.assigned_worker}
          </span>
        </div>
      )}

      {task.error_log && (
        <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-[10px] text-red-400">
          {task.error_log}
        </div>
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
