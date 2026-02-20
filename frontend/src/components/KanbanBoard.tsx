"use client";

import { Task, KANBAN_COLUMNS, TaskStatus } from "@/lib/types";
import TaskCard from "./TaskCard";

const columnStyles: Record<TaskStatus, string> = {
  pending: "border-t-slate-500",
  in_progress: "border-t-blue-500",
  plan_review: "border-t-purple-500",
  blocked_by_subtasks: "border-t-indigo-500",
  reviewing: "border-t-amber-500",
  completed: "border-t-emerald-500",
  failed: "border-t-red-500",
  cancelled: "border-t-gray-500",
};

export default function KanbanBoard({
  tasks,
  onExpandTask,
}: {
  tasks: Task[];
  onExpandTask?: (task: Task) => void;
}) {
  const columns = KANBAN_COLUMNS.map((col) => ({
    ...col,
    tasks: tasks.filter((t) => t.status === col.id),
  }));

  return (
    <div className="flex gap-3 md:gap-4 overflow-x-auto pb-4 min-h-0 flex-1 kanban-scroll">
      {columns.map((col) => (
        <div
          key={col.id}
          className={`flex-shrink-0 w-64 md:w-72 bg-slate-900/50 rounded-lg border border-slate-800/50 border-t-2 ${columnStyles[col.id]} flex flex-col snap-start`}
        >
          {/* Column header */}
          <div className="p-3 flex items-center justify-between border-b border-slate-800/50">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-slate-300">
                {col.label}
              </h2>
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono">
                {col.tasks.length}
              </span>
            </div>
          </div>

          {/* Column body */}
          <div className="p-2 flex flex-col gap-2 overflow-y-auto flex-1 min-h-0">
            {col.tasks.length === 0 ? (
              <div className="text-xs text-slate-600 text-center py-8">
                暂无任务
              </div>
            ) : (
              col.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onExpand={onExpandTask}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
