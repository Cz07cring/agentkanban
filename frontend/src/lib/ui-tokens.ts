import { EventRecord, TaskStatus } from "@/lib/types";
import { TERMS } from "@/lib/i18n-zh";

export const STATUS_BADGE_CLASSES: Record<TaskStatus, string> = {
  pending: "bg-slate-500/20 text-slate-400",
  in_progress: "bg-blue-500/20 text-blue-400",
  plan_review: "bg-purple-500/20 text-purple-400",
  blocked_by_subtasks: "bg-indigo-500/20 text-indigo-400",
  reviewing: "bg-amber-500/20 text-amber-400",
  completed: "bg-emerald-500/20 text-emerald-400",
  failed: "bg-red-500/20 text-red-400",
  cancelled: "bg-gray-500/20 text-gray-400",
};

export const STATUS_DOT_CLASSES: Partial<Record<TaskStatus, string>> = {
  pending: "bg-slate-500",
  in_progress: "bg-blue-500 animate-pulse",
  plan_review: "bg-purple-500",
  blocked_by_subtasks: "bg-indigo-500",
  reviewing: "bg-amber-500",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  cancelled: "bg-gray-500",
};

export const PRIORITY_BADGE_CLASSES: Record<"high" | "medium" | "low", string> = {
  high: "bg-red-500/20 text-red-400 border-red-500/30",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

export const ENGINE_BADGES: Record<string, { badgeClass: string; label: string }> = {
  claude: { badgeClass: "bg-orange-500/20 text-orange-400", label: TERMS.claude },
  codex: { badgeClass: "bg-green-500/20 text-green-400", label: TERMS.codex },
  auto: { badgeClass: "bg-slate-500/20 text-slate-400", label: TERMS.auto },
};

export const REVIEW_SEVERITY_BADGE_CLASSES: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

export const EVENT_LEVEL_BADGE_CLASSES: Record<EventRecord["level"], string> = {
  critical: "bg-red-500/20 text-red-400",
  error: "bg-orange-500/20 text-orange-400",
  warning: "bg-amber-500/20 text-amber-400",
  info: "bg-slate-500/20 text-slate-400",
};

export const UI_CLASS_TOKENS = {
  radius: {
    sm: "rounded",
    md: "rounded-lg",
    lg: "rounded-xl",
  },
  spacing: {
    card: "p-4",
    section: "space-y-4",
    gapSm: "gap-2",
    gapMd: "gap-3",
  },
} as const;
