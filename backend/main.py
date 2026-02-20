"""Agent Kanban - Task Dispatcher (FastAPI Backend)"""
from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from filelock import FileLock
from pydantic import BaseModel, Field

# --- Config ---
DATA_DIR = Path(__file__).parent / "data"
TASKS_FILE = DATA_DIR / "dev-tasks.json"
LOCK_FILE = DATA_DIR / "dev-task.lock"

# --- Routing rules ---
ROUTING_RULES = [
    {"task_type": "feature", "keywords": ["开发", "实现", "新增", "添加", "创建", "implement", "add", "create"], "preferred_engine": "claude", "fallback_engine": "codex"},
    {"task_type": "review", "keywords": ["review", "审查", "检查", "code review", "PR review"], "preferred_engine": "codex", "fallback_engine": "claude"},
    {"task_type": "refactor", "keywords": ["重构", "优化", "refactor", "cleanup", "整理"], "preferred_engine": "codex", "fallback_engine": "claude"},
    {"task_type": "bugfix", "keywords": ["修复", "bug", "fix", "错误", "异常", "crash"], "preferred_engine": "claude", "fallback_engine": "codex"},
    {"task_type": "analysis", "keywords": ["分析", "审计", "analyze", "audit", "检测", "扫描"], "preferred_engine": "codex", "fallback_engine": "claude"},
    {"task_type": "plan", "keywords": ["计划", "拆解", "设计", "plan", "design", "架构"], "preferred_engine": "claude", "fallback_engine": "codex"},
]

# --- In-memory worker state ---
WORKERS = [
    {
        "id": "worker-0", "engine": "claude", "port": 5200,
        "worktree_path": "/app/worktrees/worker-0", "status": "idle",
        "capabilities": ["feature", "bugfix", "plan"],
        "current_task_id": None, "pid": None, "started_at": None,
        "total_tasks_completed": 42,
        "health": {"last_heartbeat": datetime.now(timezone.utc).isoformat(), "consecutive_failures": 0, "avg_task_duration_ms": 240000},
    },
    {
        "id": "worker-1", "engine": "claude", "port": 5201,
        "worktree_path": "/app/worktrees/worker-1", "status": "idle",
        "capabilities": ["feature", "bugfix", "plan"],
        "current_task_id": None, "pid": None, "started_at": None,
        "total_tasks_completed": 38,
        "health": {"last_heartbeat": datetime.now(timezone.utc).isoformat(), "consecutive_failures": 0, "avg_task_duration_ms": 200000},
    },
    {
        "id": "worker-2", "engine": "claude", "port": 5202,
        "worktree_path": "/app/worktrees/worker-2", "status": "idle",
        "capabilities": ["feature", "bugfix", "plan"],
        "current_task_id": None, "pid": None, "started_at": None,
        "total_tasks_completed": 35,
        "health": {"last_heartbeat": datetime.now(timezone.utc).isoformat(), "consecutive_failures": 0, "avg_task_duration_ms": 260000},
    },
    {
        "id": "worker-3", "engine": "codex", "port": 5203,
        "worktree_path": "/app/worktrees/worker-3", "status": "idle",
        "capabilities": ["review", "refactor", "analysis", "audit"],
        "current_task_id": None, "pid": None, "started_at": None,
        "total_tasks_completed": 28,
        "health": {"last_heartbeat": datetime.now(timezone.utc).isoformat(), "consecutive_failures": 0, "avg_task_duration_ms": 120000},
    },
    {
        "id": "worker-4", "engine": "codex", "port": 5204,
        "worktree_path": "/app/worktrees/worker-4", "status": "idle",
        "capabilities": ["review", "refactor", "analysis", "audit"],
        "current_task_id": None, "pid": None, "started_at": None,
        "total_tasks_completed": 25,
        "health": {"last_heartbeat": datetime.now(timezone.utc).isoformat(), "consecutive_failures": 0, "avg_task_duration_ms": 110000},
    },
]

ENGINE_HEALTH = {"claude": True, "codex": True}


# --- WebSocket connection manager ---
class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)

    async def broadcast(self, message: dict):
        for ws in list(self.active):
            try:
                await ws.send_json(message)
            except Exception:
                self.active.remove(ws)


ws_manager = ConnectionManager()


# --- File helpers ---
def read_tasks() -> dict:
    lock = FileLock(str(LOCK_FILE))
    with lock:
        return json.loads(TASKS_FILE.read_text(encoding="utf-8"))


def write_tasks(data: dict):
    lock = FileLock(str(LOCK_FILE))
    with lock:
        data["meta"]["last_updated"] = datetime.now(timezone.utc).isoformat()
        TASKS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def gen_task_id(data: dict) -> str:
    max_num = 0
    for t in data["tasks"]:
        try:
            num = int(t["id"].replace("task-", ""))
            if num > max_num:
                max_num = num
        except ValueError:
            pass
    return f"task-{max_num + 1:03d}"


def route_task(task: dict) -> str:
    """Smart routing: choose the best engine for a task."""
    if task.get("engine") and task["engine"] != "auto":
        return task["engine"]

    task_type = task.get("task_type", "feature")
    engine_map = {
        "feature": "claude", "bugfix": "claude", "plan": "claude",
        "review": "codex", "refactor": "codex", "analysis": "codex", "audit": "codex",
    }
    preferred = engine_map.get(task_type, "claude")

    if not ENGINE_HEALTH.get(preferred, False):
        fallback = "codex" if preferred == "claude" else "claude"
        if ENGINE_HEALTH.get(fallback, False):
            return fallback
    return preferred


