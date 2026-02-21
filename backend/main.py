"""Agent Kanban backend - productionized dispatcher + worker execution loop.

Key capabilities:
- Automatic background dispatch loop (Ralph loop)
- Real Claude/Codex CLI worker execution
- Plan approval -> automatic decomposition -> automatic dispatch
- Adversarial review flow
- Task execution protocol endpoints (claim/heartbeat/complete/fail)
- Timeline/attempt/event observability
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from filelock import FileLock

from config import (
    ALLOWED_ORIGINS,
    AUTO_RETRY_DELAY_SEC,
    CLAUDE_CLI,
    CODEX_CLI,
    DATA_DIR,
    DISPATCH_INTERVAL_SEC,
    HEALTH_INTERVAL_SEC,
    LOCK_FILE,
    MAX_REVIEW_ROUNDS,
    PRIORITY_ORDER,
    PROJECTS_DIR,
    PROJECTS_FILE,
    PROJECTS_LOCK,
    ROUTING_RULES,
    TASK_TYPES,
    TASKS_FILE,
    WORKER_COOLDOWN_SEC,
    WORKER_EXEC_MODE,
    WORKER_HEARTBEAT_TIMEOUT_SEC,
    WORKER_MAX_CONSECUTIVE_FAILURES,
    build_workers,
    project_dir,
    project_lock_file,
    project_tasks_file,
)
from dispatcher import DispatchRuntime
from models import (
    ClaimRequest,
    CompleteRequest,
    DecomposeRequest,
    DispatchRequest,
    EngineHealthUpdate,
    EventAckRequest,
    FailRequest,
    HeartbeatRequest,
    PlanApproval,
    ProjectCreate,
    ProjectUpdate,
    ReviewResult,
    SubTaskInput,
    TaskCreate,
    TaskUpdate,
    WorkerUpdate,
)
from notification import (
    add_subscription,
    get_vapid_public_key,
    send_push_notification,
)
from worker_runner import WorkerRunner

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("agentkanban")

# --- In-memory worker state (generated from config template) ---
WORKERS = build_workers()

ENGINE_HEALTH = {"claude": True, "codex": True}

# in-memory runtime handles (not persisted)
RUNTIME_EXECUTIONS: dict[str, asyncio.Task] = {}
BACKGROUND_TASKS: list[asyncio.Task] = []
DISPATCH_RUNTIME: Optional[DispatchRuntime] = None
DISPATCH_ENABLED: bool = True
DISPATCH_STATS: dict[str, Any] = {
    "last_cycle_at": None,
    "cycle_count": 0,
}

# Worker log buffer for real-time streaming (worker_id -> list of log lines)
WORKER_LOGS: dict[str, list[dict]] = {}

WORKER_RUNNER = WorkerRunner(
    claude_cli=CLAUDE_CLI,
    codex_cli=CODEX_CLI,
    exec_mode=WORKER_EXEC_MODE,
)


# --- WebSocket connection manager ---
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, message: dict):
        for ws in list(self.active):
            try:
                await ws.send_json(message)
            except Exception:
                if ws in self.active:
                    self.active.remove(ws)


ws_manager = ConnectionManager()


# --- Helpers ---
def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_iso(dt: Optional[str]) -> Optional[datetime]:
    if not dt:
        return None
    try:
        return datetime.fromisoformat(dt)
    except (ValueError, TypeError):
        return None


def _gen_event_id() -> str:
    return f"evt-{uuid.uuid4().hex[:10]}"


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _worker_by_id(worker_id: str) -> Optional[dict]:
    for worker in WORKERS:
        if worker["id"] == worker_id:
            return worker
    return None


def _ensure_task_shape(task: dict):
    task.setdefault("plan_questions", [])
    task.setdefault("retry_count", 0)
    task.setdefault("max_retries", 3)
    task.setdefault("routed_engine", task.get("routed_engine") or route_task(task))
    task.setdefault("attempts", [])
    task.setdefault("timeline", [])
    task.setdefault("blocked_reason", None)
    task.setdefault("fallback_reason", None)
    task.setdefault("review_round", 0)
    task.setdefault("last_exit_code", None)


def read_tasks(project_id: str | None = None) -> dict:
    if project_id:
        tf = project_tasks_file(project_id)
        lf = project_lock_file(project_id)
    else:
        tf = TASKS_FILE
        lf = LOCK_FILE

    lock = FileLock(str(lf))
    with lock:
        data = json.loads(tf.read_text(encoding="utf-8"))

    data.setdefault("tasks", [])
    data.setdefault("events", [])
    data.setdefault("meta", {})
    data.setdefault("schema_version", 2)
    for task in data["tasks"]:
        _ensure_task_shape(task)
    return data


def write_tasks(data: dict, project_id: str | None = None):
    if project_id:
        tf = project_tasks_file(project_id)
        lf = project_lock_file(project_id)
    else:
        tf = TASKS_FILE
        lf = LOCK_FILE

    tasks = data.get("tasks", [])
    completed = sum(1 for x in tasks if x.get("status") == "completed")
    failed = sum(1 for x in tasks if x.get("status") == "failed")

    data.setdefault("meta", {})
    data["meta"]["last_updated"] = _now()
    data["meta"]["total_completed"] = completed
    data["meta"]["success_rate"] = round(completed / max(completed + failed, 1), 2)
    data["meta"]["claude_tasks"] = sum(1 for t in tasks if t.get("routed_engine") == "claude")
    data["meta"]["codex_tasks"] = sum(1 for t in tasks if t.get("routed_engine") == "codex")
    data["schema_version"] = 2

    lock = FileLock(str(lf))
    with lock:
        tf.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


# --- Project storage ---
def read_projects() -> dict:
    if not PROJECTS_FILE.exists():
        return {"schema_version": 1, "projects": []}
    lock = FileLock(str(PROJECTS_LOCK))
    with lock:
        return json.loads(PROJECTS_FILE.read_text(encoding="utf-8"))


def write_projects(data: dict):
    lock = FileLock(str(PROJECTS_LOCK))
    with lock:
        PROJECTS_FILE.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def _gen_project_id(data: dict) -> str:
    max_num = 0
    for proj in data.get("projects", []):
        try:
            num = int(str(proj["id"]).replace("proj-", ""))
            max_num = max(max_num, num)
        except (ValueError, KeyError):
            continue
    return f"proj-{max_num + 1:03d}"


def _find_project(data: dict, project_id: str) -> dict | None:
    for proj in data.get("projects", []):
        if proj.get("id") == project_id:
            return proj
    return None


def _init_project_tasks(project_id: str):
    """Initialize an empty tasks.json for a project."""
    pdir = project_dir(project_id)
    pdir.mkdir(parents=True, exist_ok=True)
    tf = project_tasks_file(project_id)
    if not tf.exists():
        tf.write_text(
            json.dumps({
                "schema_version": 2,
                "tasks": [],
                "events": [],
                "meta": {
                    "last_updated": _now(),
                    "total_completed": 0,
                    "success_rate": 0,
                    "claude_tasks": 0,
                    "codex_tasks": 0,
                },
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def _migrate_to_projects():
    """One-time migration: create default project from existing dev-tasks.json."""
    if PROJECTS_FILE.exists():
        return

    logger.info("Migrating to multi-project: creating default project...")
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)

    default_id = "proj-default"
    pdir = project_dir(default_id)
    pdir.mkdir(parents=True, exist_ok=True)

    # Copy existing tasks to default project
    if TASKS_FILE.exists():
        src_data = json.loads(TASKS_FILE.read_text(encoding="utf-8"))
        project_tasks_file(default_id).write_text(
            json.dumps(src_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    else:
        _init_project_tasks(default_id)

    # Create projects registry
    projects_data = {
        "schema_version": 1,
        "projects": [
            {
                "id": default_id,
                "name": "默认项目",
                "description": "从原始数据自动迁移",
                "repo_path": str(_repo_root()),
                "created_at": _now(),
            }
        ],
    }
    write_projects(projects_data)
    logger.info("Migration complete: default project created")


def gen_task_id(data: dict) -> str:
    max_num = 0
    for task in data.get("tasks", []):
        try:
            num = int(str(task["id"]).replace("task-", ""))
            max_num = max(max_num, num)
        except (ValueError, KeyError):
            continue
    return f"task-{max_num + 1:03d}"


def classify_task_type(title: str, description: str) -> str:
    text = f"{title} {description}".lower()
    for rule in ROUTING_RULES:
        if any(keyword.lower() in text for keyword in rule["keywords"]):
            return rule["task_type"]
    return "feature"


def route_task(task: dict) -> str:
    if task.get("engine") and task["engine"] != "auto":
        return task["engine"]

    task_type = task.get("task_type", "feature")
    engine_map = {
        "feature": "claude",
        "bugfix": "claude",
        "plan": "claude",
        "test": "claude",
        "review": "codex",
        "refactor": "codex",
        "analysis": "codex",
        "audit": "codex",
    }
    preferred = engine_map.get(task_type, "claude")
    if ENGINE_HEALTH.get(preferred, False):
        return preferred

    fallback = "codex" if preferred == "claude" else "claude"
    if ENGINE_HEALTH.get(fallback, False):
        task["fallback_reason"] = f"{preferred}_unhealthy"
        return fallback

    task["fallback_reason"] = "no_healthy_engine"
    return preferred


def find_task(data: dict, task_id: str) -> Optional[dict]:
    for task in data.get("tasks", []):
        if task.get("id") == task_id:
            return task
    return None


def dependencies_satisfied(task: dict, data: dict) -> bool:
    for dep in task.get("depends_on", []) or []:
        dep_task = find_task(data, dep)
        if not dep_task or dep_task.get("status") != "completed":
            return False
    return True


def add_timeline(task: dict, event: str, detail: Optional[dict] = None):
    task.setdefault("timeline", [])
    task["timeline"].append({
        "at": _now(),
        "event": event,
        "detail": detail or {},
    })


def _append_attempt(task: dict, worker_id: str, lease_id: str):
    task.setdefault("attempts", [])
    attempt_no = len(task["attempts"]) + 1
    task["attempts"].append({
        "attempt": attempt_no,
        "worker_id": worker_id,
        "engine": task.get("routed_engine") or task.get("engine"),
        "lease_id": lease_id,
        "started_at": _now(),
        "completed_at": None,
        "status": "running",
        "exit_code": None,
        "error_log": None,
        "commit_ids": [],
    })


def _complete_attempt(task: dict, success: bool, *, exit_code: Optional[int], error_log: Optional[str], commit_ids: list[str]):
    attempts = task.get("attempts", [])
    if not attempts:
        return
    attempt = attempts[-1]
    attempt["completed_at"] = _now()
    attempt["status"] = "completed" if success else "failed"
    attempt["exit_code"] = exit_code
    attempt["error_log"] = error_log
    attempt["commit_ids"] = commit_ids


def emit_event(data: dict, event_type: str, *, level: str = "info", task_id: Optional[str] = None, worker_id: Optional[str] = None, message: str = "", meta: Optional[dict] = None) -> dict:
    event = {
        "id": _gen_event_id(),
        "type": event_type,
        "level": level,
        "task_id": task_id,
        "worker_id": worker_id,
        "message": message,
        "meta": meta or {},
        "created_at": _now(),
        "acknowledged": False,
        "acknowledged_at": None,
        "acknowledged_by": None,
    }
    data.setdefault("events", []).append(event)
    if len(data["events"]) > 2000:
        data["events"] = data["events"][-2000:]
    return event


async def broadcast_task_event(task: dict, event_type: str, project_id: str | None = None):
    msg = {"type": event_type, "task": task}
    if project_id:
        msg["project_id"] = project_id
    await ws_manager.broadcast(msg)


async def broadcast_event(event: dict):
    await ws_manager.broadcast({"type": "event_created", "event": event})


async def _maybe_push(title: str, body: str, data: Optional[dict] = None) -> None:
    """Fire-and-forget push notification — never raises."""
    try:
        await send_push_notification(title, body, data)
    except Exception:  # noqa: BLE001
        logger.debug("Push notification skipped", exc_info=True)


def maybe_trigger_adversarial_review(task: dict, data: dict) -> Optional[dict]:
    if task.get("task_type") not in {"feature", "bugfix", "refactor"}:
        return None

    existing = [
        t for t in data["tasks"]
        if t.get("parent_task_id") == task["id"] and t.get("task_type") == "review"
    ]
    if existing:
        return None

    review_engine = "codex" if (task.get("routed_engine") or task.get("engine")) == "claude" else "claude"
    review_task = {
        "id": gen_task_id(data),
        "title": f"Review: {task['title']}",
        "description": f"对任务 {task['id']} 的代码做对抗式 Review",
        "status": "pending",
        "priority": task.get("priority", "medium"),
        "task_type": "review",
        "engine": "auto",
        "routed_engine": review_engine,
        "parent_task_id": task["id"],
        "sub_tasks": [],
        "depends_on": [task["id"]],
        "plan_mode": False,
        "plan_content": None,
        "plan_questions": [],
        "assigned_worker": None,
        "worktree_branch": None,
        "review_status": None,
        "review_engine": review_engine,
        "review_result": None,
        "created_at": _now(),
        "started_at": None,
        "completed_at": None,
        "commit_ids": [],
        "error_log": None,
        "retry_count": 0,
        "max_retries": 3,
        "attempts": [],
        "timeline": [],
        "blocked_reason": None,
        "fallback_reason": None,
        "review_round": 0,
        "last_exit_code": None,
    }
    add_timeline(review_task, "task_created", {"auto": True, "source": "adversarial_review"})
    task["review_status"] = "pending"
    task["status"] = "reviewing"
    add_timeline(task, "review_requested", {"review_task_id": review_task["id"]})
    data["tasks"].insert(0, review_task)
    return review_task


def _decompose_from_plan(task: dict) -> list[SubTaskInput]:
    content = (task.get("plan_content") or "").strip()
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    candidates: list[str] = []
    for line in lines:
        # strip bullets and ordered prefixes
        cleaned = re.sub(r"^(?:[-*]|\d+[.)、])\s*", "", line).strip()
        if len(cleaned) >= 3:
            candidates.append(cleaned)

    if not candidates:
        candidates = [task["title"]]

    subtasks: list[SubTaskInput] = []
    for idx, line in enumerate(candidates[:8], start=1):
        text = line
        ttype = classify_task_type(text, text)
        priority = task.get("priority", "medium")
        engine = "auto"
        subtasks.append(
            SubTaskInput(
                title=f"{task['title']} - 子任务 {idx}: {text[:80]}",
                description=text,
                task_type=ttype if ttype in TASK_TYPES else "feature",
                engine=engine,
                priority=priority,
            )
        )
    return subtasks


def _all_subtasks_completed(parent: dict, data: dict) -> bool:
    sub_ids = parent.get("sub_tasks", [])
    if not sub_ids:
        return False
    for sid in sub_ids:
        sub = find_task(data, sid)
        if not sub or sub.get("status") != "completed":
            return False
    return True


def _refresh_parent_rollup(data: dict):
    for task in data.get("tasks", []):
        if task.get("status") != "blocked_by_subtasks":
            continue
        if not _all_subtasks_completed(task, data):
            continue

        # parent roll-up completion
        task["status"] = "completed"
        task["completed_at"] = _now()
        task["blocked_reason"] = None
        add_timeline(task, "subtasks_all_completed", {"count": len(task.get("sub_tasks", []))})


def _update_worker_cli_health():
    claude_ok = shutil.which(CLAUDE_CLI) is not None
    codex_ok = shutil.which(CODEX_CLI) is not None

    ENGINE_HEALTH["claude"] = claude_ok
    ENGINE_HEALTH["codex"] = codex_ok

    now = _now()
    for worker in WORKERS:
        worker["cli_available"] = claude_ok if worker["engine"] == "claude" else codex_ok
        worker["health"]["last_heartbeat"] = worker["health"].get("last_heartbeat") or now
        worker["last_seen_at"] = worker.get("last_seen_at") or now


WORKTREE_DIR = _repo_root() / ".worktrees"


def _ensure_worktree(worker: dict, repo_path: str | None = None) -> str:
    """Create or validate a git worktree for the given worker. Returns worktree path."""
    if repo_path:
        repo = Path(repo_path)
        wt_base = repo / ".agent-worktrees"
    else:
        repo = _repo_root()
        wt_base = WORKTREE_DIR
    wt_path = wt_base / worker["id"]
    branch_name = f"worker/{worker['id']}"

    if wt_path.exists() and (wt_path / ".git").exists():
        worker["worktree_path"] = str(wt_path)
        return str(wt_path)

    wt_path.parent.mkdir(parents=True, exist_ok=True)

    # Clean up stale worktree entry if directory was deleted but git still tracks it
    try:
        subprocess.run(
            ["git", "worktree", "prune"],
            cwd=str(repo), capture_output=True, timeout=10,
        )
    except (subprocess.SubprocessError, OSError):
        pass

    # Check if branch already exists
    branch_check = subprocess.run(
        ["git", "rev-parse", "--verify", branch_name],
        cwd=str(repo), capture_output=True, timeout=10,
    )

    try:
        if branch_check.returncode == 0:
            # Branch exists, add worktree with existing branch
            subprocess.run(
                ["git", "worktree", "add", str(wt_path), branch_name],
                cwd=str(repo), capture_output=True, check=True, timeout=30,
            )
        else:
            # Create new branch
            subprocess.run(
                ["git", "worktree", "add", "-b", branch_name, str(wt_path)],
                cwd=str(repo), capture_output=True, check=True, timeout=30,
            )
        logger.info("Worktree created for %s at %s", worker["id"], wt_path)
    except subprocess.CalledProcessError as e:
        logger.warning("Failed to create worktree for %s: %s", worker["id"], e.stderr)
        # Fallback to repo root
        worker["worktree_path"] = str(repo)
        return str(repo)

    worker["worktree_path"] = str(wt_path)
    return str(wt_path)


async def _prepare_worktree_for_task(worker: dict, task_id: str, project_id: str | None = None) -> str:
    """Reset worktree to latest main and create a task branch. Returns cwd."""
    # If project_id is given, ensure worktree exists for project repo
    if project_id:
        pdata = read_projects()
        proj = _find_project(pdata, project_id)
        if proj and proj.get("repo_path"):
            try:
                _ensure_worktree(worker, proj["repo_path"])
            except (subprocess.SubprocessError, OSError) as exc:
                logger.warning("Failed to ensure project worktree for %s: %s", worker["id"], exc)

    wt_path = worker.get("worktree_path") or str(_repo_root())
    if not Path(wt_path).exists() or wt_path == str(_repo_root()):
        return str(_repo_root())

    repo = _repo_root()
    task_branch = f"task/{task_id}"

    try:
        # Fetch latest from origin (if remote exists)
        proc = await asyncio.create_subprocess_exec(
            "git", "fetch", "origin", "--quiet",
            cwd=str(repo),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=30)
    except (asyncio.TimeoutError, OSError):
        pass

    try:
        # Reset worktree to main branch HEAD
        proc = await asyncio.create_subprocess_exec(
            "git", "reset", "--hard", "HEAD",
            cwd=wt_path,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=15)

        # Create task-specific branch
        proc = await asyncio.create_subprocess_exec(
            "git", "checkout", "-B", task_branch,
            cwd=wt_path,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=15)

        logger.info("Worktree %s ready on branch %s", worker["id"], task_branch)
    except (asyncio.TimeoutError, OSError) as exc:
        logger.warning("Worktree prep failed for %s: %s", worker["id"], exc)

    return wt_path


async def _merge_task_branch(task_id: str, repo_path: str | None = None) -> tuple[bool, str]:
    """Merge task branch into main. Returns (success, message)."""
    repo = Path(repo_path) if repo_path else _repo_root()
    task_branch = f"task/{task_id}"

    try:
        # Check if task branch has commits ahead of main
        proc = await asyncio.create_subprocess_exec(
            "git", "log", f"main..{task_branch}", "--oneline",
            cwd=str(repo),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=15)
        if not stdout or not stdout.strip():
            return True, "No new commits to merge"

        # Merge with --no-ff
        proc = await asyncio.create_subprocess_exec(
            "git", "merge", "--no-ff", "-m", f"Merge {task_branch}", task_branch,
            cwd=str(repo),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        if proc.returncode == 0:
            logger.info("Merged %s into main", task_branch)
            return True, f"Merged {task_branch}"

        # Merge conflict - abort
        abort_proc = await asyncio.create_subprocess_exec(
            "git", "merge", "--abort",
            cwd=str(repo),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(abort_proc.wait(), timeout=10)
        error_msg = stderr.decode("utf-8", errors="ignore") if stderr else "merge conflict"
        logger.warning("Merge conflict for %s: %s", task_branch, error_msg)
        return False, error_msg

    except (asyncio.TimeoutError, OSError) as exc:
        logger.warning("Merge failed for %s: %s", task_branch, exc)
        return False, str(exc)


def _on_worker_log(worker_id: str, task_id: str, line: str):
    """Buffer and broadcast a worker log line."""
    entry = {"at": _now(), "line": line}
    buf = WORKER_LOGS.setdefault(worker_id, [])
    buf.append(entry)
    # Keep only last 200 lines
    if len(buf) > 200:
        WORKER_LOGS[worker_id] = buf[-200:]
    # Broadcast via WebSocket (fire-and-forget)
    asyncio.ensure_future(ws_manager.broadcast({
        "type": "worker_log",
        "worker_id": worker_id,
        "task_id": task_id,
        "line": line,
        "at": entry["at"],
    }))


def _release_worker(worker: dict):
    worker["pid"] = None
    worker["status"] = "idle"
    worker["current_task_id"] = None
    worker["started_at"] = None
    worker["lease_id"] = None
    worker["last_seen_at"] = _now()
    worker["health"]["last_heartbeat"] = _now()
    RUNTIME_EXECUTIONS.pop(worker["id"], None)
    WORKER_LOGS.pop(worker["id"], None)


async def _run_plan_generation(task_id: str, project_id: str | None = None) -> None:
    """Background coroutine: run Claude in read-only mode to generate plan_content."""
    data = read_tasks(project_id)
    task = find_task(data, task_id)
    if not task or task.get("status") != "plan_review":
        return

    # Use project repo_path if available
    cwd = str(_repo_root())
    if project_id:
        pdata = read_projects()
        proj = _find_project(pdata, project_id)
        if proj and proj.get("repo_path"):
            cwd = proj["repo_path"]

    async def _on_plan_complete(plan_text: str) -> None:
        d = read_tasks(project_id)
        t = find_task(d, task_id)
        if not t:
            return
        t["plan_content"] = plan_text
        add_timeline(t, "plan_generated", {"length": len(plan_text), "source": "ai"})
        event = emit_event(
            d,
            "plan_generated",
            task_id=task_id,
            message=f"AI plan generated for {task_id}",
            meta={"char_count": len(plan_text)},
        )
        write_tasks(d, project_id)
        await broadcast_task_event(t, "task_updated", project_id)
        await broadcast_event(event)
        asyncio.ensure_future(_maybe_push(
            "计划已生成，等待审批",
            f"任务 {task_id}「{t.get('title', '')}」的 AI 计划已就绪",
            {"task_id": task_id, "url": f"/tasks/{task_id}"},
        ))

    async def _on_plan_fail(error: str) -> None:
        logger.warning("Plan generation failed for %s: %s", task_id, error[:200])
        d = read_tasks(project_id)
        t = find_task(d, task_id)
        if not t:
            return
        add_timeline(t, "plan_generation_failed", {"error": error[:500]})
        event = emit_event(
            d,
            "plan_generation_failed",
            level="warning",
            task_id=task_id,
            message=f"AI plan generation failed for {task_id}",
            meta={"error": error[:200]},
        )
        write_tasks(d, project_id)
        await broadcast_event(event)

    await WORKER_RUNNER.run_plan_generation(
        task=task,
        cwd=cwd,
        on_complete=_on_plan_complete,
        on_fail=_on_plan_fail,
    )


async def _run_worker_task(worker: dict, task_id: str, project_id: str | None = None):
    data = read_tasks(project_id)
    task = find_task(data, task_id)
    if not task:
        _release_worker(worker)
        return

    # Resolve project repo_path for worktree/merge operations
    repo_path: str | None = None
    if project_id:
        pdata = read_projects()
        proj = _find_project(pdata, project_id)
        if proj:
            repo_path = proj.get("repo_path")

    # Prepare worktree for isolated execution
    cwd = await _prepare_worktree_for_task(worker, task_id, project_id)

    async def _on_complete(commit_ids: list[str], summary: Optional[str]):
        # Try to merge task branch back to main
        merge_ok, merge_msg = await _merge_task_branch(task_id, repo_path)
        if not merge_ok:
            logger.warning("Auto-merge failed for %s: %s", task_id, merge_msg)
            # Still complete the task, but record merge issue
            d = read_tasks(project_id)
            t = find_task(d, task_id)
            if t:
                add_timeline(t, "merge_conflict", {"message": merge_msg})
                emit_event(d, "merge_conflict", level="warning", task_id=task_id,
                           message=f"Auto-merge failed for {task_id}: {merge_msg}")
                write_tasks(d, project_id)

        await _complete_task_internal(
            task_id,
            worker_id=worker["id"],
            lease_id=worker.get("lease_id"),
            commit_ids=commit_ids,
            summary=summary,
            project_id=project_id,
        )

    async def _on_fail(error_log: str, exit_code: Optional[int]):
        await _fail_task_internal(
            task_id,
            worker_id=worker["id"],
            lease_id=worker.get("lease_id"),
            error_log=error_log,
            exit_code=exit_code,
            project_id=project_id,
        )

    # Initialize worker log buffer
    WORKER_LOGS[worker["id"]] = []

    await WORKER_RUNNER.run_task(
        worker=worker,
        task=task,
        cwd=cwd,
        on_complete=_on_complete,
        on_fail=_on_fail,
        on_release=lambda: _release_worker(worker),
        on_log=lambda line: _on_worker_log(worker["id"], task_id, line),
    )


async def _dispatch_cycle():
    if DISPATCH_RUNTIME is None:
        return
    await DISPATCH_RUNTIME.dispatch_cycle()


async def dispatcher_loop():
    if DISPATCH_RUNTIME is None:
        return
    await DISPATCH_RUNTIME.dispatch_loop()


async def health_loop():
    if DISPATCH_RUNTIME is None:
        return
    await DISPATCH_RUNTIME.health_loop()


async def _complete_task_internal(task_id: str, *, worker_id: str, lease_id: Optional[str], commit_ids: list[str], summary: Optional[str], project_id: str | None = None) -> Optional[dict]:
    data = read_tasks(project_id)
    task = find_task(data, task_id)
    worker = _worker_by_id(worker_id)
    if not task or not worker:
        return None

    if task.get("assigned_worker") != worker_id:
        return None
    if lease_id and worker.get("lease_id") and worker["lease_id"] != lease_id:
        return None

    existing = set(task.get("commit_ids", []))
    for cid in commit_ids:
        existing.add(cid)
    task["commit_ids"] = list(existing)
    task["status"] = "completed"
    task["completed_at"] = _now()
    task["error_log"] = None
    task["last_exit_code"] = 0
    add_timeline(task, "task_completed", {"worker_id": worker_id, "summary": summary or ""})
    _complete_attempt(task, True, exit_code=0, error_log=None, commit_ids=commit_ids)

    worker["total_tasks_completed"] += 1
    worker["health"]["consecutive_failures"] = 0

    review_task = maybe_trigger_adversarial_review(task, data)
    event = emit_event(
        data,
        "task_completed",
        task_id=task_id,
        worker_id=worker_id,
        message=f"Task {task_id} completed",
        meta={"commit_ids": commit_ids},
    )

    _refresh_parent_rollup(data)
    write_tasks(data, project_id)

    await broadcast_task_event(task, "task_updated", project_id)
    if review_task:
        await broadcast_task_event(review_task, "task_created", project_id)
    await broadcast_event(event)
    return task


async def _fail_task_internal(task_id: str, *, worker_id: str, lease_id: Optional[str], error_log: str, exit_code: Optional[int], project_id: str | None = None) -> Optional[dict]:
    data = read_tasks(project_id)
    task = find_task(data, task_id)
    worker = _worker_by_id(worker_id)
    if not task or not worker:
        return None

    if task.get("assigned_worker") != worker_id:
        return None
    if lease_id and worker.get("lease_id") and worker["lease_id"] != lease_id:
        return None

    retry_count = task.get("retry_count", 0) + 1
    max_retries = task.get("max_retries", 3)
    task["error_log"] = error_log
    task["last_exit_code"] = exit_code
    task["retry_count"] = min(retry_count, max_retries)
    _complete_attempt(task, False, exit_code=exit_code, error_log=error_log, commit_ids=[])

    worker["health"]["consecutive_failures"] += 1

    # Auto-retry: if under max retries, schedule for re-dispatch instead of marking failed
    if retry_count < max_retries:
        retry_after = (datetime.now(timezone.utc) + timedelta(seconds=AUTO_RETRY_DELAY_SEC)).isoformat().replace("+00:00", "Z")
        task["status"] = "pending"
        task["assigned_worker"] = None
        task["started_at"] = None
        task["retry_after"] = retry_after
        add_timeline(task, "auto_retry_scheduled", {
            "worker_id": worker_id,
            "exit_code": exit_code,
            "retry_count": retry_count,
            "retry_after": retry_after,
        })

        event = emit_event(
            data,
            "auto_retry_scheduled",
            level="warning",
            task_id=task_id,
            worker_id=worker_id,
            message=f"Task {task_id} auto-retry #{retry_count} scheduled (delay {AUTO_RETRY_DELAY_SEC}s)",
            meta={"exit_code": exit_code, "retry_count": retry_count, "retry_after": retry_after},
        )
        asyncio.ensure_future(_maybe_push(
            "任务自动重试",
            f"任务 {task_id} 第 {retry_count} 次自动重试",
            {"task_id": task_id, "url": f"/tasks/{task_id}"},
        ))
    else:
        task["status"] = "failed"
        add_timeline(task, "task_failed", {"worker_id": worker_id, "exit_code": exit_code, "max_retries_exceeded": True})

        event = emit_event(
            data,
            "task_failed",
            level="error",
            task_id=task_id,
            worker_id=worker_id,
            message=f"Task {task_id} failed (max retries exceeded)",
            meta={"exit_code": exit_code, "retry_count": retry_count},
        )
        asyncio.ensure_future(_maybe_push(
            "任务执行失败",
            f"任务 {task_id} 超出最大重试次数，已标记为失败",
            {"task_id": task_id, "url": f"/tasks/{task_id}"},
        ))

    if worker["health"]["consecutive_failures"] >= 3:
        alert_event = emit_event(
            data,
            "alert_triggered",
            level="critical",
            task_id=task_id,
            worker_id=worker_id,
            message=f"Worker {worker_id} failed 3 times consecutively",
            meta={"consecutive_failures": worker["health"]["consecutive_failures"]},
        )
        asyncio.ensure_future(_maybe_push(
            "Worker 连续失败告警",
            f"Worker {worker_id} 已连续失败 {worker['health']['consecutive_failures']} 次",
            {"task_id": task_id, "url": "/workers"},
        ))

    write_tasks(data, project_id)
    await broadcast_task_event(task, "task_updated", project_id)
    await broadcast_event(event)
    return task


# --- FastAPI app lifecycle ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    global DISPATCH_RUNTIME

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)

    # Auto-migrate to multi-project on first run
    _migrate_to_projects()

    if not TASKS_FILE.exists():
        TASKS_FILE.write_text(
            json.dumps(
                {
                    "schema_version": 2,
                    "tasks": [],
                    "events": [],
                    "meta": {
                        "last_updated": _now(),
                        "total_completed": 0,
                        "success_rate": 0,
                        "claude_tasks": 0,
                        "codex_tasks": 0,
                    },
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    _update_worker_cli_health()

    # Initialize git worktrees for each worker (default repo)
    for worker in WORKERS:
        try:
            _ensure_worktree(worker)
        except (subprocess.SubprocessError, OSError) as exc:
            logger.warning("Failed to init worktree for %s: %s", worker["id"], exc)

    # Initialize worktrees for registered project repositories
    try:
        pdata = read_projects()
        for proj in pdata.get("projects", []):
            rp = proj.get("repo_path")
            if rp and Path(rp).is_dir():
                for worker in WORKERS:
                    try:
                        _ensure_worktree(worker, rp)
                    except (subprocess.SubprocessError, OSError) as exc:
                        logger.warning("Failed to init worktree for %s in project %s: %s",
                                       worker["id"], proj["id"], exc)
    except Exception as exc:
        logger.warning("Failed to init project worktrees: %s", exc)

    DISPATCH_RUNTIME = DispatchRuntime(
        read_tasks=read_tasks,
        write_tasks=write_tasks,
        read_projects=read_projects,
        workers=WORKERS,
        engine_health=ENGINE_HEALTH,
        runtime_executions=RUNTIME_EXECUTIONS,
        route_task=route_task,
        dependencies_satisfied=dependencies_satisfied,
        ensure_task_shape=_ensure_task_shape,
        append_attempt=_append_attempt,
        add_timeline=add_timeline,
        emit_event=emit_event,
        broadcast_event=broadcast_event,
        broadcast_task_event=broadcast_task_event,
        run_worker_task=_run_worker_task,
        refresh_parent_rollup=_refresh_parent_rollup,
        update_worker_cli_health=_update_worker_cli_health,
        now_iso=_now,
        safe_iso=_safe_iso,
        dispatch_interval_sec=DISPATCH_INTERVAL_SEC,
        health_interval_sec=HEALTH_INTERVAL_SEC,
        worker_heartbeat_timeout_sec=WORKER_HEARTBEAT_TIMEOUT_SEC,
        worker_cooldown_sec=WORKER_COOLDOWN_SEC,
        worker_max_consecutive_failures=WORKER_MAX_CONSECUTIVE_FAILURES,
        dispatch_enabled_ref=lambda: DISPATCH_ENABLED,
        dispatch_stats=DISPATCH_STATS,
        send_push=_maybe_push,
    )

    BACKGROUND_TASKS.clear()
    BACKGROUND_TASKS.append(asyncio.create_task(dispatcher_loop()))
    BACKGROUND_TASKS.append(asyncio.create_task(health_loop()))

    yield

    for task in BACKGROUND_TASKS:
        task.cancel()
    BACKGROUND_TASKS.clear()
    DISPATCH_RUNTIME = None


app = FastAPI(title="Agent Kanban API", version="0.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# --- API routes ---
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "timestamp": _now(),
        "engines": ENGINE_HEALTH,
        "worker_exec_mode": WORKER_EXEC_MODE,
    }


@app.get("/api/tasks")
async def list_tasks(
    status: Optional[str] = None,
    engine: Optional[str] = None,
    priority: Optional[str] = None,
    q: Optional[str] = None,
):
    data = read_tasks()
    tasks = data.get("tasks", [])

    def _match(task: dict) -> bool:
        if status and task.get("status") != status:
            return False
        if engine and (task.get("routed_engine") or task.get("engine")) != engine:
            return False
        if priority and task.get("priority") != priority:
            return False
        if q:
            hay = f"{task.get('id','')} {task.get('title','')} {task.get('description','')}"
            if q.lower() not in hay.lower():
                return False
        return True

    filtered = [t for t in tasks if _match(t)]
    return {"tasks": filtered, "meta": data.get("meta", {}), "schema_version": data.get("schema_version", 2)}


@app.post("/api/tasks")
async def create_task(body: TaskCreate):
    data = read_tasks()
    task_id = gen_task_id(data)

    task_type = body.task_type or classify_task_type(body.title, body.description)
    routed_engine = route_task({"engine": body.engine, "task_type": task_type})
    status = "plan_review" if body.plan_mode else "pending"

    task = {
        "id": task_id,
        "title": body.title,
        "description": body.description or body.title,
        "status": status,
        "priority": body.priority,
        "task_type": task_type,
        "engine": body.engine,
        "routed_engine": routed_engine,
        "parent_task_id": None,
        "sub_tasks": [],
        "depends_on": body.depends_on,
        "plan_mode": body.plan_mode,
        "plan_content": None,
        "plan_questions": [q.model_dump() for q in body.plan_questions],
        "assigned_worker": None,
        "worktree_branch": None,
        "review_status": None,
        "review_engine": None,
        "review_result": None,
        "created_at": _now(),
        "started_at": None,
        "completed_at": None,
        "commit_ids": [],
        "error_log": None,
        "retry_count": 0,
        "max_retries": 3,
        "attempts": [],
        "timeline": [],
        "blocked_reason": None,
        "fallback_reason": None,
        "review_round": 0,
        "last_exit_code": None,
    }
    add_timeline(task, "task_created", {"status": status})
    data.setdefault("tasks", []).insert(0, task)
    event = emit_event(
        data,
        "task_created",
        task_id=task_id,
        message=f"Task {task_id} created",
        meta={"status": status},
    )
    write_tasks(data)

    await broadcast_task_event(task, "task_created")
    await broadcast_event(event)

    if body.plan_mode:
        asyncio.create_task(_run_plan_generation(task_id))
        asyncio.ensure_future(_maybe_push(
            "任务等待计划审批",
            f"任务 {task_id}「{body.title}」已进入计划审批，AI 正在生成计划…",
            {"task_id": task_id, "url": f"/tasks/{task_id}"},
        ))

    return task


@app.get("/api/tasks/{task_id}")
async def get_task(task_id: str):
    data = read_tasks()
    task = find_task(data, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.patch("/api/tasks/{task_id}")
async def update_task(task_id: str, body: TaskUpdate):
    data = read_tasks()
    task = find_task(data, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    updates = body.model_dump(exclude_none=True)

    if "status" in updates:
        new_status = updates["status"]
        if new_status == "in_progress":
            if not dependencies_satisfied(task, data):
                raise HTTPException(status_code=409, detail="Dependencies not completed")
            task["started_at"] = task.get("started_at") or _now()
        elif new_status == "completed":
            task["completed_at"] = _now()
        elif new_status == "failed":
            task["retry_count"] = min(task.get("retry_count", 0) + 1, task.get("max_retries", 3))
        elif new_status == "pending" and task.get("status") == "failed":
            task["assigned_worker"] = None
            task["error_log"] = None

        task["status"] = new_status
        add_timeline(task, "status_updated", {"status": new_status})

    if "commit_ids" in updates and isinstance(updates["commit_ids"], list):
        existing = set(task.get("commit_ids", []))
        for cid in updates["commit_ids"]:
            existing.add(cid)
        task["commit_ids"] = list(existing)
        updates.pop("commit_ids", None)

    for key, value in updates.items():
        if key == "status":
            continue
        task[key] = value

    if "engine" in updates or "task_type" in updates:
        task["routed_engine"] = route_task(task)

    review_task = None
    if task.get("status") == "completed":
        review_task = maybe_trigger_adversarial_review(task, data)

    _refresh_parent_rollup(data)
    write_tasks(data)

    await broadcast_task_event(task, "task_updated")
    if review_task:
        await broadcast_task_event(review_task, "task_created")
    return task


@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: str):
    data = read_tasks()
    task = find_task(data, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    for t in data.get("tasks", []):
        if task_id in (t.get("depends_on") or []):
            raise HTTPException(status_code=409, detail="Task is referenced by dependencies")

    data["tasks"] = [t for t in data.get("tasks", []) if t.get("id") != task_id]
    event = emit_event(data, "task_deleted", task_id=task_id, message=f"Task {task_id} deleted")
    write_tasks(data)

    await ws_manager.broadcast({"type": "task_deleted", "task_id": task_id})
    await broadcast_event(event)
    return {"deleted": task_id}


# --- Dispatcher APIs ---
@app.post("/api/dispatcher/next")
async def dispatch_next(body: DispatchRequest):
    data = read_tasks()
    candidates = []
    for task in data.get("tasks", []):
        status = task.get("status", "pending")
        if status not in {"pending", "plan_review"}:
            continue
        if status == "plan_review" and not body.allow_plan_tasks:
            continue
        if not dependencies_satisfied(task, data):
            continue

        routed = task.get("routed_engine") or route_task(task)
        task["routed_engine"] = routed
        if body.engine and routed != body.engine:
            continue
        candidates.append(task)

    if not candidates:
        raise HTTPException(status_code=404, detail="No pending task")

    candidates.sort(
        key=lambda x: (
            PRIORITY_ORDER.get(x.get("priority", "medium"), 1),
            x.get("created_at", ""),
        )
    )
    task = candidates[0]
    if body.worker_id:
        worker = _worker_by_id(body.worker_id)
        if not worker:
            raise HTTPException(status_code=404, detail="Worker not found")
        if worker["status"] != "idle":
            raise HTTPException(status_code=409, detail="Worker not idle")

        lease_id = f"lease-{uuid.uuid4().hex[:12]}"
        task["status"] = "in_progress"
        task["started_at"] = task.get("started_at") or _now()
        task["assigned_worker"] = worker["id"]
        _append_attempt(task, worker["id"], lease_id)
        add_timeline(task, "task_dispatched", {"worker_id": worker["id"], "lease_id": lease_id, "source": "dispatch_next"})

        worker["status"] = "busy"
        worker["current_task_id"] = task["id"]
        worker["lease_id"] = lease_id
        worker["started_at"] = _now()
        worker["last_seen_at"] = _now()

        if worker["id"] not in RUNTIME_EXECUTIONS:
            RUNTIME_EXECUTIONS[worker["id"]] = asyncio.create_task(_run_worker_task(worker, task["id"]))

        dispatch_event = emit_event(
            data,
            "task_dispatched",
            task_id=task["id"],
            worker_id=worker["id"],
            message=f"Task {task['id']} dispatched",
            meta={"engine": worker["engine"], "lease_id": lease_id, "source": "dispatch_next"},
        )
        claim_event = emit_event(
            data,
            "worker_claimed",
            task_id=task["id"],
            worker_id=worker["id"],
            message="Task claimed",
            meta={"lease_id": lease_id, "source": "dispatch_next"},
        )

    write_tasks(data)
    await broadcast_task_event(task, "task_updated")
    if body.worker_id:
        await broadcast_event(dispatch_event)
        await broadcast_event(claim_event)
    return {"task": task}


@app.get("/api/dispatcher/queue")
async def dispatcher_queue():
    data = read_tasks()
    summary: dict[str, int] = {}
    blocked: list[dict[str, Any]] = []
    retries: list[dict[str, Any]] = []
    fallback: list[dict[str, Any]] = []
    for task in data.get("tasks", []):
        status = task.get("status", "pending")
        summary[status] = summary.get(status, 0) + 1
        if task.get("fallback_reason"):
            fallback.append({
                "task_id": task["id"],
                "fallback_reason": task.get("fallback_reason"),
                "routed_engine": task.get("routed_engine") or task.get("engine"),
            })
        if task.get("status") == "failed" and task.get("retry_count", 0) < task.get("max_retries", 3):
            retries.append({
                "task_id": task["id"],
                "retry_count": task.get("retry_count", 0),
                "max_retries": task.get("max_retries", 3),
                "last_exit_code": task.get("last_exit_code"),
            })
        if status == "pending" and not dependencies_satisfied(task, data):
            blocked.append({
                "task_id": task["id"],
                "reason": "dependencies_unmet",
                "depends_on": task.get("depends_on", []),
            })
        elif status in {"plan_review", "blocked_by_subtasks"}:
            blocked.append({
                "task_id": task["id"],
                "reason": task.get("blocked_reason") or status,
                "depends_on": task.get("depends_on", []),
            })

    return {
        "summary": summary,
        "total": len(data.get("tasks", [])),
        "blocked": blocked,
        "fallback": fallback[:100],
        "retries": retries[:100],
        "engines": ENGINE_HEALTH,
    }


@app.get("/api/dispatcher/status")
async def dispatcher_status():
    """Get dispatcher loop status."""
    return {
        "enabled": DISPATCH_ENABLED,
        "last_cycle_at": DISPATCH_STATS.get("last_cycle_at"),
        "cycle_count": DISPATCH_STATS.get("cycle_count", 0),
        "interval_sec": DISPATCH_INTERVAL_SEC,
        "auto_retry_delay_sec": AUTO_RETRY_DELAY_SEC,
        "worker_cooldown_sec": WORKER_COOLDOWN_SEC,
    }


@app.post("/api/dispatcher/toggle")
async def dispatcher_toggle():
    """Toggle dispatcher on/off."""
    global DISPATCH_ENABLED
    DISPATCH_ENABLED = not DISPATCH_ENABLED
    state = "enabled" if DISPATCH_ENABLED else "paused"
    logger.info("Dispatcher %s", state)

    data = read_tasks()
    event = emit_event(
        data,
        "dispatcher_toggled",
        level="info",
        message=f"Dispatcher {state}",
        meta={"enabled": DISPATCH_ENABLED},
    )
    write_tasks(data)
    await broadcast_event(event)

    return {"enabled": DISPATCH_ENABLED}


@app.post("/api/dispatcher/trigger")
async def dispatcher_trigger():
    """Manually trigger a single dispatch cycle."""
    if DISPATCH_RUNTIME is None:
        raise HTTPException(status_code=503, detail="Dispatcher not initialized")

    await DISPATCH_RUNTIME.dispatch_cycle()
    DISPATCH_STATS["last_cycle_at"] = _now()
    DISPATCH_STATS["cycle_count"] = DISPATCH_STATS.get("cycle_count", 0) + 1
    return {"triggered": True, "cycle_count": DISPATCH_STATS["cycle_count"]}


@app.get("/api/workers/{worker_id}/logs")
async def get_worker_logs(worker_id: str):
    """Get buffered log lines for a worker."""
    worker = _worker_by_id(worker_id)
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    return {"worker_id": worker_id, "logs": WORKER_LOGS.get(worker_id, [])}


# --- Worker endpoints ---
@app.get("/api/workers")
async def list_workers():
    return {"workers": WORKERS}


@app.get("/api/workers/{worker_id}")
async def get_worker(worker_id: str):
    worker = _worker_by_id(worker_id)
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    return worker


@app.patch("/api/workers/{worker_id}")
async def update_worker(worker_id: str, body: WorkerUpdate):
    worker = _worker_by_id(worker_id)
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    if body.status is not None:
        worker["status"] = body.status
    if body.current_task_id is not None:
        worker["current_task_id"] = body.current_task_id

    worker["last_seen_at"] = _now()
    worker["health"]["last_heartbeat"] = _now()
    await ws_manager.broadcast({"type": "worker_updated", "worker": worker})
    return worker


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
                "workers_idle": sum(1 for w in claude_workers if w["status"] == "idle"),
            },
            "codex": {
                "healthy": ENGINE_HEALTH["codex"],
                "workers_total": len(codex_workers),
                "workers_busy": sum(1 for w in codex_workers if w["status"] == "busy"),
                "workers_idle": sum(1 for w in codex_workers if w["status"] == "idle"),
            },
        },
    }


@app.patch("/api/engines/{engine}/health")
async def set_engine_health(engine: str, body: EngineHealthUpdate):
    if engine not in ENGINE_HEALTH:
        raise HTTPException(status_code=404, detail="Engine not found")
    ENGINE_HEALTH[engine] = body.healthy
    return {"engine": engine, "healthy": ENGINE_HEALTH[engine]}


# --- Task execution protocol ---
@app.post("/api/tasks/{task_id}/claim")
async def claim_task(task_id: str, body: ClaimRequest):
    data = read_tasks()
    task = find_task(data, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.get("status") not in {"pending", "in_progress"}:
        raise HTTPException(status_code=409, detail="Task not claimable")
    if task.get("status") == "pending" and not dependencies_satisfied(task, data):
        raise HTTPException(status_code=409, detail="Dependencies not completed")

    worker = _worker_by_id(body.worker_id)
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")
    if worker["status"] not in {"idle", "busy"}:
        raise HTTPException(status_code=409, detail="Worker not claimable")

    lease_id = f"lease-{uuid.uuid4().hex[:12]}"
    task["status"] = "in_progress"
    task["assigned_worker"] = worker["id"]
    task["started_at"] = task.get("started_at") or _now()
    _append_attempt(task, worker["id"], lease_id)

    worker["status"] = "busy"
    worker["current_task_id"] = task_id
    worker["lease_id"] = lease_id
    worker["started_at"] = _now()
    worker["last_seen_at"] = _now()
    worker["health"]["last_heartbeat"] = _now()

    add_timeline(task, "task_claimed", {"worker_id": worker["id"], "lease_id": lease_id})
    event = emit_event(data, "worker_claimed", task_id=task_id, worker_id=worker["id"], message="Task claimed")
    write_tasks(data)

    await broadcast_task_event(task, "task_updated")
    await broadcast_event(event)
    return {"task": task, "lease_id": lease_id}


@app.post("/api/tasks/{task_id}/heartbeat")
async def heartbeat_task(task_id: str, body: HeartbeatRequest):
    data = read_tasks()
    task = find_task(data, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    worker = _worker_by_id(body.worker_id)
    if not worker:
        raise HTTPException(status_code=404, detail="Worker not found")

    if task.get("assigned_worker") != worker["id"]:
        raise HTTPException(status_code=409, detail="Worker not assigned to task")

    if body.lease_id and worker.get("lease_id") and worker["lease_id"] != body.lease_id:
        raise HTTPException(status_code=409, detail="Lease mismatch")

    worker["last_seen_at"] = _now()
    worker["health"]["last_heartbeat"] = _now()
    return {"ok": True, "worker_id": worker["id"], "task_id": task_id}


@app.post("/api/tasks/{task_id}/complete")
async def complete_task(task_id: str, body: CompleteRequest):
    task = await _complete_task_internal(
        task_id,
        worker_id=body.worker_id,
        lease_id=body.lease_id,
        commit_ids=body.commit_ids,
        summary=body.summary,
    )
    if not task:
        raise HTTPException(status_code=409, detail="Complete rejected")
    return task


@app.post("/api/tasks/{task_id}/fail")
async def fail_task(task_id: str, body: FailRequest):
    task = await _fail_task_internal(
        task_id,
        worker_id=body.worker_id,
        lease_id=body.lease_id,
        error_log=body.error_log,
        exit_code=body.exit_code,
    )
    if not task:
        raise HTTPException(status_code=409, detail="Fail rejected")
    return task


# --- Task actions ---
@app.post("/api/tasks/{task_id}/dispatch")
async def dispatch_task(task_id: str):
    data = read_tasks()
    task = find_task(data, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.get("status") != "pending":
        raise HTTPException(status_code=409, detail="Task is not pending")
    if not dependencies_satisfied(task, data):
        raise HTTPException(status_code=409, detail="Dependencies not completed")

    engine = task.get("routed_engine") or route_task(task)
    worker = next((w for w in WORKERS if w["engine"] == engine and w["status"] == "idle"), None)
    if not worker:
        fallback = "codex" if engine == "claude" else "claude"
        worker = next((w for w in WORKERS if w["engine"] == fallback and w["status"] == "idle"), None)
        if worker:
            task["fallback_reason"] = f"manual_dispatch_fallback_{fallback}"

    if not worker:
        raise HTTPException(status_code=409, detail="No idle worker available")

    lease_id = f"lease-{uuid.uuid4().hex[:12]}"
    task["status"] = "in_progress"
    task["assigned_worker"] = worker["id"]
    task["started_at"] = _now()
    _append_attempt(task, worker["id"], lease_id)
    add_timeline(task, "task_dispatched", {"worker_id": worker["id"], "lease_id": lease_id, "manual": True})

    worker["status"] = "busy"
    worker["current_task_id"] = task_id
    worker["lease_id"] = lease_id
    worker["started_at"] = _now()
    worker["last_seen_at"] = _now()

    if worker["id"] not in RUNTIME_EXECUTIONS:
        RUNTIME_EXECUTIONS[worker["id"]] = asyncio.create_task(_run_worker_task(worker, task["id"]))

    dispatched_event = emit_event(
        data,
        "task_dispatched",
        task_id=task["id"],
        worker_id=worker["id"],
        message=f"Task {task['id']} dispatched manually",
        meta={"engine": worker["engine"], "lease_id": lease_id, "manual": True},
    )
    claimed_event = emit_event(
        data,
        "worker_claimed",
        task_id=task["id"],
        worker_id=worker["id"],
        message="Task claimed manually",
        meta={"lease_id": lease_id, "source": "manual_dispatch"},
    )

    write_tasks(data)
    await broadcast_task_event(task, "task_updated")
    await broadcast_event(dispatched_event)
    await broadcast_event(claimed_event)
    return task


@app.post("/api/tasks/{task_id}/review")
async def trigger_review(task_id: str):
    data = read_tasks()
    task = find_task(data, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.get("status") not in ("completed", "reviewing"):
        raise HTTPException(status_code=409, detail="Task must be completed before review")

    review_task = maybe_trigger_adversarial_review(task, data)
    if not review_task:
        raise HTTPException(status_code=409, detail="Review already exists or not applicable")

    event = emit_event(
        data,
        "review_requested",
        task_id=task_id,
        message=f"Adversarial review requested for {task_id}",
        meta={"review_task_id": review_task["id"]},
    )
    write_tasks(data)

    await broadcast_task_event(review_task, "task_created")
    await broadcast_task_event(task, "task_updated")
    await broadcast_event(event)
    return review_task


@app.post("/api/tasks/{task_id}/review-submit")
async def submit_review(task_id: str, body: ReviewResult):
    data = read_tasks()
    task = find_task(data, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task["review_result"] = body.model_dump()
    task["review_status"] = "completed"
    task["status"] = "completed"
    task["completed_at"] = _now()
    add_timeline(task, "review_completed", {"summary": body.summary or ""})

    parent_id = task.get("parent_task_id")
    if parent_id:
        parent = find_task(data, parent_id)
        if parent:
            has_critical = any(issue.get("severity") in ("critical", "high") for issue in (body.model_dump().get("issues") or []))
            if has_critical:
                parent["review_status"] = "changes_requested"
                parent["status"] = "failed"
                parent["error_log"] = f"Review failed: {body.summary or 'critical issues'}"
                parent["review_round"] = int(parent.get("review_round", 0) or 0) + 1
                if parent["review_round"] >= MAX_REVIEW_ROUNDS:
                    parent["status"] = "plan_review"
                    parent["blocked_reason"] = "max_review_rounds_exceeded"
                add_timeline(parent, "review_failed", {"round": parent.get("review_round")})
                asyncio.ensure_future(_maybe_push(
                    "Review 发现严重问题",
                    f"任务 {parent_id} 的 Review 发现 critical/high 问题: {body.summary or ''}",
                    {"task_id": parent_id, "url": f"/tasks/{parent_id}"},
                ))
            else:
                parent["review_status"] = "approved"
                if parent.get("status") != "completed":
                    parent["status"] = "completed"
                    parent["completed_at"] = _now()
                add_timeline(parent, "review_approved", {})
            await broadcast_task_event(parent, "task_updated")

    event = emit_event(data, "review_submitted", task_id=task_id, message="Review submitted")
    write_tasks(data)

    await broadcast_task_event(task, "task_updated")
    await broadcast_event(event)
    return task


@app.post("/api/tasks/{task_id}/approve-plan")
async def _approve_plan_impl(task_id: str, body: PlanApproval, project_id: str | None = None):
    data = read_tasks(project_id)
    task = find_task(data, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.get("status") != "plan_review":
        raise HTTPException(status_code=409, detail="Task is not in plan_review status")

    if not body.approved:
        task["status"] = "pending"
        if body.feedback:
            prev = task.get("plan_content") or ""
            task["plan_content"] = f"{prev}\n\n--- 驳回反馈 ---\n{body.feedback}".strip()
        add_timeline(task, "plan_rejected", {"feedback": body.feedback or ""})
        event = emit_event(data, "plan_rejected", task_id=task_id, message="Plan rejected")
        write_tasks(data, project_id)
        await broadcast_task_event(task, "task_updated", project_id)
        await broadcast_event(event)
        return {"task": task, "sub_tasks": []}

    # approved: auto decompose + auto enqueue
    task["status"] = "blocked_by_subtasks"
    task["blocked_reason"] = "waiting_subtasks"
    add_timeline(task, "plan_approved", {})

    if not task.get("plan_content"):
        task["plan_content"] = f"1. 实现 {task['title']}\n2. 编写测试\n3. 走代码审查"

    sub_inputs = _decompose_from_plan(task)
    created_subs = []
    for sub_input in sub_inputs:
        sub_id = gen_task_id(data)
        routed = route_task({"engine": sub_input.engine, "task_type": sub_input.task_type})
        sub = {
            "id": sub_id,
            "title": sub_input.title,
            "description": sub_input.description or sub_input.title,
            "status": "pending",
            "priority": sub_input.priority,
            "task_type": sub_input.task_type,
            "engine": sub_input.engine,
            "routed_engine": routed,
            "parent_task_id": task_id,
            "sub_tasks": [],
            "depends_on": [],
            "plan_mode": False,
            "plan_content": None,
            "plan_questions": [],
            "assigned_worker": None,
            "worktree_branch": None,
            "review_status": None,
            "review_engine": None,
            "review_result": None,
            "created_at": _now(),
            "started_at": None,
            "completed_at": None,
            "commit_ids": [],
            "error_log": None,
            "retry_count": 0,
            "max_retries": 3,
            "attempts": [],
            "timeline": [],
            "blocked_reason": None,
            "fallback_reason": None,
            "review_round": 0,
            "last_exit_code": None,
        }
        add_timeline(sub, "task_created", {"auto": True, "source": "plan_decompose"})
        data["tasks"].insert(0, sub)
        task.setdefault("sub_tasks", []).append(sub_id)
        created_subs.append(sub)

    event = emit_event(
        data,
        "plan_approved",
        task_id=task_id,
        message="Plan approved and decomposed",
        meta={"sub_task_count": len(created_subs)},
    )

    write_tasks(data, project_id)

    await broadcast_task_event(task, "task_updated", project_id)
    for sub in created_subs:
        await broadcast_task_event(sub, "task_created", project_id)
    await broadcast_event(event)
    return {"task": task, "sub_tasks": created_subs}


async def approve_plan(task_id: str, body: PlanApproval):
    return await _approve_plan_impl(task_id, body)


async def _decompose_task_impl(task_id: str, body: DecomposeRequest, project_id: str | None = None):
    data = read_tasks(project_id)
    parent = find_task(data, task_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Task not found")

    created_subs = []
    for sub_input in body.sub_tasks:
        sub_id = gen_task_id(data)
        routed = route_task({"engine": sub_input.engine, "task_type": sub_input.task_type})
        sub = {
            "id": sub_id,
            "title": sub_input.title,
            "description": sub_input.description or sub_input.title,
            "status": "pending",
            "priority": sub_input.priority,
            "task_type": sub_input.task_type,
            "engine": sub_input.engine,
            "routed_engine": routed,
            "parent_task_id": task_id,
            "sub_tasks": [],
            "depends_on": [],
            "plan_mode": False,
            "plan_content": None,
            "plan_questions": [],
            "assigned_worker": None,
            "worktree_branch": None,
            "review_status": None,
            "review_engine": None,
            "review_result": None,
            "created_at": _now(),
            "started_at": None,
            "completed_at": None,
            "commit_ids": [],
            "error_log": None,
            "retry_count": 0,
            "max_retries": 3,
            "attempts": [],
            "timeline": [],
            "blocked_reason": None,
            "fallback_reason": None,
            "review_round": 0,
            "last_exit_code": None,
        }
        add_timeline(sub, "task_created", {"auto": False, "source": "manual_decompose"})
        data["tasks"].insert(0, sub)
        parent.setdefault("sub_tasks", []).append(sub_id)
        created_subs.append(sub)

    parent["status"] = "blocked_by_subtasks"
    parent["blocked_reason"] = "waiting_subtasks"
    add_timeline(parent, "task_decomposed", {"count": len(created_subs)})

    event = emit_event(
        data,
        "task_decomposed",
        task_id=task_id,
        message=f"Task {task_id} decomposed",
        meta={"sub_task_count": len(created_subs)},
    )
    write_tasks(data, project_id)

    for sub in created_subs:
        await broadcast_task_event(sub, "task_created", project_id)
    await broadcast_task_event(parent, "task_updated", project_id)
    await broadcast_event(event)
    return {"parent": parent, "sub_tasks": created_subs}


@app.post("/api/tasks/{task_id}/decompose")
async def decompose_task(task_id: str, body: DecomposeRequest):
    return await _decompose_task_impl(task_id, body)


async def _retry_task_impl(task_id: str, project_id: str | None = None):
    data = read_tasks(project_id)
    task = find_task(data, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.get("status") != "failed":
        raise HTTPException(status_code=409, detail="Only failed tasks can be retried")
    if task.get("retry_count", 0) >= task.get("max_retries", 3):
        raise HTTPException(status_code=409, detail="Max retries exceeded")

    task["status"] = "pending"
    task["error_log"] = None
    task["assigned_worker"] = None
    task["started_at"] = None
    task["blocked_reason"] = None
    add_timeline(task, "task_retried", {"retry_count": task.get("retry_count", 0)})

    event = emit_event(data, "retry_scheduled", task_id=task_id, message="Retry scheduled")
    write_tasks(data, project_id)

    await broadcast_task_event(task, "task_updated", project_id)
    await broadcast_event(event)
    return task


@app.post("/api/tasks/{task_id}/retry")
async def retry_task(task_id: str):
    return await _retry_task_impl(task_id)


@app.get("/api/tasks/{task_id}/timeline")
async def task_timeline(task_id: str):
    data = read_tasks()
    task = find_task(data, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"task_id": task_id, "timeline": task.get("timeline", [])}


@app.get("/api/tasks/{task_id}/attempts")
async def task_attempts(task_id: str):
    data = read_tasks()
    task = find_task(data, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"task_id": task_id, "attempts": task.get("attempts", [])}


# --- Stats ---
@app.get("/api/stats")
async def get_stats():
    data = read_tasks()
    tasks = data.get("tasks", [])

    by_status: dict[str, int] = {}
    by_type: dict[str, int] = {}
    by_engine: dict[str, int] = {}
    by_priority: dict[str, int] = {}

    for task in tasks:
        by_status[task.get("status", "pending")] = by_status.get(task.get("status", "pending"), 0) + 1
        by_type[task.get("task_type", "feature")] = by_type.get(task.get("task_type", "feature"), 0) + 1
        eng = task.get("routed_engine") or "auto"
        by_engine[eng] = by_engine.get(eng, 0) + 1
        by_priority[task.get("priority", "medium")] = by_priority.get(task.get("priority", "medium"), 0) + 1

    return {
        "total_tasks": len(tasks),
        "by_status": by_status,
        "by_type": by_type,
        "by_engine": by_engine,
        "by_priority": by_priority,
        "engines": {
            "claude": {
                "healthy": ENGINE_HEALTH["claude"],
                "workers_total": len([w for w in WORKERS if w["engine"] == "claude"]),
                "workers_busy": len([w for w in WORKERS if w["engine"] == "claude" and w["status"] == "busy"]),
            },
            "codex": {
                "healthy": ENGINE_HEALTH["codex"],
                "workers_total": len([w for w in WORKERS if w["engine"] == "codex"]),
                "workers_busy": len([w for w in WORKERS if w["engine"] == "codex" and w["status"] == "busy"]),
            },
        },
        "meta": data.get("meta", {}),
    }


@app.get("/api/stats/daily")
async def get_daily_stats():
    data = read_tasks()
    today = datetime.now(timezone.utc).date().isoformat()

    created_today = sum(1 for t in data.get("tasks", []) if t.get("created_at", "").startswith(today))
    completed_today = sum(1 for t in data.get("tasks", []) if t.get("completed_at") and str(t.get("completed_at", "")).startswith(today))

    return {"date": today, "created": created_today, "completed": completed_today}


# --- Events / Notifications ---
@app.get("/api/events")
async def list_events(level: Optional[str] = None, task_id: Optional[str] = None):
    data = read_tasks()
    events = data.get("events", [])
    result = []
    for event in reversed(events):
        if level and event.get("level") != level:
            continue
        if task_id and event.get("task_id") != task_id:
            continue
        result.append(event)
    return {"events": result[:200]}


@app.post("/api/events/{event_id}/ack")
async def ack_event(event_id: str, body: EventAckRequest):
    data = read_tasks()
    target = None
    for event in data.get("events", []):
        if event.get("id") == event_id:
            target = event
            break

    if not target:
        raise HTTPException(status_code=404, detail="Event not found")

    target["acknowledged"] = True
    target["acknowledged_at"] = _now()
    target["acknowledged_by"] = body.by or "user"
    write_tasks(data)
    await ws_manager.broadcast({"type": "event_updated", "event": target})
    return target


@app.get("/api/notifications")
async def get_notifications():
    data = read_tasks()
    events = [e for e in data.get("events", []) if e.get("level") in {"warning", "error", "critical"}]
    return {"notifications": list(reversed(events[-50:]))}


@app.post("/api/notifications/subscribe")
async def subscribe_push(subscription: dict):
    if not subscription.get("endpoint"):
        raise HTTPException(status_code=400, detail="Missing endpoint")
    add_subscription(subscription)
    return {"status": "subscribed"}


@app.get("/api/notifications/vapid-public-key")
async def get_push_public_key():
    key = get_vapid_public_key()
    return {"vapid_public_key": key, "push_enabled": key is not None}


# --- Project CRUD ---
@app.get("/api/projects")
async def list_projects():
    data = read_projects()
    projects = data.get("projects", [])
    # Enrich with task_count
    for proj in projects:
        try:
            pdata = read_tasks(proj["id"])
            proj["task_count"] = len(pdata.get("tasks", []))
        except Exception:
            proj["task_count"] = 0
    return {"projects": projects}


@app.post("/api/projects")
async def create_project(body: ProjectCreate):
    repo = Path(body.repo_path)
    if not repo.exists():
        raise HTTPException(status_code=400, detail="repo_path does not exist")

    # Validate it's a git repo
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "--git-dir"],
            capture_output=True, timeout=10,
        )
        if result.returncode != 0:
            raise HTTPException(status_code=400, detail="repo_path is not a git repository")
    except (subprocess.SubprocessError, OSError):
        raise HTTPException(status_code=400, detail="Failed to validate git repository")

    data = read_projects()
    pid = _gen_project_id(data)

    project = {
        "id": pid,
        "name": body.name,
        "description": body.description,
        "repo_path": str(repo.resolve()),
        "created_at": _now(),
    }
    data.setdefault("projects", []).append(project)
    write_projects(data)

    _init_project_tasks(pid)

    project["task_count"] = 0
    return project


@app.get("/api/projects/{project_id}")
async def get_project(project_id: str):
    data = read_projects()
    proj = _find_project(data, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        pdata = read_tasks(project_id)
        proj["task_count"] = len(pdata.get("tasks", []))
    except Exception:
        proj["task_count"] = 0
    return proj


@app.patch("/api/projects/{project_id}")
async def update_project(project_id: str, body: ProjectUpdate):
    data = read_projects()
    proj = _find_project(data, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    if body.name is not None:
        proj["name"] = body.name
    if body.description is not None:
        proj["description"] = body.description
    if body.repo_path is not None:
        repo = Path(body.repo_path)
        if not repo.exists():
            raise HTTPException(status_code=400, detail="repo_path does not exist")
        proj["repo_path"] = str(repo.resolve())

    write_projects(data)
    return proj


@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str):
    if project_id == "proj-default":
        raise HTTPException(status_code=400, detail="Cannot delete default project")

    data = read_projects()
    proj = _find_project(data, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    # Check for active tasks
    try:
        pdata = read_tasks(project_id)
        active = [t for t in pdata.get("tasks", []) if t.get("status") in {"in_progress", "reviewing"}]
        if active:
            raise HTTPException(status_code=409, detail="Project has active tasks")
    except Exception:
        pass

    data["projects"] = [p for p in data.get("projects", []) if p["id"] != project_id]
    write_projects(data)

    # Remove project directory
    pdir = project_dir(project_id)
    if pdir.exists():
        shutil.rmtree(str(pdir), ignore_errors=True)

    return {"deleted": project_id}


# --- Project-scoped task routes ---

@app.get("/api/projects/{project_id}/tasks")
async def list_project_tasks(
    project_id: str,
    status: Optional[str] = None,
    engine: Optional[str] = None,
    priority: Optional[str] = None,
    q: Optional[str] = None,
):
    proj_data = read_projects()
    if not _find_project(proj_data, project_id):
        raise HTTPException(status_code=404, detail="Project not found")

    data = read_tasks(project_id)
    tasks = data.get("tasks", [])

    def _match(task: dict) -> bool:
        if status and task.get("status") != status:
            return False
        if engine and (task.get("routed_engine") or task.get("engine")) != engine:
            return False
        if priority and task.get("priority") != priority:
            return False
        if q:
            hay = f"{task.get('id','')} {task.get('title','')} {task.get('description','')}"
            if q.lower() not in hay.lower():
                return False
        return True

    filtered = [t for t in tasks if _match(t)]
    return {"tasks": filtered, "meta": data.get("meta", {}), "schema_version": data.get("schema_version", 2)}


@app.post("/api/projects/{project_id}/tasks")
async def create_project_task(project_id: str, body: TaskCreate):
    proj_data = read_projects()
    if not _find_project(proj_data, project_id):
        raise HTTPException(status_code=404, detail="Project not found")

    data = read_tasks(project_id)
    task_id = gen_task_id(data)

    task_type = body.task_type or classify_task_type(body.title, body.description)
    routed_engine = route_task({"engine": body.engine, "task_type": task_type})
    status = "plan_review" if body.plan_mode else "pending"

    task = {
        "id": task_id,
        "title": body.title,
        "description": body.description or body.title,
        "status": status,
        "priority": body.priority,
        "task_type": task_type,
        "engine": body.engine,
        "routed_engine": routed_engine,
        "parent_task_id": None,
        "sub_tasks": [],
        "depends_on": body.depends_on,
        "plan_mode": body.plan_mode,
        "plan_content": None,
        "plan_questions": [q.model_dump() for q in body.plan_questions],
        "assigned_worker": None,
        "worktree_branch": None,
        "review_status": None,
        "review_engine": None,
        "review_result": None,
        "created_at": _now(),
        "started_at": None,
        "completed_at": None,
        "commit_ids": [],
        "error_log": None,
        "retry_count": 0,
        "max_retries": 3,
        "attempts": [],
        "timeline": [],
        "blocked_reason": None,
        "fallback_reason": None,
        "review_round": 0,
        "last_exit_code": None,
    }
    add_timeline(task, "task_created", {"status": status, "project_id": project_id})
    data.setdefault("tasks", []).insert(0, task)
    event = emit_event(
        data,
        "task_created",
        task_id=task_id,
        message=f"Task {task_id} created in project {project_id}",
        meta={"status": status, "project_id": project_id},
    )
    write_tasks(data, project_id)

    await broadcast_task_event(task, "task_created", project_id=project_id)
    await broadcast_event(event)

    if body.plan_mode:
        asyncio.create_task(_run_plan_generation(task_id, project_id))
        asyncio.ensure_future(_maybe_push(
            "任务等待计划审批",
            f"任务 {task_id}「{body.title}」已进入计划审批，AI 正在生成计划…",
            {"task_id": task_id, "url": f"/tasks/{task_id}"},
        ))

    return task


@app.get("/api/projects/{project_id}/tasks/{task_id}")
async def get_project_task(project_id: str, task_id: str):
    data = read_tasks(project_id)
    task = find_task(data, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.patch("/api/projects/{project_id}/tasks/{task_id}")
async def update_project_task(project_id: str, task_id: str, body: TaskUpdate):
    data = read_tasks(project_id)
    task = find_task(data, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    updates = body.model_dump(exclude_none=True)

    if "status" in updates:
        new_status = updates["status"]
        if new_status == "in_progress":
            if not dependencies_satisfied(task, data):
                raise HTTPException(status_code=409, detail="Dependencies not completed")
            task["started_at"] = task.get("started_at") or _now()
        elif new_status == "completed":
            task["completed_at"] = _now()
        elif new_status == "failed":
            task["retry_count"] = min(task.get("retry_count", 0) + 1, task.get("max_retries", 3))
        elif new_status == "pending" and task.get("status") == "failed":
            task["assigned_worker"] = None
            task["error_log"] = None
        task["status"] = new_status
        add_timeline(task, "status_updated", {"status": new_status})

    if "commit_ids" in updates and isinstance(updates["commit_ids"], list):
        existing = set(task.get("commit_ids", []))
        for cid in updates["commit_ids"]:
            existing.add(cid)
        task["commit_ids"] = list(existing)
        updates.pop("commit_ids", None)

    for key, value in updates.items():
        if key == "status":
            continue
        task[key] = value

    if "engine" in updates or "task_type" in updates:
        task["routed_engine"] = route_task(task)

    _refresh_parent_rollup(data)
    write_tasks(data, project_id)

    await broadcast_task_event(task, "task_updated", project_id=project_id)
    return task


@app.delete("/api/projects/{project_id}/tasks/{task_id}")
async def delete_project_task(project_id: str, task_id: str):
    data = read_tasks(project_id)
    task = find_task(data, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    for t in data.get("tasks", []):
        if task_id in (t.get("depends_on") or []):
            raise HTTPException(status_code=409, detail="Task is referenced by dependencies")

    data["tasks"] = [t for t in data.get("tasks", []) if t.get("id") != task_id]
    emit_event(data, "task_deleted", task_id=task_id, message=f"Task {task_id} deleted")
    write_tasks(data, project_id)

    await ws_manager.broadcast({"type": "task_deleted", "task_id": task_id, "project_id": project_id})
    return {"deleted": task_id}


@app.post("/api/projects/{project_id}/tasks/{task_id}/approve-plan")
async def approve_project_plan(project_id: str, task_id: str, body: PlanApproval):
    proj_data = read_projects()
    if not _find_project(proj_data, project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return await _approve_plan_impl(task_id, body, project_id)


@app.post("/api/projects/{project_id}/tasks/{task_id}/decompose")
async def decompose_project_task(project_id: str, task_id: str, body: DecomposeRequest):
    proj_data = read_projects()
    if not _find_project(proj_data, project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return await _decompose_task_impl(task_id, body, project_id)


@app.post("/api/projects/{project_id}/tasks/{task_id}/retry")
async def retry_project_task(project_id: str, task_id: str):
    proj_data = read_projects()
    if not _find_project(proj_data, project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    return await _retry_task_impl(task_id, project_id)


@app.get("/api/projects/{project_id}/stats")
async def get_project_stats(project_id: str):
    data = read_tasks(project_id)
    tasks = data.get("tasks", [])

    by_status: dict[str, int] = {}
    by_type: dict[str, int] = {}
    by_engine: dict[str, int] = {}
    by_priority: dict[str, int] = {}

    for task in tasks:
        by_status[task.get("status", "pending")] = by_status.get(task.get("status", "pending"), 0) + 1
        by_type[task.get("task_type", "feature")] = by_type.get(task.get("task_type", "feature"), 0) + 1
        eng = task.get("routed_engine") or "auto"
        by_engine[eng] = by_engine.get(eng, 0) + 1
        by_priority[task.get("priority", "medium")] = by_priority.get(task.get("priority", "medium"), 0) + 1

    return {
        "total_tasks": len(tasks),
        "by_status": by_status,
        "by_type": by_type,
        "by_engine": by_engine,
        "by_priority": by_priority,
        "engines": {
            "claude": {
                "healthy": ENGINE_HEALTH["claude"],
                "workers_total": len([w for w in WORKERS if w["engine"] == "claude"]),
                "workers_busy": len([w for w in WORKERS if w["engine"] == "claude" and w["status"] == "busy"]),
            },
            "codex": {
                "healthy": ENGINE_HEALTH["codex"],
                "workers_total": len([w for w in WORKERS if w["engine"] == "codex"]),
                "workers_busy": len([w for w in WORKERS if w["engine"] == "codex" and w["status"] == "busy"]),
            },
        },
        "meta": data.get("meta", {}),
    }


@app.get("/api/projects/{project_id}/events")
async def list_project_events(project_id: str, level: Optional[str] = None, task_id: Optional[str] = None):
    data = read_tasks(project_id)
    events = data.get("events", [])
    result = []
    for event in reversed(events):
        if level and event.get("level") != level:
            continue
        if task_id and event.get("task_id") != task_id:
            continue
        result.append(event)
    return {"events": result[:200]}


@app.post("/api/projects/{project_id}/events/{event_id}/ack")
async def ack_project_event(project_id: str, event_id: str, body: EventAckRequest):
    data = read_tasks(project_id)
    target = None
    for event in data.get("events", []):
        if event.get("id") == event_id:
            target = event
            break
    if not target:
        raise HTTPException(status_code=404, detail="Event not found")
    target["acknowledged"] = True
    target["acknowledged_at"] = _now()
    target["acknowledged_by"] = body.by or "user"
    write_tasks(data, project_id)
    await ws_manager.broadcast({"type": "event_updated", "event": target, "project_id": project_id})
    return target


@app.get("/api/projects/{project_id}/dispatcher/queue")
async def project_dispatcher_queue(project_id: str):
    data = read_tasks(project_id)
    summary: dict[str, int] = {}
    blocked: list[dict[str, Any]] = []
    retries: list[dict[str, Any]] = []
    fallback: list[dict[str, Any]] = []
    for task in data.get("tasks", []):
        st = task.get("status", "pending")
        summary[st] = summary.get(st, 0) + 1
        if task.get("fallback_reason"):
            fallback.append({"task_id": task["id"], "fallback_reason": task.get("fallback_reason"), "routed_engine": task.get("routed_engine") or task.get("engine")})
        if task.get("status") == "failed" and task.get("retry_count", 0) < task.get("max_retries", 3):
            retries.append({"task_id": task["id"], "retry_count": task.get("retry_count", 0), "max_retries": task.get("max_retries", 3), "last_exit_code": task.get("last_exit_code")})
        if st == "pending" and not dependencies_satisfied(task, data):
            blocked.append({"task_id": task["id"], "reason": "dependencies_unmet", "depends_on": task.get("depends_on", [])})
        elif st in {"plan_review", "blocked_by_subtasks"}:
            blocked.append({"task_id": task["id"], "reason": task.get("blocked_reason") or st, "depends_on": task.get("depends_on", [])})
    return {"summary": summary, "total": len(data.get("tasks", [])), "blocked": blocked, "fallback": fallback[:100], "retries": retries[:100], "engines": ENGINE_HEALTH}


# --- WebSocket ---
@app.websocket("/ws/tasks")
async def websocket_tasks(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        while True:
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "127.0.0.1")
    uvicorn.run("main:app", host=host, port=8000, reload=True)
