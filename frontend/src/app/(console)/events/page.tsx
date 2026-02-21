"use client";

import { useEffect, useState } from "react";
import { ackEvent, fetchEvents } from "@/lib/api";
import { useProjectContext } from "@/lib/project-context";
import { EventRecord } from "@/lib/types";

export default function EventsPage() {
  const { activeProjectId } = useProjectContext();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [filter, setFilter] = useState<string>("");

  useEffect(() => {
    const pid = activeProjectId;
    const load = async () => {
      const data = await fetchEvents(filter ? { level: filter } : undefined, pid);
      setEvents(data.events);
    };
    load().catch(() => undefined);
    const timer = setInterval(() => load().catch(() => undefined), 5000);
    return () => clearInterval(timer);
  }, [filter, activeProjectId]);

  const handleAck = async (eventId: string) => {
    const updated = await ackEvent(eventId);
    setEvents((prev) => prev.map((e) => (e.id === eventId ? updated : e)));
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">事件日志</h1>
          <p className="text-sm text-slate-400">执行事件与告警确认</p>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-sm"
        >
          <option value="">全部级别</option>
          <option value="info">信息</option>
          <option value="warning">警告</option>
          <option value="error">错误</option>
          <option value="critical">严重</option>
        </select>
      </div>

      <div className="space-y-2">
        {events.map((event) => (
          <div key={event.id} className="p-3 bg-slate-900/50 border border-slate-800/70 rounded-xl">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs text-slate-500">{new Date(event.created_at).toLocaleString("zh-CN")}</div>
                <div className="text-sm text-slate-200 mt-1">{event.message}</div>
                <div className="text-xs text-slate-500 mt-1">{event.type} {event.task_id ? `· ${event.task_id}` : ""}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-1 rounded ${
                  event.level === "critical"
                    ? "bg-red-500/20 text-red-400"
                    : event.level === "error"
                      ? "bg-orange-500/20 text-orange-400"
                      : event.level === "warning"
                        ? "bg-amber-500/20 text-amber-400"
                        : "bg-slate-500/20 text-slate-400"
                }`}>
                  {event.level}
                </span>
                {!event.acknowledged ? (
                  <button
                    onClick={() => handleAck(event.id).catch(() => undefined)}
                    className="text-xs px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  >
                    确认
                  </button>
                ) : (
                  <span className="text-xs text-slate-500">已确认</span>
                )}
              </div>
            </div>
          </div>
        ))}
        {!events.length && <div className="text-xs text-slate-500">暂无事件</div>}
      </div>
    </div>
  );
}
