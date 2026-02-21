"use client";

import { useCallback, useEffect, useState } from "react";
import { Project } from "@/lib/types";
import { fetchProjects, createProject, updateProject, deleteProject } from "@/lib/api";
import { useProjectContext } from "@/lib/project-context";

export default function ProjectsPage() {
  const { refreshProjects, setActiveProjectId } = useProjectContext();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [desc, setDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const load = useCallback(async () => {
    try {
      const { projects: list } = await fetchProjects();
      setProjects(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!name.trim() || !repoPath.trim()) return;
    setCreating(true);
    setError("");
    try {
      await createProject({ name: name.trim(), description: desc.trim(), repo_path: repoPath.trim() });
      await load();
      await refreshProjects();
      setShowCreate(false);
      setName("");
      setRepoPath("");
      setDesc("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除此项目？")) return;
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
      <div className="p-6">
        <div className="text-slate-400 text-sm">加载中...</div>
      </div>
    );
  }

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-100">项目管理</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg text-white transition-colors"
        >
          {showCreate ? "取消" : "+ 新建项目"}
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 p-4 bg-slate-800/60 border border-slate-700/50 rounded-lg space-y-3">
          <h2 className="text-sm font-medium text-slate-200">新建项目</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="项目名称"
              className="px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded-lg text-slate-200 placeholder-slate-500"
            />
            <input
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              placeholder="Git 仓库绝对路径"
              className="px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded-lg text-slate-200 placeholder-slate-500"
            />
          </div>
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="描述 (可选)"
            className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded-lg text-slate-200 placeholder-slate-500"
          />
          {error && <div className="text-xs text-red-400">{error}</div>}
          <button
            onClick={handleCreate}
            disabled={creating || !name.trim() || !repoPath.trim()}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-white transition-colors"
          >
            {creating ? "创建中..." : "创建项目"}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((proj) => (
          <div
            key={proj.id}
            className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-4 space-y-3"
          >
            {editId === proj.id ? (
              <div className="space-y-2">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200"
                />
                <input
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleUpdate(proj.id)}
                    className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded text-white transition-colors"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => setEditId(null)}
                    className="px-3 py-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-slate-200">{proj.name}</h3>
                    <div className="text-[10px] text-slate-500 mt-0.5">{proj.id}</div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        setActiveProjectId(proj.id);
                      }}
                      className="px-2 py-1 text-[10px] bg-blue-500/20 text-blue-300 rounded hover:bg-blue-500/30 transition-colors"
                    >
                      切换
                    </button>
                    <button
                      onClick={() => {
                        setEditId(proj.id);
                        setEditName(proj.name);
                        setEditDesc(proj.description);
                      }}
                      className="px-2 py-1 text-[10px] bg-slate-700/60 text-slate-300 rounded hover:bg-slate-700 transition-colors"
                    >
                      编辑
                    </button>
                    {proj.id !== "proj-default" && (
                      <button
                        onClick={() => handleDelete(proj.id)}
                        className="px-2 py-1 text-[10px] bg-red-500/20 text-red-300 rounded hover:bg-red-500/30 transition-colors"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </div>
                {proj.description && (
                  <div className="text-xs text-slate-400">{proj.description}</div>
                )}
                <div className="flex items-center gap-4 text-[10px] text-slate-500">
                  <span>{proj.task_count} 任务</span>
                  <span className="truncate" title={proj.repo_path}>
                    {proj.repo_path}
                  </span>
                </div>
                <div className="text-[10px] text-slate-600">
                  创建于 {new Date(proj.created_at).toLocaleDateString("zh-CN")}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {projects.length === 0 && (
        <div className="text-center py-12 text-slate-500 text-sm">
          暂无项目，点击上方按钮创建
        </div>
      )}
    </div>
  );
}
