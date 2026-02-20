import { Task, TasksData, Worker } from "./types";

const API_BASE = "/api";

export async function fetchTasks(): Promise<TasksData> {
  const res = await fetch(`${API_BASE}/tasks`);
  if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.status}`);
  return res.json();
}

export async function createTask(input: {
  title: string;
  description: string;
  engine: string;
  plan_mode: boolean;
}): Promise<Task> {
  const res = await fetch(`${API_BASE}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to create task: ${res.status}`);
  return res.json();
}

export async function updateTask(
  taskId: string,
  updates: Partial<Task>
): Promise<Task> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update task: ${res.status}`);
  return res.json();
}

export async function deleteTask(taskId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete task: ${res.status}`);
}

export async function fetchWorkers(): Promise<{ workers: Worker[] }> {
  const res = await fetch(`${API_BASE}/workers`);
  if (!res.ok) throw new Error(`Failed to fetch workers: ${res.status}`);
  return res.json();
}

export async function fetchHealth(): Promise<{
  status: string;
  engines: Record<string, boolean>;
}> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`Failed to fetch health: ${res.status}`);
  return res.json();
}

export function createWebSocket(onMessage: (data: any) => void): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws/tasks`);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch {
      // ignore non-JSON messages
    }
  };

  ws.onopen = () => {
    // Send ping every 30s to keep alive
    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send("ping");
      } else {
        clearInterval(interval);
      }
    }, 30000);
  };

  return ws;
}
