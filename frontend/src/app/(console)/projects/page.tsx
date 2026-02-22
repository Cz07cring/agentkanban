"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Project } from "@/lib/types";
import {
  fetchProjects,
  createProject,
  updateProject,
  deleteProject,
  validateProjectRepo,
  generateProjectInitAssistant,
} from "@/lib/api";
import { useProjectContext } from "@/lib/project-context";
import VoiceInput from "@/components/VoiceInput";

type GoalMode = "speed" | "quality" | "balance";
type TimelineMode = "mvp_1w" | "stable_2w" | "full_4w";
type ScopeMode = "web" | "mobile" | "both";
type RiskMode = "low" | "medium" | "high";
type AutomationMode = "semi" | "full";
type ComplexityMode = "low" | "medium" | "high";
type SuccessMetricMode = "efficiency" | "quality" | "cost";

interface PlanOption {
  key: "A" | "B" | "C";
  title: string;
  summary: string;
  cycle: string;
  risk: string;
  acceptance: string[];
}

interface OptionEditState {
  title: string;
  summary: string;
  cycle: string;
  risk: string;
  acceptanceText: string;
}

interface AiQuestion {
  id: string;
  question: string;
  options: string[];
}

const DEMAND_TEMPLATES = [
  "做一个支持语音输入需求、自动生成 3 个可执行方案的项目启动页",
  "把现有看板升级为移动端优先，支持单列切换和关键操作悬浮入口",
  "增加从需求访谈到任务拆分的全链路自动化，包含验收标准和风险评估",
];

function buildPlanOptions(goal: GoalMode, timeline: TimelineMode, scope: ScopeMode): PlanOption[] {
  const scopeText = scope === "web" ? "Web" : scope === "mobile" ? "移动端" : "Web + 移动端";
  const fastCycle = timeline === "mvp_1w" ? "5~7天" : timeline === "stable_2w" ? "7~10天" : "10~14天";

  return [
    {
      key: "A",
      title: "方案A（快速落地）",
      summary: `先做 ${scopeText} 的最小可用闭环：需求输入 → AI 方案化 → 选择题确认 → 自动拆分执行。`,
      cycle: fastCycle,
      risk: "中",
      acceptance: [
        "用户可通过一句需求生成 2~3 个候选方案",
        "每个方案有验收标准与风险说明",
        "用户可在 3 分钟内完成选择并进入执行",
      ],
    },
    {
      key: "B",
      title: "方案B（稳态优先）",
      summary: `先把 ${scopeText} 的需求评审模板与交互问答做完整，再接入自动执行流水线。`,
      cycle: timeline === "mvp_1w" ? "7~10天" : "10~14天",
      risk: "低",
      acceptance: [
        "需求评审问答覆盖目标/边界/风险/验收",
        "方案对比支持 A/B/C 的结构化展示",
        "评审完成后自动生成执行文档草案",
      ],
    },
    {
      key: "C",
      title: "方案C（长期扩展）",
      summary: `按 ${scopeText} 一体化设计，增加方案评分矩阵与复盘能力，适合后续迭代扩展。`,
      cycle: timeline === "full_4w" ? "3~4周" : "2~3周",
      risk: goal === "speed" ? "高" : "中",
      acceptance: [
        "方案评分维度可配置（速度/风险/成本/可维护性）",
        "可沉淀历史方案与最终选择记录",
        "支持从评审包一键生成任务树",
      ],
    },
  ];
}

