"use client";

import { useMemo, useState } from "react";
import { Engine } from "@/lib/types";
import VoiceInput from "./VoiceInput";

interface TaskCreateFormProps {
  onSubmit: (task: {
    title: string;
    description: string;
    engine: Engine;
    plan_mode: boolean;
    risk_level: "low" | "medium" | "high";
    sla_tier: "standard" | "expedite" | "urgent";
    acceptance_criteria: string[];
    rollback_plan: string;
  }) => void;
}

export default function TaskCreateForm({ onSubmit }: TaskCreateFormProps) {
  const [text, setText] = useState("");
  const [engine, setEngine] = useState<Engine>("auto");
  const [planMode, setPlanMode] = useState(false);
  const [riskLevel, setRiskLevel] = useState<"low" | "medium" | "high">("medium");
  const [slaTier, setSlaTier] = useState<"standard" | "expedite" | "urgent">("standard");
  const [acceptanceText, setAcceptanceText] = useState("");
  const [rollbackPlan, setRollbackPlan] = useState("");

  const dorMissing = useMemo(() => {
    if (!planMode) return false;
    return !acceptanceText.trim() || !rollbackPlan.trim();
  }, [acceptanceText, rollbackPlan, planMode]);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const lines = trimmed.split("\n");
    const title = lines[0];
    const description = lines.slice(1).join("\n").trim();

    const acceptanceCriteria = acceptanceText
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);

    onSubmit({
      title,
      description: description || title,
      engine,
      plan_mode: planMode,
      risk_level: riskLevel,
      sla_tier: slaTier,
      acceptance_criteria: acceptanceCriteria,
      rollback_plan: rollbackPlan.trim(),
    });
    setText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleVoiceTranscript = (transcript: string) => {
    setText((prev) => (prev ? prev + " " + transcript : transcript));
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800/50 rounded-lg p-4">
      <div className="flex gap-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="添加新任务... (Cmd/Ctrl+Enter 提交，或点击麦克风语音输入)"
          rows={2}
          className="flex-1 bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
        />
        <div className="flex flex-col gap-2 self-end">
          <button
            onClick={handleSubmit}
            disabled={!text.trim() || dorMissing}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            添加
          </button>
        </div>
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

        <div className="ml-auto">
          <VoiceInput onTranscript={handleVoiceTranscript} />
        </div>
      </div>

      {planMode && (
        <div className="mt-3 p-3 rounded-lg border border-purple-500/20 bg-purple-500/5 space-y-3">
          <div className="text-xs font-medium text-purple-300">Plan 执行门禁（DoR）</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400">风险等级</label>
              <select
                value={riskLevel}
                onChange={(e) => setRiskLevel(e.target.value as "low" | "medium" | "high")}
                className="mt-1 w-full bg-slate-800/50 border border-slate-700/50 rounded px-2 py-1.5 text-xs text-slate-200"
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400">SLA 级别</label>
              <select
                value={slaTier}
                onChange={(e) => setSlaTier(e.target.value as "standard" | "expedite" | "urgent")}
                className="mt-1 w-full bg-slate-800/50 border border-slate-700/50 rounded px-2 py-1.5 text-xs text-slate-200"
              >
                <option value="standard">standard</option>
                <option value="expedite">expedite</option>
                <option value="urgent">urgent</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400">验收标准（每行一条）</label>
            <textarea
              value={acceptanceText}
              onChange={(e) => setAcceptanceText(e.target.value)}
              rows={2}
              placeholder="例如：接口返回 200；关键路径有自动化测试"
              className="mt-1 w-full bg-slate-800/50 border border-slate-700/50 rounded px-3 py-2 text-xs text-slate-200 placeholder-slate-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400">回滚方案</label>
            <textarea
              value={rollbackPlan}
              onChange={(e) => setRollbackPlan(e.target.value)}
              rows={2}
              placeholder="例如：回退到上一个稳定提交并重新部署"
              className="mt-1 w-full bg-slate-800/50 border border-slate-700/50 rounded px-3 py-2 text-xs text-slate-200 placeholder-slate-500"
            />
          </div>

          {dorMissing && (
            <div className="text-xs text-amber-400">Plan 模式下请填写验收标准和回滚方案，否则后端不会通过审批/调度。</div>
          )}
        </div>
      )}
    </div>
  );
}