def classify_task_type(title: str, description: str) -> str:
    """Classify task type from keywords."""
    text = f"{title} {description}".lower()
    for rule in ROUTING_RULES:
        if any(kw in text for kw in rule["keywords"]):
            return rule["task_type"]
    return "feature"


# --- Pydantic models ---
class TaskCreate(BaseModel):
    title: str
    description: str = ""
    engine: str = "auto"
    plan_mode: bool = False
    priority: str = "medium"
    task_type: Optional[str] = None


class TaskUpdate(BaseModel):
    status: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    engine: Optional[str] = None
    plan_mode: Optional[bool] = None
    plan_content: Optional[str] = None
    assigned_worker: Optional[str] = None
    error_log: Optional[str] = None


# --- FastAPI app ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not TASKS_FILE.exists():
        TASKS_FILE.write_text(json.dumps({
            "tasks": [],
            "meta": {"last_updated": datetime.now(timezone.utc).isoformat(), "total_completed": 0, "success_rate": 0, "claude_tasks": 0, "codex_tasks": 0}
        }, ensure_ascii=False, indent=2), encoding="utf-8")
    yield


app = FastAPI(title="Agent Kanban API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- API routes ---

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "engines": ENGINE_HEALTH,
    }


@app.get("/api/tasks")
async def list_tasks():
    data = read_tasks()
    return data


@app.post("/api/tasks")
async def create_task(body: TaskCreate):
    data = read_tasks()
    task_id = gen_task_id(data)

    task_type = body.task_type or classify_task_type(body.title, body.description)
    routed_engine = route_task({"engine": body.engine, "task_type": task_type})

    task = {
        "id": task_id,
        "title": body.title,
        "description": body.description or body.title,
        "status": "pending",
        "priority": body.priority,
        "task_type": task_type,
        "engine": body.engine,
        "routed_engine": routed_engine,
        "parent_task_id": None,
        "sub_tasks": [],
        "depends_on": [],
        "plan_mode": body.plan_mode,
        "plan_content": None,
        "assigned_worker": None,
        "worktree_branch": None,
        "review_status": None,
        "review_engine": None,
        "review_result": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "started_at": None,
        "completed_at": None,
        "commit_ids": [],
        "error_log": None,
        "retry_count": 0,
        "max_retries": 3,
    }
    data["tasks"].insert(0, task)

    # Update meta stats
    data["meta"]["claude_tasks"] = sum(1 for t in data["tasks"] if t.get("routed_engine") == "claude")
    data["meta"]["codex_tasks"] = sum(1 for t in data["tasks"] if t.get("routed_engine") == "codex")
    write_tasks(data)

    await ws_manager.broadcast({"type": "task_created", "task": task})
    return task


@app.get("/api/tasks/{task_id}")
async def get_task(task_id: str):
    data = read_tasks()
    for t in data["tasks"]:
        if t["id"] == task_id:
            return t
    raise HTTPException(status_code=404, detail="Task not found")


@app.patch("/api/tasks/{task_id}")
async def update_task(task_id: str, body: TaskUpdate):
    data = read_tasks()
    for t in data["tasks"]:
        if t["id"] == task_id:
            updates = body.model_dump(exclude_none=True)
            if "status" in updates:
                if updates["status"] == "in_progress" and t["status"] == "pending":
                    t["started_at"] = datetime.now(timezone.utc).isoformat()
                elif updates["status"] == "completed":
                    t["completed_at"] = datetime.now(timezone.utc).isoformat()
            t.update(updates)

            # Recalculate meta
            completed = sum(1 for x in data["tasks"] if x["status"] == "completed")
            failed = sum(1 for x in data["tasks"] if x["status"] == "failed")
            data["meta"]["total_completed"] = completed
            data["meta"]["success_rate"] = round(completed / max(completed + failed, 1), 2)
            data["meta"]["claude_tasks"] = sum(1 for x in data["tasks"] if x.get("routed_engine") == "claude")
            data["meta"]["codex_tasks"] = sum(1 for x in data["tasks"] if x.get("routed_engine") == "codex")

            write_tasks(data)
            await ws_manager.broadcast({"type": "task_updated", "task": t})
            return t
    raise HTTPException(status_code=404, detail="Task not found")


@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: str):
    data = read_tasks()
    original_len = len(data["tasks"])
    data["tasks"] = [t for t in data["tasks"] if t["id"] != task_id]
    if len(data["tasks"]) == original_len:
        raise HTTPException(status_code=404, detail="Task not found")
    write_tasks(data)
    await ws_manager.broadcast({"type": "task_deleted", "task_id": task_id})
    return {"deleted": task_id}


# --- Worker endpoints ---

@app.get("/api/workers")
async def list_workers():
    return {"workers": WORKERS}


@app.get("/api/workers/{worker_id}")
async def get_worker(worker_id: str):
    for w in WORKERS:
        if w["id"] == worker_id:
            return w
    raise HTTPException(status_code=404, detail="Worker not found")


# --- Engine health ---

@app.get("/api/engines/health")
async def engines_health():
    claude_workers = [w for w in WORKERS if w["engine"] == "claude"]
    codex_workers = [w for w in WORKERS if w["engine"] == "codex"]
    return {
        "engines": {
            "claude": {
                "healthy": ENGINE_HEALTH["claude"],
                "workers_total": len(claude_workers),
                "workers_busy": sum(1 for w in claude_workers if w["status"] == "busy"),
            },
            "codex": {
                "healthy": ENGINE_HEALTH["codex"],
                "workers_total": len(codex_workers),
                "workers_busy": sum(1 for w in codex_workers if w["status"] == "busy"),
            },
        },
    }


# --- WebSocket ---

@app.websocket("/ws/tasks")
async def websocket_tasks(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        while True:
            # Keep connection alive, receive pings
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
