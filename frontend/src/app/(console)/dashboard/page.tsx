"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EventRecord, Task } from "@/lib/types";
import {
  DispatchStatus,
  fetchDispatchStatus,
  fetchEvents,
  fetchStats,
  fetchTasks,
  toggleDispatcher,
  triggerDispatch,
} from "@/lib/api";
import { useProjectContext } from "@/lib/project-context";
import { TASK_STATUS_LABELS } from "@/lib/i18n-zh";
import { EVENT_LEVEL_BADGE_CLASSES, STATUS_DOT_CLASSES } from "@/lib/ui-tokens";

export default function DashboardPage() {
  const { activeProjectId } = useProjectContext();
  const [stats, setStats] = useState<Awaited<ReturnType<typeof fetchStats>> | null>(null);
  const [recentTasks, setRecentTasks] = useState<Task[]>([]);
  const [alerts, setAlerts] = useState<EventRecord[]>([]);
  const [dispatch, setDispatch] = useState<DispatchStatus | null>(null);

  useEffect(() => {
    const pid = activeProjectId;
    const load = async () => {
      const [statsData, tasksData, eventsData, dispatchData] = await Promise.all([
        fetchStats(pid),
        fetchTasks(undefined, pid),
        fetchEvents(undefined, pid),
        fetchDispatchStatus().catch(() => null),
      ]);
      setStats(statsData);
      setRecentTasks(tasksData.tasks.slice(0, 8));
      setAlerts(eventsData.events.filter((e) => ["warning", "error", "critical"].includes(e.level)).slice(0, 6));
      setDispatch(dispatchData);
    };
    load().catch(() => undefined);
    const timer = setInterval(() => load().catch(() => undefined), 10000);
    return () => clearInterval(timer);
  }, [activeProjectId]);

  const handleToggle = async () => {
    const result = await toggleDispatcher().catch(() => null);
    if (result) setDispatch((prev) => prev ? { ...prev, enabled: result.enabled } : prev);
  };

  const handleTrigger = async () => {
    await triggerDispatch().catch(() => undefined);
  };

  const successRate = stats
    ? (stats.by_status?.completed ?? 0) + (stats.by_status?.failed ?? 0) > 0
      ? Math.round(
          ((stats.by_status?.completed ?? 0) /
            ((stats.by_status?.completed ?? 0) + (stats.by_status?.failed ?? 0))) *
            100
        )
      : 0
    : 0;

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold">总览</h1>
          <p className="text-sm text-slate-400 mt-1">自动调度、执行与审计总览</p>
        </div>
        <Link href="/tasks" className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors">
          进入看板
        </Link>
      </header>

      {/* Top stats row */}
      <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Card label="总任务" value={stats?.total_tasks ?? 0} />
        <Card label="待执行" value={stats?.by_status?.pending ?? 0} />
        <Card label="进行中" value={stats?.by_status?.in_progress ?? 0} accent="text-blue-400" />
        <Card label="已完成" value={stats?.by_status?.completed ?? 0} accent="text-emerald-400" />
        <Card label="失败" value={stats?.by_status?.failed ?? 0} accent={stats?.by_status?.failed ? "text-red-400" : undefined} />
        <Card label="成功率" value={successRate} suffix="%" accent="text-emerald-400" />
      </section>

      {/* Engine + Dispatcher row */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <EngineCard
          name="Claude"
          stats={stats?.engines?.claude}
          dotColor="bg-orange-400"
          textColor="text-orange-400"
          taskCount={stats?.by_engine?.claude ?? 0}
        />
        <EngineCard
          name="Codex"
          stats={stats?.engines?.codex}
          dotColor="bg-green-400"
          textColor="text-green-400"
          taskCount={stats?.by_engine?.codex ?? 0}
        />
        <div className="bg-slate-900/50 border border-slate-800/70 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">调度器</h3>
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${dispatch?.enabled ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
              <span className="text-xs text-slate-400">{dispatch?.enabled ? "运行中" : "已暂停"}</span>
            </div>
          </div>
          <div className="space-y-1.5 text-xs text-slate-500">
            <div className="flex justify-between">
              <span>调度周期</span>
              <span className="text-slate-300">{dispatch?.interval_sec ?? "-"}s</span>
            </div>
            <div className="flex justify-between">
              <span>已执行轮次</span>
              <span className="text-slate-300">{dispatch?.cycle_count ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span>上次调度</span>
              <span className="text-slate-300">
                {dispatch?.last_cycle_at ? new Date(dispatch.last_cycle_at).toLocaleTimeString("zh-CN") : "-"}
              </span>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleToggle}
              className={`flex-1 text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                dispatch?.enabled
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20"
                  : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
              }`}
            >
              {dispatch?.enabled ? "暂停" : "启动"}
            </button>
            <button
              onClick={handleTrigger}
              className="flex-1 text-xs px-2 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
            >
              立即调度
            </button>
          </div>
        </div>
      </section>

      {/* Recent tasks + Alerts */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900/50 border border-slate-800/70 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium">最近任务</h2>
            <Link href="/tasks" className="text-[11px] text-slate-500 hover:text-slate-300">查看全部</Link>
          </div>
          <div className="space-y-1.5">
            {recentTasks.map((task) => (
              <Link key={task.id} href={`/tasks/${task.id}`} className="flex items-center gap-3 p-2 rounded-lg bg-slate-800/40 hover:bg-slate-800/70 transition-colors">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT_CLASSES[task.status] || "bg-slate-600"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-200 truncate">{task.title}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {task.id} · {TASK_STATUS_LABELS[task.status] || task.status}
                    {task.routed_engine && task.routed_engine !== "auto" ? ` · ${task.routed_engine}` : ""}
                  </div>
                </div>
              </Link>
            ))}
            {!recentTasks.length && <div className="text-xs text-slate-500 py-4 text-center">暂无任务</div>}
          </div>
        </div>

        <div className="bg-slate-900/50 border border-slate-800/70 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium">最近告警</h2>
            <Link href="/events" className="text-[11px] text-slate-500 hover:text-slate-300">查看全部</Link>
          </div>
          <div className="space-y-1.5">
            {alerts.length === 0 && <div className="text-xs text-slate-500 py-4 text-center">暂无告警</div>}
            {alerts.map((event) => (
              <div key={event.id} className="p-2 rounded-lg bg-slate-800/40 border border-slate-700/30">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${EVENT_LEVEL_BADGE_CLASSES[event.level]}`}>
                    {event.level}
                  </span>
                  <span className="text-[10px] text-slate-500">{new Date(event.created_at).toLocaleString("zh-CN")}</span>
                </div>
                <div className="text-sm text-slate-200 mt-1">{event.message}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Card({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: number;
  suffix?: string;
  accent?: string;
}) {
  return (
    <div className="bg-slate-900/50 border border-slate-800/70 rounded-xl p-4">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-semibold mt-1.5 ${accent || "text-slate-100"}`}>
        {value}{suffix || ""}
      </div>
    </div>
  );
}

function EngineCard({
  name,
  stats,
  dotColor,
  textColor,
  taskCount,
}: {
  name: string;
  stats?: { healthy: boolean; workers_total: number; workers_busy: number; workers_idle?: number; total_completed?: number };
  dotColor: string;
  textColor: string;
  taskCount: number;
}) {
  const healthy = stats?.healthy ?? false;
  return (
    <div className="bg-slate-900/50 border border-slate-800/70 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
          <h3 className={`text-sm font-medium ${textColor}`}>{name}</h3>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded ${
          healthy ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
        }`}>
          {healthy ? "正常" : "异常"}
        </span>
      </div>
      <div className="space-y-1.5 text-xs text-slate-500">
        <div className="flex justify-between">
          <span>Worker</span>
          <span className="text-slate-300">
            {stats?.workers_busy ?? 0}/{stats?.workers_total ?? 0} 活跃
          </span>
        </div>
        <div className="flex justify-between">
          <span>累计任务</span>
          <span className="text-slate-300">{taskCount}</span>
        </div>
        <div className="flex justify-between">
          <span>已完成</span>
          <span className="text-slate-300">{stats?.total_completed ?? 0}</span>
        </div>
      </div>
    </div>
  );
}
