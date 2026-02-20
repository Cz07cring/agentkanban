"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchTask, fetchTaskAttempts, fetchTaskTimeline } from "@/lib/api";
import { Task, TaskAttempt, TaskTimelineEntry } from "@/lib/types";

export default function TaskDetailPage() {
  const params = useParams<{ taskId: string }>();
  const taskId = params.taskId;
  const [task, setTask] = useState<Task | null>(null);
  const [timeline, setTimeline] = useState<TaskTimelineEntry[]>([]);
  const [attempts, setAttempts] = useState<TaskAttempt[]>([]);

  useEffect(() => {
    const load = async () => {
      const [taskData, timelineData, attemptsData] = await Promise.all([
        fetchTask(taskId),
        fetchTaskTimeline(taskId),
        fetchTaskAttempts(taskId),
      ]);
      setTask(taskData);
      setTimeline(timelineData.timeline || []);
      setAttempts(attemptsData.attempts || []);
    };

    load().catch(() => undefined);
    const timer = setInterval(() => load().catch(() => undefined), 4000);
    return () => clearInterval(timer);
  }, [taskId]);

  if (!task) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-slate-500">
        Loading task {taskId}...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{task.title}</h1>
          <div className="text-xs text-slate-500 mt-1">{task.id} · {task.status} · {task.routed_engine || task.engine}</div>
        </div>
        <Link href="/tasks" className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">
          返回看板
        </Link>
      </header>

      <section className="bg-slate-900/50 border border-slate-800/70 rounded-xl p-4">
        <h2 className="text-sm font-medium mb-2">任务信息</h2>
        <div className="text-sm text-slate-300 whitespace-pre-wrap">{task.description}</div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-slate-500">
          <div>priority: {task.priority}</div>
          <div>type: {task.task_type}</div>
          <div>worker: {task.assigned_worker || "-"}</div>
          <div>review_round: {task.review_round ?? 0}</div>
          <div>retry: {task.retry_count}/{task.max_retries}</div>
          <div>exit_code: {task.last_exit_code ?? "-"}</div>
          <div>blocked: {task.blocked_reason || "-"}</div>
          <div>fallback: {task.fallback_reason || "-"}</div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900/50 border border-slate-800/70 rounded-xl p-4">
          <h2 className="text-sm font-medium mb-3">状态时间线</h2>
          <div className="space-y-2">
            {timeline.map((item, idx) => (
              <div key={`${item.at}-${idx}`} className="p-2 bg-slate-800/50 border border-slate-700/50 rounded text-xs">
                <div className="text-slate-300">{item.event}</div>
                <div className="text-slate-500 mt-1">{new Date(item.at).toLocaleString("zh-CN")}</div>
                <pre className="text-[11px] text-slate-500 mt-1 whitespace-pre-wrap">{JSON.stringify(item.detail || {}, null, 2)}</pre>
              </div>
            ))}
            {!timeline.length && <div className="text-xs text-slate-500">暂无时间线</div>}
          </div>
        </div>

        <div className="bg-slate-900/50 border border-slate-800/70 rounded-xl p-4">
          <h2 className="text-sm font-medium mb-3">执行 Attempts</h2>
          <div className="space-y-2">
            {attempts.map((attempt) => (
              <div key={`${attempt.attempt}-${attempt.started_at}`} className="p-2 bg-slate-800/50 border border-slate-700/50 rounded text-xs">
                <div className="text-slate-300">attempt #{attempt.attempt} · {attempt.status}</div>
                <div className="text-slate-500 mt-1">worker: {attempt.worker_id} · engine: {attempt.engine}</div>
                <div className="text-slate-500">start: {new Date(attempt.started_at).toLocaleString("zh-CN")}</div>
                {attempt.completed_at && <div className="text-slate-500">end: {new Date(attempt.completed_at).toLocaleString("zh-CN")}</div>}
                <div className="text-slate-500">exit_code: {attempt.exit_code ?? "-"}</div>
                {!!attempt.error_log && (
                  <div className="mt-1 text-red-300 whitespace-pre-wrap">{attempt.error_log}</div>
                )}
                {!!attempt.commit_ids?.length && (
                  <div className="mt-1 text-slate-400 font-mono">commits: {attempt.commit_ids.join(", ")}</div>
                )}
              </div>
            ))}
            {!attempts.length && <div className="text-xs text-slate-500">暂无执行记录</div>}
          </div>
        </div>
      </section>
    </div>
  );
}
