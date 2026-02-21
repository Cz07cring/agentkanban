"use client";

import { useState, useEffect } from "react";
import { Task, TaskStatus } from "@/lib/types";

const statusLabels: Record<TaskStatus, string> = {
  pending: "待开发",
  in_progress: "开发中",
  plan_review: "待审批",
  blocked_by_subtasks: "子任务中",
  reviewing: "待 Review",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const statusColors: Record<TaskStatus, string> = {
  pending: "bg-slate-500/20 text-slate-400",
  in_progress: "bg-blue-500/20 text-blue-400",
  plan_review: "bg-purple-500/20 text-purple-400",
  blocked_by_subtasks: "bg-indigo-500/20 text-indigo-400",
  reviewing: "bg-amber-500/20 text-amber-400",
  completed: "bg-emerald-500/20 text-emerald-400",
  failed: "bg-red-500/20 text-red-400",
  cancelled: "bg-gray-500/20 text-gray-400",
};

const engineBadge: Record<string, { bg: string; label: string }> = {
  claude: { bg: "bg-orange-500/20 text-orange-400", label: "Claude" },
  codex: { bg: "bg-green-500/20 text-green-400", label: "Codex" },
  auto: { bg: "bg-slate-500/20 text-slate-400", label: "Auto" },
};

const severityColors: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

// Valid status transitions
const statusTransitions: Record<TaskStatus, TaskStatus[]> = {
  pending: ["in_progress", "cancelled"],
  in_progress: ["reviewing", "completed", "failed", "cancelled"],
  plan_review: ["in_progress", "cancelled"],
  blocked_by_subtasks: [],
  reviewing: ["completed", "failed", "in_progress"],
  completed: [],
  failed: ["pending"],
  cancelled: ["pending"],
};

export default function TaskDetailPanel({
  task,
  allTasks,
  onClose,
  onUpdateStatus,
  onDelete,
  onApprovePlan,
  onRetry,
  onDispatch,
  onTriggerReview,
}: {
  task: Task;
  allTasks?: Task[];
  onClose: () => void;
  onUpdateStatus: (taskId: string, status: TaskStatus) => void;
  onDelete: (taskId: string) => void;
  onApprovePlan?: (taskId: string, approved: boolean, feedback?: string) => void;
  onRetry?: (taskId: string) => void;
  onDispatch?: (taskId: string) => void;
  onTriggerReview?: (taskId: string) => void;
}) {
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  const engine = task.routed_engine || task.engine;
  const badge = engineBadge[engine] || engineBadge.auto;
  const nextStatuses = statusTransitions[task.status] || [];

  const subTasks = allTasks?.filter((t) =>
    task.sub_tasks?.includes(t.id)
  ) || [];

  const reviewResult = task.review_result;
  const reviewIssues = reviewResult?.issues || [];

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`任务详情: ${task.title}`}
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        data-testid="task-detail"
        data-task-id={task.id}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 font-mono">
              #{task.id.replace("task-", "")}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded ${statusColors[task.status]}`}
            >
              {statusLabels[task.status]}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded ${badge.bg}`}>
              {badge.label}
            </span>
            {task.plan_mode && (
              <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400">
                Plan
              </span>
            )}
            {task.review_status && (
              <span className={`text-xs px-2 py-0.5 rounded ${
                task.review_status === "approved"
                  ? "bg-emerald-500/20 text-emerald-400"
                  : task.review_status === "changes_requested"
                    ? "bg-red-500/20 text-red-400"
                    : "bg-amber-500/20 text-amber-400"
              }`}>
                Review: {task.review_status === "approved" ? "通过" : task.review_status === "changes_requested" ? "需修改" : task.review_status}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="关闭对话框"
            className="text-slate-500 hover:text-slate-300 transition-colors text-lg leading-none"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              {task.title}
            </h2>
            <p className="mt-2 text-sm text-slate-400 whitespace-pre-wrap">
              {task.description}
            </p>
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-slate-500">优先级</span>
              <div className="mt-1 text-slate-300 capitalize">
                {task.priority === "high"
                  ? "高"
                  : task.priority === "medium"
                    ? "中"
                    : "低"}
              </div>
            </div>
            <div>
              <span className="text-slate-500">任务类型</span>
              <div className="mt-1 text-slate-300">{task.task_type}</div>
            </div>
            <div>
              <span className="text-slate-500">创建时间</span>
              <div className="mt-1 text-slate-300">
                {new Date(task.created_at).toLocaleString("zh-CN")}
              </div>
            </div>
            {task.started_at && (
              <div>
                <span className="text-slate-500">开始时间</span>
                <div className="mt-1 text-slate-300">
                  {new Date(task.started_at).toLocaleString("zh-CN")}
                </div>
              </div>
            )}
            {task.completed_at && (
              <div>
                <span className="text-slate-500">完成时间</span>
                <div className="mt-1 text-slate-300">
                  {new Date(task.completed_at).toLocaleString("zh-CN")}
                </div>
              </div>
            )}
            {task.assigned_worker && (
              <div>
                <span className="text-slate-500">分配 Worker</span>
                <div className="mt-1 text-slate-300">
                  {task.assigned_worker}
                </div>
              </div>
            )}
            {task.parent_task_id && (
              <div>
                <span className="text-slate-500">父任务</span>
                <div className="mt-1 text-slate-300 font-mono">
                  {task.parent_task_id}
                </div>
              </div>
            )}
          </div>

          {/* Plan approval section */}
          {task.status === "plan_review" && onApprovePlan && (
            <div className="p-3 bg-purple-500/5 border border-purple-500/20 rounded-lg space-y-3">
              <div className="text-xs font-medium text-purple-400">Plan 审批</div>
              {!task.plan_content && (
                <div className="flex items-center gap-2 p-2 bg-slate-800/50 rounded text-xs text-slate-400">
                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  AI 正在分析代码库并生成计划…
                </div>
              )}
              {task.plan_content && (
                <div className="p-2 bg-slate-800/50 rounded text-xs text-slate-300 whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {task.plan_content}
                </div>
              )}
              {!showRejectInput ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => onApprovePlan(task.id, true)}
                    className="text-xs px-4 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors"
                  >
                    批准执行
                  </button>
                  <button
                    onClick={() => setShowRejectInput(true)}
                    className="text-xs px-4 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
                  >
                    驳回
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea
                    value={rejectFeedback}
                    onChange={(e) => setRejectFeedback(e.target.value)}
                    placeholder="请输入驳回原因..."
                    rows={2}
                    className="w-full bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-red-500/50"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        onApprovePlan(task.id, false, rejectFeedback);
                        setShowRejectInput(false);
                        setRejectFeedback("");
                      }}
                      className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
                    >
                      确认驳回
                    </button>
                    <button
                      onClick={() => {
                        setShowRejectInput(false);
                        setRejectFeedback("");
                      }}
                      className="text-xs px-3 py-1.5 rounded-lg bg-slate-700/50 text-slate-400 hover:text-slate-300 transition-colors"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Plan content (non-review state) */}
          {task.plan_content && task.status !== "plan_review" && (
            <div>
              <span className="text-xs text-slate-500">开发计划</span>
              <div className="mt-1 p-3 bg-slate-800/50 border border-slate-700/50 rounded-lg text-xs text-slate-300 whitespace-pre-wrap max-h-40 overflow-y-auto">
                {task.plan_content}
              </div>
            </div>
          )}

          {/* Review result */}
          {reviewResult && (
            <div>
              <span className="text-xs text-amber-400">Review 结果</span>
              {reviewResult.summary && (
                <div className="mt-1 p-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-xs text-slate-300">
                  {reviewResult.summary}
                </div>
              )}
              {reviewIssues.length > 0 && (
                <div className="mt-2 space-y-2">
                  <div className="flex gap-2 text-[10px]">
                    <span className="text-red-400">
                      严重: {reviewIssues.filter(i => i.severity === "critical").length}
                    </span>
                    <span className="text-orange-400">
                      高: {reviewIssues.filter(i => i.severity === "high").length}
                    </span>
                    <span className="text-amber-400">
                      中: {reviewIssues.filter(i => i.severity === "medium").length}
                    </span>
                    <span className="text-slate-400">
                      低: {reviewIssues.filter(i => i.severity === "low").length}
                    </span>
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {reviewIssues.map((issue, idx) => (
                      <div
                        key={idx}
                        className={`p-2 rounded border text-xs ${severityColors[issue.severity] || severityColors.low}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] opacity-70">
                            {issue.file}:{issue.line}
                          </span>
                          <span className="uppercase text-[10px] font-medium">
                            {issue.severity}
                          </span>
                        </div>
                        <div className="mt-1 text-slate-300">{issue.description}</div>
                        {issue.suggestion && (
                          <div className="mt-1 text-slate-500 italic">
                            {issue.suggestion}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sub-tasks */}
          {subTasks.length > 0 && (
            <div>
              <span className="text-xs text-slate-500">
                子任务 ({subTasks.length})
              </span>
              <div className="mt-1 space-y-1">
                {subTasks.map((sub) => (
                  <div
                    key={sub.id}
                    className="flex items-center gap-2 p-2 bg-slate-800/50 border border-slate-700/50 rounded text-xs"
                  >
                    <span className="text-slate-500 font-mono">{sub.id}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${statusColors[sub.status]}`}>
                      {statusLabels[sub.status]}
                    </span>
                    <span className="text-slate-300 flex-1 truncate">{sub.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Plan questions */}
          {task.plan_questions && task.plan_questions.length > 0 && (
            <div>
              <span className="text-xs text-slate-500">Plan 澄清问题</span>
              <div className="mt-1 space-y-2">
                {task.plan_questions.map((q, idx) => (
                  <div
                    key={`${task.id}-plan-q-${idx}`}
                    className="p-2 bg-slate-800/50 border border-slate-700/50 rounded-lg"
                  >
                    <div className="text-xs text-slate-200">{q.question}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {q.options.map((opt, optIdx) => (
                        <span
                          key={`${task.id}-plan-q-${idx}-opt-${optIdx}`}
                          className={`text-[10px] px-2 py-0.5 rounded border ${
                            q.selected === optIdx
                              ? "border-blue-500/50 text-blue-300 bg-blue-500/10"
                              : "border-slate-700/50 text-slate-500"
                          }`}
                        >
                          {opt}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Commit IDs */}
          {task.commit_ids.length > 0 && (
            <div>
              <span className="text-xs text-slate-500">Commits</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {task.commit_ids.map((id) => (
                  <span
                    key={id}
                    className="text-xs px-2 py-0.5 bg-slate-800 rounded font-mono text-slate-400"
                  >
                    {id}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Error log */}
          {task.error_log && (
            <div>
              <span className="text-xs text-red-400">错误日志</span>
              <div className="mt-1 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-300 whitespace-pre-wrap">
                {task.error_log}
              </div>
            </div>
          )}

          {/* Retry info */}
          {task.retry_count > 0 && (
            <div className="text-xs text-slate-500">
              重试次数: {task.retry_count}/{task.max_retries}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-slate-800 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex gap-2 flex-wrap">
            {nextStatuses.map((status) => (
              <button
                key={status}
                onClick={() => onUpdateStatus(task.id, status)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${statusColors[status]} border-current/20 hover:opacity-80`}
              >
                {statusLabels[status]}
              </button>
            ))}

            {/* Dispatch button */}
            {task.status === "pending" && onDispatch && (
              <button
                onClick={() => onDispatch(task.id)}
                className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-colors"
              >
                分配 Worker
              </button>
            )}

            {/* Trigger Review button */}
            {task.status === "completed" && !task.review_status && onTriggerReview && (
              <button
                onClick={() => onTriggerReview(task.id)}
                className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
              >
                触发 Review
              </button>
            )}

            {/* Retry button */}
            {task.status === "failed" && task.retry_count < task.max_retries && onRetry && (
              <button
                onClick={() => onRetry(task.id)}
                className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
              >
                重试
              </button>
            )}
          </div>

          {task.status !== "completed" && task.status !== "in_progress" && (
            <button
              onClick={() => {
                if (confirm("确定要删除这个任务吗？")) {
                  onDelete(task.id);
                }
              }}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
            >
              删除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
