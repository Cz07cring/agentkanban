"use client";

import { useEffect, useMemo, useState } from "react";
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
  const columns = useMemo(() => KANBAN_COLUMNS.map((col) => ({
    ...col,
    tasks: tasks.filter((t) => t.status === col.id),
  })), [tasks]);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileViewMode, setMobileViewMode] = useState<"single" | "all">("single");
  const [activeColumn, setActiveColumn] = useState<TaskStatus>("pending");

  const firstNonEmptyColumn = useMemo(
    () => columns.find((column) => column.tasks.length > 0)?.id,
    [columns],
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => {
      setIsMobile(media.matches);
      if (!media.matches) {
        setMobileViewMode("all");
      } else {
        setMobileViewMode((prev) => (prev === "all" ? "all" : "single"));
      }
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!firstNonEmptyColumn) {
      return;
    }

    const activeColumnHasTasks = columns.some(
      (column) => column.id === activeColumn && column.tasks.length > 0,
    );

    if (!activeColumnHasTasks) {
      setActiveColumn(firstNonEmptyColumn);
    }
  }, [activeColumn, columns, firstNonEmptyColumn]);

  const visibleColumns = isMobile && mobileViewMode === "single"
    ? columns.filter((column) => column.id === activeColumn)
    : columns;

  return (
    <div className="min-h-0 flex-1 flex flex-col gap-3">
      {isMobile && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-400">移动端视图</span>
            <div className="flex items-center gap-1 rounded-lg border border-slate-800/70 bg-slate-900/60 p-1">
              <button
                onClick={() => setMobileViewMode("single")}
                className={`touch-target px-2.5 py-1 text-xs rounded-md ${
                  mobileViewMode === "single"
                    ? "bg-blue-500/20 text-blue-300"
                    : "text-slate-400"
                }`}
              >
                单列
              </button>
              <button
                onClick={() => setMobileViewMode("all")}
                className={`touch-target px-2.5 py-1 text-xs rounded-md ${
                  mobileViewMode === "all"
                    ? "bg-blue-500/20 text-blue-300"
                    : "text-slate-400"
                }`}
              >
                全列
              </button>
            </div>
          </div>

          {mobileViewMode === "single" && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {columns.map((col) => (
                <button
                  key={col.id}
                  onClick={() => setActiveColumn(col.id)}
                  className={`touch-target flex-shrink-0 rounded-md border px-3 py-1.5 text-xs ${
                    activeColumn === col.id
                      ? "bg-slate-700/80 border-slate-500 text-slate-100"
                      : "bg-slate-900/60 border-slate-800/70 text-slate-400"
                  }`}
                >
                  {col.label} ({col.tasks.length})
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3 md:gap-4 overflow-x-auto pb-4 min-h-0 flex-1 kanban-scroll">
      {visibleColumns.map((col) => (
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
    </div>
  );
}
