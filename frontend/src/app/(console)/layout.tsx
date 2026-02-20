import { ReactNode } from "react";
import AppShell from "@/components/AppShell";

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
