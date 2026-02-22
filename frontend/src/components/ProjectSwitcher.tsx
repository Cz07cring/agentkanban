"use client";

import { KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { useProjectContext } from "@/lib/project-context";
import { createProject } from "@/lib/api";

export default function ProjectSwitcher() {
  const { projects, activeProjectId, activeProject, setActiveProjectId, refreshProjects } =
    useProjectContext();
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [desc, setDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  useEffect(() => {
    if (!open) {
      setHighlightedIndex(-1);
      return;
    }

    const activeIndex = projects.findIndex((proj) => proj.id === activeProjectId);
    setHighlightedIndex(activeIndex >= 0 ? activeIndex : 0);
  }, [open, projects, activeProjectId]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);


  const selectProjectAt = useCallback(
    (index: number) => {
      const project = projects[index];
      if (!project) return;
      setActiveProjectId(project.id);
      setOpen(false);
    },
    [projects, setActiveProjectId],
  );

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }

      const delta = event.key === "ArrowDown" ? 1 : -1;
      const total = projects.length || 1;
      setHighlightedIndex((prev) => {
        const start = prev < 0 ? 0 : prev;
        return (start + delta + total) % total;
      });
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      selectProjectAt(highlightedIndex >= 0 ? highlightedIndex : 0);
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
    }
  };

  const handleListboxKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const total = projects.length || 1;
      setHighlightedIndex((prev) => {
        const start = prev < 0 ? 0 : prev;
        return (start + delta + total) % total;
      });
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const focusedOption = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-option-index]");
      const focusedIndex = focusedOption ? Number(focusedOption.dataset.optionIndex) : -1;
      selectProjectAt(focusedIndex >= 0 ? focusedIndex : highlightedIndex >= 0 ? highlightedIndex : 0);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  const handleCreate = useCallback(async () => {
    if (!name.trim() || !repoPath.trim()) return;
    setCreating(true);
    setError("");
    try {
      const proj = await createProject({
        name: name.trim(),
        description: desc.trim(),
        repo_path: repoPath.trim(),
      });
      await refreshProjects();
      setActiveProjectId(proj.id);
      setShowCreate(false);
      setOpen(false);
      setName("");
      setRepoPath("");
      setDesc("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }, [name, repoPath, desc, refreshProjects, setActiveProjectId]);

  return (
    <div ref={ref} className="relative mb-4">
      <button
        onClick={() => setOpen(!open)}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 transition-colors"
      >
        <span className="truncate text-slate-200">
          {activeProject?.name ?? "选择项目"}
        </span>
        <svg
          className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-slate-800 border border-slate-700/50 rounded-lg shadow-xl overflow-hidden">
          <div
            id={listboxId}
            role="listbox"
            tabIndex={0}
            aria-activedescendant={highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined}
            onKeyDown={handleListboxKeyDown}
            className="max-h-60 overflow-y-auto outline-none"
          >
            {projects.map((proj, index) => {
              const isSelected = proj.id === activeProjectId;
              const isActive = index === highlightedIndex;

              return (
              <button
                id={`${listboxId}-option-${index}`}
                data-option-index={index}
                role="option"
                aria-selected={isSelected}
                key={proj.id}
                onFocus={() => setHighlightedIndex(index)}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => selectProjectAt(index)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  isSelected
                    ? "bg-blue-500/15 text-blue-300"
                    : isActive
                      ? "bg-slate-700/70 text-slate-200"
                      : "text-slate-300 hover:bg-slate-700/60"
                }`}
              >
                <div className="font-medium truncate">{proj.name}</div>
                <div className="text-[10px] text-slate-500 truncate">
                  {proj.task_count} 任务 · {proj.repo_path.split("/").pop()}
                </div>
              </button>
            );
            })}
          </div>

          <div className="border-t border-slate-700/50">
            {!showCreate ? (
              <button
                onClick={() => setShowCreate(true)}
                className="w-full px-3 py-2 text-sm text-blue-400 hover:bg-slate-700/60 transition-colors text-left"
              >
                + 新建项目
              </button>
            ) : (
              <div className="p-3 space-y-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="项目名称"
                  className="w-full px-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200 placeholder-slate-500"
                />
                <input
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder="仓库路径 (绝对路径)"
                  className="w-full px-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200 placeholder-slate-500"
                />
                <input
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="描述 (可选)"
                  className="w-full px-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200 placeholder-slate-500"
                />
                {error && <div className="text-xs text-red-400">{error}</div>}
                <div className="flex gap-2">
                  <button
                    onClick={handleCreate}
                    disabled={creating || !name.trim() || !repoPath.trim()}
                    className="flex-1 px-2 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-white transition-colors"
                  >
                    {creating ? "创建中..." : "创建"}
                  </button>
                  <button
                    onClick={() => {
                      setShowCreate(false);
                      setError("");
                    }}
                    className="px-2 py-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
