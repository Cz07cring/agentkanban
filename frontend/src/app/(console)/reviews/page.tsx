"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchTasks } from "@/lib/api";
import { useProjectContext } from "@/lib/project-context";
import { Task } from "@/lib/types";

export default function ReviewsPage() {
  const { activeProjectId } = useProjectContext();
  const [reviews, setReviews] = useState<Task[]>([]);

  useEffect(() => {
    const pid = activeProjectId;
    const load = async () => {
      const data = await fetchTasks(undefined, pid);
      setReviews(data.tasks.filter((t) => t.task_type === "review" || t.review_status));
    };

    load().catch(() => undefined);
    const timer = setInterval(() => load().catch(() => undefined), 5000);
    return () => clearInterval(timer);
  }, [activeProjectId]);

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Review 审计</h1>
      <p className="text-sm text-slate-400">对抗式 Review 轮次与问题分布</p>

      <div className="space-y-2">
        {reviews.map((task) => (
          <Link
            key={task.id}
            href={`/tasks/${task.id}`}
            className="block p-3 bg-slate-900/50 border border-slate-800/70 rounded-xl hover:bg-slate-900/70 transition-colors"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-slate-500 font-mono">{task.id}</div>
                <div className="text-sm text-slate-200 mt-1">{task.title}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-400">{task.status}</div>
                <div className="text-xs text-slate-500 mt-1">审查轮次: {task.review_round ?? 0}</div>
              </div>
            </div>
          </Link>
        ))}
        {!reviews.length && <div className="text-xs text-slate-500">暂无 Review 记录</div>}
      </div>
    </div>
  );
}
