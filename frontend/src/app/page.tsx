"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Task, Worker, Engine } from "@/lib/types";
import { fetchTasks, fetchWorkers, createTask, createWebSocket } from "@/lib/api";
import KanbanBoard from "@/components/KanbanBoard";
import TaskCreateForm from "@/components/TaskCreateForm";
import StatsBar from "@/components/StatsBar";

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [tasksData, workersData] = await Promise.all([
        fetchTasks(),
        fetchWorkers(),
      ]);
      setTasks(tasksData.tasks);
      setWorkers(workersData.workers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // WebSocket for real-time updates
  useEffect(() => {
    const ws = createWebSocket((data) => {
      if (data.type === "task_created") {
        setTasks((prev) => [data.task, ...prev]);
      } else if (data.type === "task_updated") {
        setTasks((prev) =>
          prev.map((t) => (t.id === data.task.id ? data.task : t))
        );
      } else if (data.type === "task_deleted") {
        setTasks((prev) => prev.filter((t) => t.id !== data.task_id));
      }
    });

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, []);

  const handleCreateTask = useCallback(
    async (input: {
      title: string;
      description: string;
      engine: Engine;
      plan_mode: boolean;
    }) => {
      try {
        const newTask = await createTask(input);
        // Add optimistically (WebSocket might also deliver it)
        setTasks((prev) => {
          if (prev.some((t) => t.id === newTask.id)) return prev;
          return [newTask, ...prev];
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create task");
      }
    },
    []
  );

  const handleExpandTask = useCallback((task: Task) => {
    console.log("Expand task:", task.id);
  }, []);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-400">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col p-4 gap-4">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-slate-100">
            AI 协同任务管理中心
          </h1>
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
        <StatsBar tasks={tasks} workers={workers} />
      </header>

      {/* Error banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 flex items-center justify-between">
          <span className="text-sm text-red-400">{error}</span>
          <button
            onClick={() => {
              setError(null);
              loadData();
            }}
            className="text-xs text-red-400 hover:text-red-300 underline"
          >
            重试
          </button>
        </div>
      )}

      {/* Task Create Form */}
      <TaskCreateForm onSubmit={handleCreateTask} />

      {/* Kanban Board */}
      <KanbanBoard tasks={tasks} onExpandTask={handleExpandTask} />
    </div>
  );
}
