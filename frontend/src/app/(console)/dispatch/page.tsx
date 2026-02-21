"use client";

import { useEffect, useState } from "react";
import {
  DispatchStatus,
  fetchDispatchQueue,
  fetchDispatchStatus,
  fetchTasks,
  toggleDispatcher,
  triggerDispatch,
} from "@/lib/api";
import { useProjectContext } from "@/lib/project-context";
import { Task } from "@/lib/types";

export default function DispatchPage() {
  const { activeProjectId } = useProjectContext();
  const [queue, setQueue] = useState<Awaited<ReturnType<typeof fetchDispatchQueue>> | null>(null);
  const [pendingTasks, setPendingTasks] = useState<Task[]>([]);
  const [dispatch, setDispatch] = useState<DispatchStatus | null>(null);

  useEffect(() => {
    const pid = activeProjectId;
    const load = async () => {
      const [queueData, taskData, dispatchData] = await Promise.all([
        fetchDispatchQueue(pid),
        fetchTasks({ status: "pending" }, pid),
        fetchDispatchStatus().catch(() => null),
      ]);
      setQueue(queueData);
      setPendingTasks(taskData.tasks);
      setDispatch(dispatchData);
    };

    load().catch(() => undefined);
    const timer = setInterval(() => load().catch(() => undefined), 5000);
    return () => clearInterval(timer);
  }, [activeProjectId]);

  const handleToggle = async () => {
    const result = await toggleDispatcher().catch(() => null);
    if (result) setDispatch((prev) => prev ? { ...prev, enabled: result.enabled } : prev);
  };

  const handleTrigger = async () => {
    await triggerDispatch().catch(() => undefined);
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold">调度中心</h1>
          <p className="text-sm text-slate-400 mt-1">队列、阻塞与引擎故障转移监控</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${dispatch?.enabled ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
            <span className="text-xs text-slate-400">
              {dispatch?.enabled ? "运行中" : "已暂停"}
              {dispatch?.cycle_count ? ` · 第 ${dispatch.cycle_count} 轮` : ""}
            </span>
          </div>
          <button
            onClick={handleToggle}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              dispatch?.enabled
                ? "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20"
                : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
            }`}
          >
            {dispatch?.enabled ? "暂停调度" : "启动调度"}
          </button>
          <button
            onClick={handleTrigger}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
          >
            立即调度
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="总任务" value={queue?.total ?? 0} />
        <Stat label="待执行" value={queue?.summary?.pending ?? 0} />
        <Stat label="进行中" value={queue?.summary?.in_progress ?? 0} />
        <Stat label="阻塞" value={queue?.blocked?.length ?? 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-slate-900/50 border border-slate-800/70 rounded-xl p-4">
          <h2 className="text-sm font-medium mb-3">阻塞队列</h2>
          <div className="space-y-2">
            {queue?.blocked?.length ? (
              queue.blocked.map((item) => (
                <div key={item.task_id} className="p-2 bg-slate-800/50 rounded border border-slate-700/50 text-xs">
                  <div className="font-mono text-slate-300">{item.task_id}</div>
                  <div className="text-slate-500 mt-1">原因: {item.reason || "unknown"}</div>
                  <div className="text-slate-500 mt-1">依赖: {item.depends_on.join(", ") || "无"}</div>
                </div>
              ))
            ) : (
              <div className="text-xs text-slate-500">暂无阻塞任务</div>
            )}
          </div>
        </section>

        <section className="bg-slate-900/50 border border-slate-800/70 rounded-xl p-4">
          <h2 className="text-sm font-medium mb-3">待调度任务</h2>
          <div className="space-y-2">
            {pendingTasks.slice(0, 20).map((task) => (
              <div key={task.id} className="p-2 bg-slate-800/50 rounded border border-slate-700/50 text-xs">
                <div className="text-slate-300">{task.title}</div>
                <div className="mt-1 text-slate-500">{task.id} · {task.priority} · {task.routed_engine || task.engine}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-slate-900/50 border border-slate-800/70 rounded-xl p-4">
          <h2 className="text-sm font-medium mb-3">引擎故障转移</h2>
          <div className="space-y-2">
            {queue?.fallback?.length ? (
              queue.fallback.map((item) => (
                <div key={item.task_id} className="p-2 bg-slate-800/50 rounded border border-slate-700/50 text-xs">
                  <div className="font-mono text-slate-300">{item.task_id}</div>
                  <div className="text-slate-500 mt-1">原因: {item.fallback_reason}</div>
                  <div className="text-slate-500">路由引擎: {item.routed_engine}</div>
                </div>
              ))
            ) : (
              <div className="text-xs text-slate-500">暂无故障转移记录</div>
            )}
          </div>
        </section>

        <section className="bg-slate-900/50 border border-slate-800/70 rounded-xl p-4">
          <h2 className="text-sm font-medium mb-3">自动重试候选</h2>
          <div className="space-y-2">
            {queue?.retries?.length ? (
              queue.retries.map((item) => (
                <div key={item.task_id} className="p-2 bg-slate-800/50 rounded border border-slate-700/50 text-xs">
                  <div className="font-mono text-slate-300">{item.task_id}</div>
                  <div className="text-slate-500 mt-1">重试: {item.retry_count}/{item.max_retries}</div>
                  <div className="text-slate-500">退出码: {item.last_exit_code ?? "-"}</div>
                </div>
              ))
            ) : (
              <div className="text-xs text-slate-500">暂无可重试任务</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-slate-900/50 border border-slate-800/70 rounded-xl p-4">
      <div className="text-[11px] text-slate-500 uppercase">{label}</div>
      <div className="text-2xl font-semibold mt-2">{value}</div>
    </div>
  );
}
