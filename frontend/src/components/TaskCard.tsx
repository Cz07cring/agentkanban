"use client";

import { Task } from "@/lib/types";
import {
  ENGINE_BADGES,
  PRIORITY_BADGE_CLASSES,
} from "@/lib/ui-tokens";
import {
  TASK_PRIORITY_LABELS,
  TASK_TYPE_LABELS,
  TERMS,
} from "@/lib/i18n-zh";

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

export default function TaskCard({
  task,
  onExpand,
}: {
  task: Task;
  onExpand?: (task: Task) => void;
}) {
  const engine = task.routed_engine || task.engine;
  const badge = ENGINE_BADGES[engine] || ENGINE_BADGES.auto;

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
              {TERMS.plan}
            </span>
          )}
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.badgeClass}`}>
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
            className={`text-[10px] px-1.5 py-0.5 rounded border ${PRIORITY_BADGE_CLASSES[task.priority]}`}
          >
            {TASK_PRIORITY_LABELS[task.priority]}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
            {TASK_TYPE_LABELS[task.task_type] || task.task_type}
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
