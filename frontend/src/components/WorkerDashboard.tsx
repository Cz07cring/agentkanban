"use client";

import { Worker, Task } from "@/lib/types";

const engineColors: Record<string, { bg: string; dot: string; text: string }> = {
  claude: {
    bg: "border-orange-500/30",
    dot: "bg-orange-400",
    text: "text-orange-400",
  },
  codex: {
    bg: "border-green-500/30",
    dot: "bg-green-400",
    text: "text-green-400",
  },
};

const statusIndicator: Record<string, { color: string; label: string }> = {
  idle: { color: "bg-slate-500", label: "空闲" },
  busy: { color: "bg-blue-500 animate-pulse", label: "工作中" },
  error: { color: "bg-red-500", label: "错误" },
};

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

export default function WorkerDashboard({
  workers,
  tasks,
}: {
  workers: Worker[];
  tasks: Task[];
}) {
  const claudeWorkers = workers.filter((w) => w.engine === "claude");
  const codexWorkers = workers.filter((w) => w.engine === "codex");

  const totalBusy = workers.filter((w) => w.status === "busy").length;
  const totalCompleted = workers.reduce(
    (sum, w) => sum + w.total_tasks_completed,
    0
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
      {/* Overview stats */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="总 Worker" value={workers.length} />
        <StatCard label="活跃" value={totalBusy} color="text-blue-400" />
        <StatCard
          label="空闲"
          value={workers.length - totalBusy}
          color="text-slate-400"
        />
        <StatCard
          label="已完成任务"
          value={totalCompleted}
          color="text-emerald-400"
        />
      </div>

      {/* Engine sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Claude Workers */}
        <div className="bg-slate-900/50 border border-slate-800/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-orange-400" />
            <h3 className="text-sm font-medium text-orange-400">
              Claude Workers
            </h3>
            <span className="text-xs text-slate-500 ml-auto">
              {claudeWorkers.filter((w) => w.status === "busy").length}/
              {claudeWorkers.length} 活跃
            </span>
          </div>
          <div className="space-y-2">
            {claudeWorkers.map((w) => (
              <WorkerCard key={w.id} worker={w} tasks={tasks} />
            ))}
          </div>
        </div>

        {/* Codex Workers */}
        <div className="bg-slate-900/50 border border-slate-800/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <h3 className="text-sm font-medium text-green-400">
              Codex Workers
            </h3>
            <span className="text-xs text-slate-500 ml-auto">
              {codexWorkers.filter((w) => w.status === "busy").length}/
              {codexWorkers.length} 活跃
            </span>
          </div>
          <div className="space-y-2">
            {codexWorkers.map((w) => (
              <WorkerCard key={w.id} worker={w} tasks={tasks} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkerCard({ worker, tasks }: { worker: Worker; tasks: Task[] }) {
  const colors = engineColors[worker.engine] || engineColors.claude;
  const status = statusIndicator[worker.status] || statusIndicator.idle;
  const currentTask = worker.current_task_id
    ? tasks.find((t) => t.id === worker.current_task_id)
    : null;

  return (
    <div
      className={`p-3 bg-slate-800/60 border ${colors.bg} rounded-lg`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${status.color}`} />
          <span className="text-xs font-mono text-slate-300">{worker.id}</span>
          <span className="text-[10px] text-slate-500">
            port:{worker.port}
          </span>
        </div>
        <span
          className={`text-[10px] px-2 py-0.5 rounded ${
            worker.status === "busy"
              ? "bg-blue-500/20 text-blue-400"
              : worker.status === "error"
                ? "bg-red-500/20 text-red-400"
                : "bg-slate-700/50 text-slate-500"
          }`}
        >
          {status.label}
        </span>
      </div>

      {/* Current task */}
      {currentTask && (
        <div className="mt-2 p-2 bg-slate-900/50 rounded text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 font-mono">{currentTask.id}</span>
            <span className="text-slate-300 truncate flex-1">
              {currentTask.title}
            </span>
          </div>
        </div>
      )}

      {/* Worker stats */}
      <div className="mt-2 flex items-center gap-4 text-[10px] text-slate-500">
        <span>
          完成:{" "}
          <span className="text-slate-400">
            {worker.total_tasks_completed}
          </span>
        </span>
        <span>
          能力:{" "}
          <span className="text-slate-400">
            {worker.capabilities.join(", ")}
          </span>
        </span>
        {worker.health.avg_task_duration_ms > 0 && (
          <span>
            平均耗时:{" "}
            <span className="text-slate-400">
              {formatDuration(worker.health.avg_task_duration_ms)}
            </span>
          </span>
        )}
        {worker.health.consecutive_failures > 0 && (
          <span className="text-red-400">
            连续失败: {worker.health.consecutive_failures}
          </span>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color = "text-slate-200",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-lg p-3">
      <div className="text-[10px] text-slate-500 uppercase">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