export default function ProjectsPage() {
  const { refreshProjects, setActiveProjectId } = useProjectContext();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [desc, setDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [repoCheck, setRepoCheck] = useState<{
    status: "idle" | "checking" | "ok" | "error";
    message?: string;
  }>({ status: "idle" });

  // Initial-stage requirement interview
  const [demand, setDemand] = useState("");
  const [selectedOption, setSelectedOption] = useState<"A" | "B" | "C">("A");
  const [aiQuestions, setAiQuestions] = useState<AiQuestion[]>([]);
  const [aiAnswers, setAiAnswers] = useState<Record<string, string>>({});
  const [aiSource, setAiSource] = useState("");
  const [generatingAi, setGeneratingAi] = useState(false);
  const [aiPlanOptions, setAiPlanOptions] = useState<PlanOption[]>([]);
  const [optionEdits, setOptionEdits] = useState<Record<"A" | "B" | "C", OptionEditState>>({
    A: { title: "", summary: "", cycle: "", risk: "", acceptanceText: "" },
    B: { title: "", summary: "", cycle: "", risk: "", acceptanceText: "" },
    C: { title: "", summary: "", cycle: "", risk: "", acceptanceText: "" },
  });
  const [extraContext, setExtraContext] = useState("");
  const [quickNote, setQuickNote] = useState("");
  const [showAdvancedEdit, setShowAdvancedEdit] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { projects: list } = await fetchProjects();
      setProjects(list);
      setListError("");
    } catch (err) {
      setProjects([]);
      setListError(err instanceof Error ? err.message : "加载项目失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const planOptions = useMemo(
    () => (aiPlanOptions.length > 0 ? aiPlanOptions : buildPlanOptions("balance", "stable_2w", "both")),
    [aiPlanOptions]
  );

  const effectivePlanOptions = useMemo(() => {
    return planOptions.map((opt) => {
      const edit = optionEdits[opt.key];
      const acceptance = (edit.acceptanceText || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      return {
        ...opt,
        title: edit.title.trim() || opt.title,
        summary: edit.summary.trim() || opt.summary,
        cycle: edit.cycle.trim() || opt.cycle,
        risk: edit.risk.trim() || opt.risk,
        acceptance: acceptance.length > 0 ? acceptance : opt.acceptance,
      };
    });
  }, [planOptions, optionEdits]);

  const selectedPlan = useMemo(
    () => effectivePlanOptions.find((opt) => opt.key === selectedOption) ?? effectivePlanOptions[0],
    [effectivePlanOptions, selectedOption]
  );

  useEffect(() => {
    setOptionEdits((prev) => {
      const next = { ...prev };
      for (const opt of planOptions) {
        if (!next[opt.key].acceptanceText) {
          next[opt.key] = {
            ...next[opt.key],
            acceptanceText: opt.acceptance.join("\n"),
          };
        }
      }
      return next;
    });
  }, [planOptions]);


  const handleDemandVoice = useCallback((transcript: string) => {
    setDemand((prev) => (prev ? `${prev} ${transcript}` : transcript));
  }, []);

  const handleQuickNoteVoice = useCallback((transcript: string) => {
    setQuickNote((prev) => (prev ? `${prev} ${transcript}` : transcript));
  }, []);

  const handleGenerateAi = useCallback(async () => {
    if (!demand.trim()) {
      setError("请先输入需求原文");
      return;
    }
    setGeneratingAi(true);
    setError("");
    try {
      const resp = await generateProjectInitAssistant(demand.trim());
      setAiQuestions((resp.questions ?? []).slice(0, 3));
      setAiPlanOptions((resp.options ?? []).slice(0, 3));
      setAiSource(resp.source || "ai_generated");
      setSelectedOption(resp.suggested_option || "A");
      setAiAnswers((prev) => {
        const next = { ...prev };
        for (const q of resp.questions ?? []) {
          if (!next[q.id] && q.options?.[0]) next[q.id] = q.options[0];
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 生成失败");
    } finally {
      setGeneratingAi(false);
    }
  }, [demand]);

  const generatedBrief = useMemo(() => {
    if (!demand.trim()) return "";

    return [
      "【项目启动评审包】",
      "",
      `需求原文：${demand.trim()}`,
      aiSource ? `生成方式：${aiSource}` : "生成方式：AI",
      "",
      "AI问答结果：",
      ...(aiQuestions.map((q) => `- ${q.question}：${aiAnswers[q.id] || "（未选择）"}`)),
      "",
      `候选实施方案：${selectedPlan?.title ?? "-"}`,
      `方案摘要：${selectedPlan?.summary ?? "-"}`,
      `预计周期：${selectedPlan?.cycle ?? "-"}`,
      "",
      "验收标准：",
      ...((selectedPlan?.acceptance ?? []).map((item, idx) => `${idx + 1}. ${item}`)),
      "",
      "补充说明：",
      desc.trim() || "（无）",
      quickNote.trim() ? `快速补充：${quickNote.trim()}` : "快速补充：（无）",
      "",
      "自然语言补充：",
      extraContext.trim() || "（无）",
    ].join("\n");
  }, [demand, aiSource, aiQuestions, aiAnswers, selectedPlan, desc, quickNote, extraContext]);

  const missingItems = useMemo(() => {
    const missing: string[] = [];
    if (!demand.trim()) missing.push("需求原文");
    if (planOptions.length < 2) missing.push("至少 2 个候选方案");
    if (!selectedPlan) missing.push("最终选择方案");
    if (!selectedPlan?.acceptance?.length) missing.push("方案验收标准");
    return missing;
  }, [demand, effectivePlanOptions, selectedPlan]);

  const canCreateProject = useMemo(() => {
    return !!name.trim() && !!repoPath.trim() && missingItems.length === 0;
  }, [name, repoPath, missingItems]);

  const createProgress = useMemo(() => {
    const basicsReady = !!name.trim() && !!repoPath.trim();
    const demandReady = !!demand.trim();
    const optionReady = !!selectedPlan && (selectedPlan.acceptance?.length ?? 0) > 0;
    const steps = [basicsReady, demandReady, optionReady];
    return {
      done: steps.filter(Boolean).length,
      total: steps.length,
      basicsReady,
      demandReady,
      optionReady,
    };
  }, [name, repoPath, demand, selectedPlan]);

  const initBrief = useMemo(() => {
    if (!demand.trim() || !selectedPlan) return null;
    return {
      raw_requirement: demand.trim(),
      clarification_answers: aiQuestions.map((q) => ({ question_id: q.id, answer: aiAnswers[q.id] || "" })),
      options: effectivePlanOptions.map((opt) => ({
        id: opt.key,
        title: opt.title,
        summary: opt.summary,
        timeline: opt.cycle,
        risk: opt.risk,
        acceptance_criteria: opt.acceptance,
      })),
      selected_option: selectedPlan.key,
      generated_brief_markdown: generatedBrief || desc.trim(),
      extra_context: [quickNote.trim(), extraContext.trim()].filter(Boolean).join("\n"),
    };
  }, [
    demand,
    aiQuestions,
    aiAnswers,
    effectivePlanOptions,
    selectedPlan,
    generatedBrief,
    desc,
    quickNote,
    extraContext,
  ]);
  const handleValidateRepo = async () => {
    if (!repoPath.trim()) {
      setRepoCheck({ status: "error", message: "请先填写仓库路径" });
      return;
    }

    setRepoCheck({ status: "checking", message: "验证中..." });
    try {
      const result = await validateProjectRepo(repoPath.trim());
      setRepoPath(result.repo_path);
      setRepoCheck({
        status: "ok",
        message: result.default_branch
          ? `仓库有效（当前分支: ${result.default_branch}）`
          : "仓库有效",
      });
    } catch (err) {
      setRepoCheck({
        status: "error",
        message: err instanceof Error ? err.message : "仓库验证失败",
      });
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !repoPath.trim()) return;
    setCreating(true);
    setError("");
    try {
      const created = await createProject({
        name: name.trim(),
        description: generatedBrief || desc.trim(),
        repo_path: repoPath.trim(),
        init_brief: initBrief ?? undefined,
      });
      await load();
      await refreshProjects();
      setActiveProjectId(created.id);
      setShowCreate(false);
      setName("");
      setRepoPath("");
      setDesc("");
      setDemand("");
      setSelectedOption("A");
      setAiQuestions([]);
      setAiAnswers({});
      setAiSource("");
      setAiPlanOptions([]);
      setRepoCheck({ status: "idle" });
      setOptionEdits({
        A: { title: "", summary: "", cycle: "", risk: "", acceptanceText: "" },
        B: { title: "", summary: "", cycle: "", risk: "", acceptanceText: "" },
        C: { title: "", summary: "", cycle: "", risk: "", acceptanceText: "" },
      });
      setExtraContext("");
      setQuickNote("");
      setShowAdvancedEdit(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, projectName: string) => {
    if (!confirm(`确定删除项目「${projectName}」？此操作会删除项目任务数据。`)) return;
    try {
      await deleteProject(id);
      await load();
      await refreshProjects();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    }
  };

  const handleUpdate = async (id: string) => {
    try {
      await updateProject(id, { name: editName, description: editDesc });
      setEditId(null);
      await load();
      await refreshProjects();
    } catch (err) {
      alert(err instanceof Error ? err.message : "更新失败");
    }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <div className="text-slate-400 text-sm">加载中...</div>
      </div>
    );
  }

  return (
    <div className="p-3 md:p-6 overflow-y-auto h-full pb-24 md:pb-6">
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <h1 className="text-lg md:text-xl font-semibold text-slate-100">项目管理</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="hidden md:inline-flex px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg text-white transition-colors"
        >
          {showCreate ? "取消" : "+ 新建项目"}
        </button>
      </div>

      {listError && !showCreate && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 flex items-center justify-between gap-3">
          <span>项目列表加载失败：{listError}</span>
          <button
            onClick={() => load().catch(() => undefined)}
            className="underline text-amber-100 hover:text-white"
          >
            重试
          </button>
        </div>
      )}

      {showCreate && (
        <div className="mb-5 p-3 md:p-4 bg-slate-800/60 border border-slate-700/50 rounded-lg space-y-4">
          <h2 className="text-sm font-medium text-slate-200">新建项目（需求访谈 + 方案选择）</h2>

          <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2.5 space-y-1">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-blue-200">创建进度</div>
              <div className="text-xs text-blue-300 font-medium">
                {createProgress.done}/{createProgress.total}
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-slate-700/70 overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${(createProgress.done / createProgress.total) * 100}%` }}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1 text-[11px]">
              <div className={`${createProgress.basicsReady ? "text-emerald-300" : "text-slate-400"}`}>
                {createProgress.basicsReady ? "✓" : "○"} 基础信息
              </div>
              <div className={`${createProgress.demandReady ? "text-emerald-300" : "text-slate-400"}`}>
                {createProgress.demandReady ? "✓" : "○"} 需求输入
              </div>
              <div className={`${createProgress.optionReady ? "text-emerald-300" : "text-slate-400"}`}>
                {createProgress.optionReady ? "✓" : "○"} 方案确认
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="space-y-1">
              <div className="text-xs text-slate-400">项目名称</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：Agent 需求访谈中台"
                className="w-full px-3 py-2.5 text-sm bg-slate-900 border border-slate-600 rounded-lg text-slate-200 placeholder-slate-500"
              />
            </label>
            <div className="flex gap-2">
              <label className="flex-1 space-y-1">
                <div className="text-xs text-slate-400">仓库路径</div>
                <input
                  value={repoPath}
                  onChange={(e) => {
                    setRepoPath(e.target.value);
                    if (repoCheck.status !== "idle") setRepoCheck({ status: "idle" });
                  }}
                  placeholder="Git 仓库绝对路径"
                  className="w-full px-3 py-2.5 text-sm bg-slate-900 border border-slate-600 rounded-lg text-slate-200 placeholder-slate-500"
                />
              </label>
              <button
                onClick={handleValidateRepo}
                className="self-end px-3 py-2.5 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-200 transition-colors min-w-16"
                disabled={repoCheck.status === "checking"}
              >
                {repoCheck.status === "checking" ? "验证中" : "验证"}
              </button>
            </div>
          </div>

          {repoCheck.status !== "idle" && (
            <div
              className={`text-xs ${
                repoCheck.status === "ok"
                  ? "text-emerald-400"
                  : repoCheck.status === "error"
                    ? "text-red-400"
                    : "text-slate-400"
              }`}
            >
              {repoCheck.message}
            </div>
          )}

          <div className="p-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5 space-y-3">
            <div className="text-xs font-medium text-indigo-300">第一步：输入需求并由 AI 生成问题与方案</div>
            <div className="space-y-2">
              <textarea
                value={demand}
                onChange={(e) => setDemand(e.target.value)}
                rows={2}
                placeholder="请输入一句需求（支持语音输入）"
                className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded-lg text-slate-200 placeholder-slate-500"
              />
              <div className="flex flex-wrap gap-2">
                {DEMAND_TEMPLATES.map((tpl, idx) => (
                  <button
                    key={tpl}
                    onClick={() => setDemand(tpl)}
                    className="text-[11px] px-2 py-1 rounded border border-slate-600/80 text-slate-300 hover:text-slate-100 hover:border-slate-500"
                  >
                    模板 {idx + 1}
                  </button>
                ))}
              </div>
              <div className="rounded-md border border-slate-700/60 bg-slate-900/50 p-2 space-y-1">
                <div className="text-[11px] text-slate-300">语音输入区（先说后看，自动转文字可编辑）</div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <VoiceInput onTranscript={handleDemandVoice} buttonLabel="语音输入需求" />
                  <span>语音结束后会自动转成文字填入上方输入框，你可以继续编辑确认。</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleGenerateAi}
                disabled={generatingAi || !demand.trim()}
                className="px-3 py-2 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-white"
              >
                {generatingAi ? "AI 生成中..." : "AI 生成问题与方案"}
              </button>
              {aiSource && <span className="text-[11px] text-indigo-300">来源：{aiSource}</span>}
            </div>

            {aiQuestions.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-slate-400">AI 生成问题（你可以直接选择）：</div>
                {aiQuestions.map((q) => (
                  <div key={q.id} className="space-y-1">
                    <div className="text-xs text-slate-300">{q.question}</div>
                    <div className="flex flex-wrap gap-2">
                      {q.options.map((op) => (
                        <button
                          key={op}
                          onClick={() => setAiAnswers((prev) => ({ ...prev, [q.id]: op }))}
                          className={`px-2.5 py-1 text-xs rounded border ${
                            aiAnswers[q.id] === op
                              ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                              : "bg-slate-800/50 text-slate-400 border-slate-700"
                          }`}
                        >
                          {op}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-300">第二步：选择 AI 生成的候选实施方案</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {effectivePlanOptions.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setSelectedOption(opt.key)}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    selectedOption === opt.key
                      ? "border-emerald-500/50 bg-emerald-500/10"
                      : "border-slate-700 bg-slate-900/50"
                  }`}
                >
                  <div className="text-xs font-medium text-slate-200">{opt.title}</div>
                  <div className="mt-1 text-[11px] text-slate-400">{opt.summary}</div>
                  <div className="mt-2 text-[10px] text-slate-500">周期：{opt.cycle}｜风险：{opt.risk}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-300">第三步：自动生成启动文档（可编辑）</div>
            <textarea
              value={generatedBrief || desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-300"
            />
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}

          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-300">快速补充（可选，建议一句话）</div>
            <input
              value={quickNote}
              onChange={(e) => setQuickNote(e.target.value)}
              placeholder="例如：首版先确保移动端 3 步完成需求提交"
              className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-300"
            />
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <VoiceInput onTranscript={handleQuickNoteVoice} buttonLabel="语音补充" />
              <span>可用语音快速补充一句话</span>
            </div>
          </div>

          <div className="space-y-2">
            <button
              onClick={() => setShowAdvancedEdit((v) => !v)}
              className="text-xs text-indigo-300 hover:text-indigo-200"
            >
              {showAdvancedEdit ? "收起高级编辑" : "展开高级编辑（仅在 AI 方案不满足时使用）"}
            </button>

            {showAdvancedEdit && (
              <div className="space-y-2 border border-slate-700 rounded-lg p-3 bg-slate-900/40">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    value={optionEdits[selectedOption].title}
                    onChange={(e) => setOptionEdits((prev) => ({ ...prev, [selectedOption]: { ...prev[selectedOption], title: e.target.value } }))}
                    placeholder="自定义方案标题（可选）"
                    className="px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-300"
                  />
                  <input
                    value={optionEdits[selectedOption].cycle}
                    onChange={(e) => setOptionEdits((prev) => ({ ...prev, [selectedOption]: { ...prev[selectedOption], cycle: e.target.value } }))}
                    placeholder="自定义周期（可选）"
                    className="px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-300"
                  />
                </div>
                <textarea
                  value={optionEdits[selectedOption].summary}
                  onChange={(e) => setOptionEdits((prev) => ({ ...prev, [selectedOption]: { ...prev[selectedOption], summary: e.target.value } }))}
                  rows={2}
                  placeholder="自定义方案摘要（支持自然语言）"
                  className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-300"
                />
                <textarea
                  value={optionEdits[selectedOption].acceptanceText}
                  onChange={(e) => setOptionEdits((prev) => ({ ...prev, [selectedOption]: { ...prev[selectedOption], acceptanceText: e.target.value } }))}
                  rows={3}
                  placeholder="验收标准（每行一条）"
                  className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-300"
                />
                <textarea
                  value={extraContext}
                  onChange={(e) => setExtraContext(e.target.value)}
                  rows={2}
                  placeholder="额外自然语言补充（可选）"
                  className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-300"
                />
              </div>
            )}
          </div>

          {missingItems.length > 0 && (
            <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              创建前仍需补齐：{missingItems.join("、")}
            </div>
          )}

          <div className="flex flex-col-reverse md:flex-row gap-2">
            <button
              onClick={() => setShowCreate(false)}
              className="md:hidden px-4 py-2.5 text-sm bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-200 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !canCreateProject}
              className="px-4 py-2.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white transition-colors"
              title={!canCreateProject ? `请先补齐：${missingItems.join("、") || "基础信息"}` : ""}
            >
              {creating ? "创建中..." : "创建项目并切换"}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
        {projects.map((proj) => (
          <div
            key={proj.id}
            className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-3 md:p-4 space-y-3"
          >
            {editId === proj.id ? (
              <div className="space-y-2">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-2 py-2 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200"
                />
                <input
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full px-2 py-2 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleUpdate(proj.id)}
                    className="px-3 py-2 text-xs bg-blue-600 hover:bg-blue-500 rounded text-white transition-colors"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => setEditId(null)}
                    className="px-3 py-2 text-xs text-slate-300 bg-slate-700/60 hover:bg-slate-700 rounded transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-slate-200 truncate">{proj.name}</h3>
                    <div className="text-[10px] text-slate-500 mt-0.5">{proj.id}</div>
                  </div>
                </div>

                {proj.description && (
                  <div className="text-xs text-slate-400 ">{proj.description}</div>
                )}

                <div className="flex items-center gap-3 text-[10px] text-slate-500">
                  <span>{proj.task_count} 任务</span>
                  <span className="truncate" title={proj.repo_path}>
                    {proj.repo_path}
                  </span>
                </div>
                <div className="text-[10px] text-slate-600">
                  创建于 {new Date(proj.created_at).toLocaleDateString("zh-CN")}
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <button
                    onClick={() => {
                      setActiveProjectId(proj.id);
                    }}
                    className="px-2 py-2 text-[11px] bg-blue-500/20 text-blue-300 rounded hover:bg-blue-500/30 transition-colors"
                  >
                    切换
                  </button>
                  <button
                    onClick={() => {
                      setEditId(proj.id);
                      setEditName(proj.name);
                      setEditDesc(proj.description);
                    }}
                    className="px-2 py-2 text-[11px] bg-slate-700/60 text-slate-300 rounded hover:bg-slate-700 transition-colors"
                  >
                    编辑
                  </button>
                  {proj.id !== "proj-default" ? (
                    <button
                      onClick={() => handleDelete(proj.id, proj.name)}
                      className="px-2 py-2 text-[11px] bg-red-500/20 text-red-300 rounded hover:bg-red-500/30 transition-colors"
                    >
                      删除
                    </button>
                  ) : (
                    <div className="px-2 py-2 text-[11px] text-slate-500 text-center">默认项目</div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {projects.length === 0 && (
        <div className="text-center py-12 text-slate-500 text-sm">
          暂无项目，点击下方按钮创建
        </div>
      )}

      <div className="md:hidden fixed left-3 right-3 bottom-4 z-30">
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium shadow-lg shadow-blue-900/30"
        >
          {showCreate ? "收起创建面板" : "+ 新建项目"}
        </button>
      </div>
    </div>
  );
}
