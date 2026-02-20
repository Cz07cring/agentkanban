"use client";

import { useEffect, useState } from "react";
import { fetchEnginesHealth } from "@/lib/api";

interface EngineStats {
  healthy: boolean;
  workers_total: number;
  workers_busy: number;
  workers_idle?: number;
  total_completed?: number;
}

export default function EngineStatus() {
  const [engines, setEngines] = useState<Record<string, EngineStats> | null>(
    null
  );

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchEnginesHealth();
        setEngines(data.engines);
      } catch {
        // silently fail
      }
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  if (!engines) return null;

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
