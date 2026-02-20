"use client";

import { useState } from "react";
import { Engine } from "@/lib/types";

interface TaskCreateFormProps {
  onSubmit: (task: {
    title: string;
    description: string;
    engine: Engine;
    plan_mode: boolean;
  }) => void;
}

export default function TaskCreateForm({ onSubmit }: TaskCreateFormProps) {
  const [text, setText] = useState("");
  const [engine, setEngine] = useState<Engine>("auto");
  const [planMode, setPlanMode] = useState(false);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // First line is title, rest is description
    const lines = trimmed.split("\n");
    const title = lines[0];
    const description = lines.slice(1).join("\n").trim();

    onSubmit({
      title,
      description: description || title,
      engine,
      plan_mode: planMode,
    });
    setText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800/50 rounded-lg p-4">
      <div className="flex gap-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="添加新任务... (Cmd/Ctrl+Enter 提交)"
          rows={2}
          className="flex-1 bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
        />
        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg transition-colors self-end"
        >
          添加
        </button>
      </div>

      <div className="flex items-center gap-4 mt-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={planMode}
            onChange={(e) => setPlanMode(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 text-purple-500 focus:ring-purple-500/20"
          />
          <span className="text-xs text-slate-400">Plan 模式</span>
        </label>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">引擎:</span>
          {(["auto", "claude", "codex"] as Engine[]).map((eng) => (
            <button
              key={eng}
              onClick={() => setEngine(eng)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                engine === eng
                  ? eng === "claude"
                    ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                    : eng === "codex"
                      ? "bg-green-500/20 text-green-400 border border-green-500/30"
                      : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "bg-slate-800/50 text-slate-500 border border-slate-700/30 hover:text-slate-300"
              }`}
            >
              {eng === "auto" ? "Auto" : eng === "claude" ? "Claude" : "Codex"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
