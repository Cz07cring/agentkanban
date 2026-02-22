"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Engine, Task, TaskStatus, Worker } from "@/lib/types";
import {
  approvePlan,
  createRealtimeChannel,
  createTask,
  deleteTask,
  dispatchTask,
  fetchTasks,
  fetchWorkers,
  retryTask,
  triggerReview,
  updateTask,
} from "@/lib/api";
import { useProjectContext } from "@/lib/project-context";
import KanbanBoard from "@/components/KanbanBoard";
import StatsBar from "@/components/StatsBar";
import TaskCreateForm from "@/components/TaskCreateForm";
import TaskDetailPanel from "@/components/TaskDetailPanel";

export default function TasksPage() {
  const { activeProjectId } = useProjectContext();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [engineFilter, setEngineFilter] = useState<Engine | "all">("all");
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const createFormRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    try {
      const [tasksData, workersData] = await Promise.all([
        fetchTasks(undefined, activeProjectId),
        fetchWorkers(),
      ]);
      setTasks(tasksData.tasks);
      setWorkers(workersData.workers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载数据失败");
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  useEffect(() => {
    const channel = createRealtimeChannel(
      (data) => {
        if (data.type === "task_created") {
          setTasks((prev) => {
            if (prev.some((t) => t.id === data.task.id)) return prev;
            return [data.task, ...prev];
          });
        } else if (data.type === "task_updated") {
          setTasks((prev) => prev.map((t) => (t.id === data.task.id ? data.task : t)));
          setSelectedTask((prev) => (prev && prev.id === data.task.id ? data.task : prev));
        } else if (data.type === "task_deleted") {
          setTasks((prev) => prev.filter((t) => t.id !== data.task_id));
          setSelectedTask((prev) => (prev && prev.id === data.task_id ? null : prev));
        } else if (data.type === "worker_updated") {
          setWorkers((prev) => prev.map((w) => (w.id === data.worker.id ? data.worker : w)));
        }
      },
      (isConnected) => setConnected(isConnected)
    );

    return () => channel.close();
  }, []);

  const handleCreateTask = useCallback(
    async (input: {
      title: string;
      description: string;
      engine: Engine;
      plan_mode: boolean;
    }) => {
      try {
        const newTask = await createTask(input, activeProjectId);
        setTasks((prev) => (prev.some((t) => t.id === newTask.id) ? prev : [newTask, ...prev]));
      } catch (err) {
        setError(err instanceof Error ? err.message : "创建任务失败");
      }
    },
    [activeProjectId]
  );

  const handleUpdateStatus = useCallback(async (taskId: string, status: TaskStatus) => {
    try {
      const updated = await updateTask(taskId, { status }, activeProjectId);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      setSelectedTask((prev) => (prev && prev.id === taskId ? updated : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新任务失败");
    }
  }, [activeProjectId]);

  const handleDeleteTask = useCallback(async (taskId: string) => {
    try {
      await deleteTask(taskId, activeProjectId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setSelectedTask(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除任务失败");
    }
  }, [activeProjectId]);

  const handleApprovePlan = useCallback(
    async (taskId: string, approved: boolean, feedback?: string) => {
      try {
        const result = await approvePlan(taskId, approved, feedback);
        const updated = result.task;
        setTasks((prev) => {
          let next = prev.map((t) => (t.id === taskId ? updated : t));
          for (const sub of result.sub_tasks || []) {
            if (!next.some((t) => t.id === sub.id)) next = [sub, ...next];
          }
          return next;
        });
        setSelectedTask((prev) => (prev && prev.id === taskId ? updated : prev));
      } catch (err) {
        setError(err instanceof Error ? err.message : "审批计划失败");
      }
    },
    []
  );

  const handleRetry = useCallback(async (taskId: string) => {
    try {
      const updated = await retryTask(taskId);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      setSelectedTask((prev) => (prev && prev.id === taskId ? updated : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "重试任务失败");
    }
  }, []);

  const handleDispatch = useCallback(async (taskId: string) => {
    try {
      const updated = await dispatchTask(taskId);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      setSelectedTask((prev) => (prev && prev.id === taskId ? updated : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "分配任务失败");
    }
  }, []);

  const handleTriggerReview = useCallback(async (taskId: string) => {
    try {
      const reviewTask = await triggerReview(taskId);
      setTasks((prev) => (prev.some((t) => t.id === reviewTask.id) ? prev : [reviewTask, ...prev]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "触发审查失败");
    }
  }, []);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (statusFilter !== "all" && task.status !== statusFilter) return false;
      if (engineFilter !== "all" && task.engine !== engineFilter) return false;
      if (onlyMine && !task.assigned_worker) return false;
      if (onlyFailed && task.status !== "failed") return false;
      return true;
    });
  }, [tasks, statusFilter, engineFilter, onlyMine, onlyFailed]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-y-auto relative">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">任务看板</h1>
          <span
            className={`text-xs px-2 py-0.5 rounded border ${
              connected
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-amber-500/10 text-amber-400 border-amber-500/20"
            }`}
          >
            {connected ? "在线" : "离线"}
          </span>
        </div>
        <div className="hidden md:block">
          <StatsBar tasks={filteredTasks} workers={workers} />
        </div>
      </header>

      <div className="md:hidden sticky top-0 z-20 bg-slate-950/95 border border-slate-800/70 rounded-lg p-3 backdrop-blur-sm space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "all")}
            className="touch-target bg-slate-900 border border-slate-700/70 rounded-md px-2 py-1.5 text-xs"
          >
            <option value="all">全部状态</option>
            <option value="pending">待开发</option>
            <option value="in_progress">开发中</option>
            <option value="plan_review">待审批</option>
            <option value="blocked_by_subtasks">子任务中</option>
            <option value="reviewing">待 Review</option>
            <option value="completed">已完成</option>
            <option value="failed">失败</option>
            <option value="cancelled">已取消</option>
          </select>

          <select
            value={engineFilter}
            onChange={(e) => setEngineFilter(e.target.value as Engine | "all")}
            className="touch-target bg-slate-900 border border-slate-700/70 rounded-md px-2 py-1.5 text-xs"
          >
            <option value="all">全部引擎</option>
            <option value="auto">Auto</option>
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setOnlyMine((v) => !v)}
            className={`touch-target flex-1 text-xs rounded-md border px-2 py-1.5 ${
              onlyMine
                ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                : "bg-slate-900 text-slate-400 border-slate-700/70"
            }`}
          >
            仅显示我的
          </button>
          <button
            onClick={() => {
              const next = !onlyFailed;
              setOnlyFailed(next);
              if (next) setStatusFilter("all");
            }}
            className={`touch-target flex-1 text-xs rounded-md border px-2 py-1.5 ${
              onlyFailed
                ? "bg-red-500/20 text-red-300 border-red-500/40"
                : "bg-slate-900 text-slate-400 border-slate-700/70"
            }`}
          >
            仅失败任务
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 flex items-center justify-between">
          <span className="text-sm text-red-400">{error}</span>
          <button
            onClick={() => {
              setError(null);
              loadData();
            }}
            className="touch-target text-xs text-red-400 hover:text-red-300 underline"
          >
            重试
          </button>
        </div>
      )}

      <div ref={createFormRef}>
        <TaskCreateForm onSubmit={handleCreateTask} />
      </div>
      <KanbanBoard tasks={filteredTasks} onExpandTask={setSelectedTask} />

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          allTasks={tasks}
          onClose={() => setSelectedTask(null)}
          onUpdateStatus={handleUpdateStatus}
          onDelete={handleDeleteTask}
          onApprovePlan={handleApprovePlan}
          onRetry={handleRetry}
          onDispatch={handleDispatch}
          onTriggerReview={handleTriggerReview}
        />
      )}

      <button
        onClick={() => createFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        className="md:hidden touch-target fixed bottom-4 right-4 z-30 rounded-full bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 text-sm font-medium shadow-lg"
      >
        + 新增任务
      </button>

      <div className="text-xs text-slate-500 pb-16 md:pb-0">
        深度审计视图可直接打开: <Link className="underline" href={selectedTask ? `/tasks/${selectedTask.id}` : "/tasks"}>{selectedTask ? selectedTask.id : "任务详情页"}</Link>
      </div>
    </div>
  );
}
