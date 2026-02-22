"use client";

import { useEffect, useState } from "react";
import { fetchEnginesHealth, mapApiError } from "@/lib/api";

interface EngineStats {
  healthy: boolean;
  workers_total: number;
  workers_busy: number;
  workers_idle?: number;
  total_completed?: number;
}

export default function EngineStatus() {
  const [engines, setEngines] = useState<Record<string, EngineStats> | null>(null);
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchEnginesHealth();
        setEngines(data.engines);
        setFallbackMessage(null);
      } catch (error) {
        const mapped = mapApiError(error, "状态暂不可用");
        setFallbackMessage(mapped.message || "状态暂不可用");
      }
    };
    void load();
    const interval = setInterval(() => void load(), 30000);
    return () => clearInterval(interval);
  }, []);

  if (!engines) {
    return (
      <div className="text-xs text-slate-500">
        {fallbackMessage || "状态暂不可用"}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {Object.entries(engines).map(([name, stats]) => (
        <div key={name} className="flex items-center gap-1.5">
          <div
            className={`w-2 h-2 rounded-full ${
              stats.healthy ? "bg-emerald-400" : "bg-red-400"
            }`}
          />
          <span className="text-xs text-slate-400 capitalize">{name}</span>
          <span className="text-[10px] text-slate-500">
            {stats.workers_busy}/{stats.workers_total}
          </span>
        </div>
      ))}
    </div>
  );
}
