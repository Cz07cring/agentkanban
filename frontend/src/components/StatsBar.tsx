"use client";

import { Task, Worker } from "@/lib/types";

export default function StatsBar({
  tasks,
  workers,
}: {
  tasks: Task[];
  workers: Worker[];
}) {
  const completed = tasks.filter((t) => t.status === "completed").length;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const pending = tasks.filter((t) => t.status === "pending").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const total = tasks.length;
  const successRate =
    completed + failed > 0
      ? Math.round((completed / (completed + failed)) * 100)
      : 0;

  const busyWorkers = workers.filter((w) => w.status === "busy").length;
  const claudeWorkers = workers.filter((w) => w.engine === "claude");
  const codexWorkers = workers.filter((w) => w.engine === "codex");

  return (
    <div className="flex items-center gap-6 text-xs text-slate-400">
      <div className="flex items-center gap-4">
        <span>
          共 <span className="text-slate-200 font-medium">{total}</span> 个任务
        </span>
        <span className="text-slate-700">|</span>
        <span>
          进行中{" "}
          <span className="text-blue-400 font-medium">{inProgress}</span>
        </span>
        <span>
          待开发{" "}
          <span className="text-slate-300 font-medium">{pending}</span>
        </span>
        <span>
          已完成{" "}
          <span className="text-emerald-400 font-medium">{completed}</span>
        </span>
        {failed > 0 && (
          <span>
            失败 <span className="text-red-400 font-medium">{failed}</span>
          </span>
        )}
        <span className="text-slate-700">|</span>
        <span>
          成功率{" "}
          <span className="text-emerald-400 font-medium">{successRate}%</span>
        </span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div
            className={`w-2 h-2 rounded-full ${claudeWorkers.some((w) => w.status === "busy") ? "bg-orange-400 animate-pulse" : "bg-slate-600"}`}
          />
          <span>
            Claude{" "}
            <span className="text-orange-400">
              {claudeWorkers.filter((w) => w.status === "busy").length}/
              {claudeWorkers.length}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className={`w-2 h-2 rounded-full ${codexWorkers.some((w) => w.status === "busy") ? "bg-green-400 animate-pulse" : "bg-slate-600"}`}
          />
          <span>
            Codex{" "}
            <span className="text-green-400">
              {codexWorkers.filter((w) => w.status === "busy").length}/
              {codexWorkers.length}
            </span>
          </span>
        </div>
        <span className="text-slate-700">|</span>
        <span>
          活跃 Worker{" "}
          <span className="text-blue-400 font-medium">
            {busyWorkers}/{workers.length}
          </span>
        </span>
      </div>
    </div>
  );
}
