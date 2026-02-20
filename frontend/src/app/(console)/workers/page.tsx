"use client";

import { useEffect, useState } from "react";
import WorkerDashboard from "@/components/WorkerDashboard";
import { fetchTasks, fetchWorkers } from "@/lib/api";
import { Task, Worker } from "@/lib/types";

export default function WorkersPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);

  useEffect(() => {
    const load = async () => {
      const [taskData, workerData] = await Promise.all([fetchTasks(), fetchWorkers()]);
      setTasks(taskData.tasks);
      setWorkers(workerData.workers);
    };

    load().catch(() => undefined);
    const timer = setInterval(() => load().catch(() => undefined), 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="h-full flex flex-col p-6 gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Worker 管理</h1>
        <p className="text-sm text-slate-400 mt-1">Worker 心跳、占用与失败趋势</p>
      </div>
      <WorkerDashboard workers={workers} tasks={tasks} />
    </div>
  );
}
