import { ReactNode } from "react";
import AppShell from "@/components/AppShell";
import { ProjectProvider } from "@/lib/project-context";

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <ProjectProvider>
      <AppShell>{children}</AppShell>
    </ProjectProvider>
  );
}
