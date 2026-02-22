"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { Project } from "./types";
import { fetchProjects } from "./api";

interface ProjectContextValue {
  projects: Project[];
  activeProjectId: string;
  activeProject: Project | null;
  setActiveProjectId: (id: string) => void;
  refreshProjects: () => Promise<void>;
  loading: boolean;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const STORAGE_KEY = "agent-kanban-project-id";

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState<string>("proj-default");
  const [loading, setLoading] = useState(true);

  const setActiveProjectId = useCallback((id: string) => {
    setActiveProjectIdState(id);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, id);
    }
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const { projects: list } = await fetchProjects();
      setProjects(list);
    } catch {
      // ignore fetch errors on initial load
    }
  }, []);

  useEffect(() => {
    // Restore from localStorage
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setActiveProjectIdState(stored);
      }
    }

    refreshProjects().finally(() => setLoading(false));
  }, [refreshProjects]);

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  return (
    <ProjectContext.Provider
      value={{
        projects,
        activeProjectId,
        activeProject,
        setActiveProjectId,
        refreshProjects,
        loading,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProjectContext must be used within ProjectProvider");
  }
  return ctx;
}
