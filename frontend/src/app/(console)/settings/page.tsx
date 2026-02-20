"use client";

import { useEffect, useState } from "react";
import { fetchHealth, fetchEnginesHealth, setEngineHealth } from "@/lib/api";

export default function SettingsPage() {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof fetchHealth>> | null>(null);
  const [engines, setEngines] = useState<Awaited<ReturnType<typeof fetchEnginesHealth>> | null>(null);

  const load = async () => {
    const [healthData, engineData] = await Promise.all([fetchHealth(), fetchEnginesHealth()]);
    setHealth(healthData);
    setEngines(engineData);
  };

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  const toggleEngine = async (engine: "claude" | "codex", healthy: boolean) => {
    await setEngineHealth(engine, healthy);
    await load();
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">设置</h1>
      <p className="text-sm text-slate-400">运行策略与引擎可用性开关</p>

      <div className="bg-slate-900/50 border border-slate-800/70 rounded-xl p-4">
        <div className="text-sm text-slate-300">Worker 执行模式</div>
        <div className="text-xs text-slate-500 mt-1">{health?.worker_exec_mode || "unknown"}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(["claude", "codex"] as const).map((engine) => {
          const stat = engines?.engines?.[engine];
          const healthy = !!stat?.healthy;
          return (
            <div key={engine} className="bg-slate-900/50 border border-slate-800/70 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-base font-medium capitalize">{engine}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    {stat?.workers_busy ?? 0}/{stat?.workers_total ?? 0} 繁忙
                  </div>
                </div>
                <button
                  onClick={() => toggleEngine(engine, !healthy).catch(() => undefined)}
                  className={`text-xs px-3 py-1.5 rounded-lg border ${
                    healthy
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                      : "bg-red-500/20 text-red-300 border-red-500/30"
                  }`}
                >
                  {healthy ? "健康" : "已禁用"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
