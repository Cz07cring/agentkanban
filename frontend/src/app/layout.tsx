import type { Metadata, Viewport } from "next";
import PushInit from "@/components/PushInit";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Kanban - AI 协同任务管理",
  description: "多 AI 引擎协同任务管理系统",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Agent Kanban",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="icon" href="/icons/icon-192.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
      </head>
      <body className="bg-slate-950 text-slate-100 antialiased">
        {children}
        <PushInit />
        <script
          id="sw-register"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}`
          }}
        />
      </body>
    </html>
  );
}
