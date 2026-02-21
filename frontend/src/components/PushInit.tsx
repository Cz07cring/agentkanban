"use client";

import { useEffect } from "react";
import { initPushNotifications } from "@/lib/api";

export default function PushInit() {
  useEffect(() => {
    // Delay so SW registration completes first
    const timer = setTimeout(() => {
      initPushNotifications().catch(() => undefined);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  return null;
}
