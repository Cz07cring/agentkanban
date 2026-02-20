import { EventRecord, Task, TaskAttempt, TaskTimelineEntry, TasksData, Worker } from "./types";

const API_BASE = "/api";

function toQuery(params?: Record<string, string | undefined>): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined && val !== "") sp.set(key, val);
  });
  const q = sp.toString();
  return q ? `?${q}` : "";
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
  }
  return res.json();
}

// WebSocket connects directly to backend (Next.js rewrites don't proxy WS)
function getWsUrl(): string {
  if (typeof window === "undefined") return "";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host =
    process.env.NODE_ENV === "development"
      ? `${window.location.hostname}:8000`
      : window.location.host;
  return `${protocol}//${host}/ws/tasks`;
}

export async function fetchTasks(params?: {
  status?: string;
  engine?: string;
  priority?: string;
  q?: string;
}): Promise<TasksData> {
  return apiFetch<TasksData>(`${API_BASE}/tasks${toQuery(params)}`);
}

export async function fetchTask(taskId: string): Promise<Task> {
  return apiFetch<Task>(`${API_BASE}/tasks/${taskId}`);
}

export async function createTask(input: {
  title: string;
  description: string;
  engine: string;
  plan_mode: boolean;
  priority?: "high" | "medium" | "low";
}): Promise<Task> {
  return apiFetch<Task>(`${API_BASE}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateTask(
  taskId: string,
  updates: Record<string, unknown>
): Promise<Task> {
  return apiFetch<Task>(`${API_BASE}/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

export async function deleteTask(taskId: string): Promise<void> {
  await apiFetch<{ deleted: string }>(`${API_BASE}/tasks/${taskId}`, {
    method: "DELETE",
  });
}

export async function fetchTaskTimeline(taskId: string): Promise<{
  task_id: string;
  timeline: TaskTimelineEntry[];
}> {
  return apiFetch(`${API_BASE}/tasks/${taskId}/timeline`);
}

export async function fetchTaskAttempts(taskId: string): Promise<{
  task_id: string;
  attempts: TaskAttempt[];
}> {
  return apiFetch(`${API_BASE}/tasks/${taskId}/attempts`);
}

export async function fetchWorkers(): Promise<{ workers: Worker[] }> {
  return apiFetch(`${API_BASE}/workers`);
}

export async function fetchHealth(): Promise<{
  status: string;
  engines: Record<string, boolean>;
  worker_exec_mode?: string;
}> {
  return apiFetch(`${API_BASE}/health`);
}

export async function fetchDispatchQueue(): Promise<{
  summary: Record<string, number>;
  total: number;
  blocked: { task_id: string; reason?: string; depends_on: string[] }[];
  fallback: { task_id: string; fallback_reason: string; routed_engine: string }[];
  retries: { task_id: string; retry_count: number; max_retries: number; last_exit_code: number | null }[];
  engines: Record<string, boolean>;
}> {
  return apiFetch(`${API_BASE}/dispatcher/queue`);
}

export async function dispatchTask(taskId: string): Promise<Task> {
  return apiFetch(`${API_BASE}/tasks/${taskId}/dispatch`, { method: "POST" });
}

export async function triggerReview(taskId: string): Promise<Task> {
  return apiFetch(`${API_BASE}/tasks/${taskId}/review`, { method: "POST" });
}

export async function approvePlan(
  taskId: string,
  approved: boolean,
  feedback?: string
): Promise<{ task: Task; sub_tasks: Task[] }> {
  return apiFetch(`${API_BASE}/tasks/${taskId}/approve-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved, feedback }),
  });
}

export async function decomposeTask(
  taskId: string,
  subTasks: {
    title: string;
    description?: string;
    task_type?: string;
    engine?: string;
    priority?: string;
  }[]
): Promise<{ parent: Task; sub_tasks: Task[] }> {
  return apiFetch(`${API_BASE}/tasks/${taskId}/decompose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sub_tasks: subTasks }),
  });
}

export async function retryTask(taskId: string): Promise<Task> {
  return apiFetch(`${API_BASE}/tasks/${taskId}/retry`, {
    method: "POST",
  });
}

export async function claimTask(taskId: string, workerId: string): Promise<{ task: Task; lease_id: string }> {
  return apiFetch(`${API_BASE}/tasks/${taskId}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worker_id: workerId }),
  });
}

export async function heartbeatTask(taskId: string, workerId: string, leaseId?: string): Promise<{ ok: boolean }> {
  return apiFetch(`${API_BASE}/tasks/${taskId}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worker_id: workerId, lease_id: leaseId }),
  });
}

export async function completeTask(
  taskId: string,
  input: { worker_id: string; lease_id?: string; commit_ids?: string[]; summary?: string }
): Promise<Task> {
  return apiFetch(`${API_BASE}/tasks/${taskId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function failTask(
  taskId: string,
  input: { worker_id: string; lease_id?: string; error_log: string; exit_code?: number }
): Promise<Task> {
  return apiFetch(`${API_BASE}/tasks/${taskId}/fail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function fetchStats(): Promise<{
  total_tasks: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  by_engine: Record<string, number>;
  by_priority: Record<string, number>;
  engines: Record<
    string,
    {
      healthy: boolean;
      workers_total: number;
      workers_busy: number;
      workers_idle: number;
      total_completed?: number;
    }
  >;
  meta: Record<string, unknown>;
}> {
  return apiFetch(`${API_BASE}/stats`);
}

export async function fetchEnginesHealth(): Promise<{
  engines: Record<
    string,
    {
      healthy: boolean;
      workers_total: number;
      workers_busy: number;
      workers_idle?: number;
      total_completed?: number;
    }
  >;
}> {
  return apiFetch(`${API_BASE}/engines/health`);
}

export async function setEngineHealth(engine: "claude" | "codex", healthy: boolean): Promise<{ engine: string; healthy: boolean }> {
  return apiFetch(`${API_BASE}/engines/${engine}/health`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ healthy }),
  });
}

// --- Dispatcher control ---
export interface DispatchStatus {
  enabled: boolean;
  last_cycle_at: string | null;
  cycle_count: number;
  interval_sec: number;
  auto_retry_delay_sec: number;
  worker_cooldown_sec: number;
}

export async function fetchDispatchStatus(): Promise<DispatchStatus> {
  return apiFetch<DispatchStatus>(`${API_BASE}/dispatcher/status`);
}

export async function toggleDispatcher(): Promise<{ enabled: boolean }> {
  return apiFetch(`${API_BASE}/dispatcher/toggle`, { method: "POST" });
}

export async function triggerDispatch(): Promise<{ triggered: boolean; cycle_count: number }> {
  return apiFetch(`${API_BASE}/dispatcher/trigger`, { method: "POST" });
}

export async function fetchWorkerLogs(workerId: string): Promise<{ worker_id: string; logs: { at: string; line: string }[] }> {
  return apiFetch(`${API_BASE}/workers/${workerId}/logs`);
}

export async function fetchEvents(params?: { level?: string; task_id?: string }): Promise<{ events: EventRecord[] }> {
  return apiFetch(`${API_BASE}/events${toQuery(params)}`);
}

export async function ackEvent(eventId: string, by = "user"): Promise<EventRecord> {
  return apiFetch(`${API_BASE}/events/${eventId}/ack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ by }),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createWebSocket(onMessage: (data: any) => void): WebSocket {
  const ws = new WebSocket(getWsUrl());

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch {
      // ignore non-JSON messages
    }
  };

  let pingInterval: ReturnType<typeof setInterval>;
  ws.onopen = () => {
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send("ping");
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);
  };

  ws.onclose = () => {
    clearInterval(pingInterval);
  };

  return ws;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createRealtimeChannel(onMessage: (data: any) => void, onState?: (connected: boolean) => void): {
  close: () => void;
} {
  let ws: WebSocket | null = null;
  let stopped = false;
  let retryMs = 1000;

  const connect = () => {
    if (stopped) return;
    ws = new WebSocket(getWsUrl());

    ws.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data));
      } catch {
        // ignore non-JSON messages
      }
    };

    let pingInterval: ReturnType<typeof setInterval>;
    ws.onopen = () => {
      retryMs = 1000;
      onState?.(true);
      pingInterval = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send("ping");
        } else {
          clearInterval(pingInterval);
        }
      }, 30000);
    };

    ws.onclose = () => {
      clearInterval(pingInterval);
      onState?.(false);
      if (stopped) return;
      const wait = retryMs;
      retryMs = Math.min(retryMs * 2, 15000);
      setTimeout(connect, wait);
    };
  };

  connect();

  return {
    close: () => {
      stopped = true;
      ws?.close();
      ws = null;
    },
  };
}
