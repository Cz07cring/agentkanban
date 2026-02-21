"""Agent Kanban - Configuration (single source of truth)."""
from __future__ import annotations

import os
from pathlib import Path

# --- Paths ---
DATA_DIR = Path(__file__).parent / "data"
TASKS_FILE = DATA_DIR / "dev-tasks.json"
LOCK_FILE = DATA_DIR / "dev-task.lock"

# --- Dispatcher ---
DISPATCH_INTERVAL_SEC = int(os.getenv("DISPATCH_INTERVAL_SEC", "5"))
HEALTH_INTERVAL_SEC = int(os.getenv("HEALTH_INTERVAL_SEC", "30"))

# --- Engines ---
CLAUDE_CLI = os.getenv("CLAUDE_CLI", "claude")
CODEX_CLI = os.getenv("CODEX_CLI", "codex")

# --- Workers ---
WORKER_HEARTBEAT_TIMEOUT_SEC = int(os.getenv("WORKER_HEARTBEAT_TIMEOUT_SEC", "120"))
WORKER_COOLDOWN_SEC = int(os.getenv("WORKER_COOLDOWN_SEC", "60"))
WORKER_MAX_CONSECUTIVE_FAILURES = int(os.getenv("WORKER_MAX_CONSECUTIVE_FAILURES", "5"))
WORKER_EXEC_MODE = os.getenv("WORKER_EXEC_MODE", "real").lower()

# --- Retry / Review ---
AUTO_RETRY_DELAY_SEC = int(os.getenv("AUTO_RETRY_DELAY_SEC", "10"))
MAX_REVIEW_ROUNDS = int(os.getenv("MAX_REVIEW_ROUNDS", "3"))

# --- CORS ---
ALLOWED_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

# --- Routing rules ---
ROUTING_RULES = [
    {"task_type": "feature", "keywords": ["开发", "实现", "新增", "添加", "创建", "implement", "add", "create"], "preferred_engine": "claude", "fallback_engine": "codex"},
    {"task_type": "review", "keywords": ["review", "审查", "检查", "code review", "PR review"], "preferred_engine": "codex", "fallback_engine": "claude"},
    {"task_type": "refactor", "keywords": ["重构", "优化", "refactor", "cleanup", "整理"], "preferred_engine": "codex", "fallback_engine": "claude"},
    {"task_type": "bugfix", "keywords": ["修复", "bug", "fix", "错误", "异常", "crash"], "preferred_engine": "claude", "fallback_engine": "codex"},
    {"task_type": "analysis", "keywords": ["分析", "审计", "analyze", "audit", "检测", "扫描"], "preferred_engine": "codex", "fallback_engine": "claude"},
    {"task_type": "plan", "keywords": ["计划", "拆解", "设计", "plan", "design", "架构"], "preferred_engine": "claude", "fallback_engine": "codex"},
]

PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}
TASK_TYPES = {"feature", "bugfix", "review", "refactor", "analysis", "plan", "audit"}

# --- Initial worker pool ---
INITIAL_WORKERS = [
    {"id": "worker-0", "engine": "claude", "port": 5200, "capabilities": ["feature", "bugfix", "plan"]},
    {"id": "worker-1", "engine": "claude", "port": 5201, "capabilities": ["feature", "bugfix", "plan"]},
    {"id": "worker-2", "engine": "claude", "port": 5202, "capabilities": ["feature", "bugfix", "plan"]},
    {"id": "worker-3", "engine": "codex", "port": 5203, "capabilities": ["review", "refactor", "analysis", "audit"]},
    {"id": "worker-4", "engine": "codex", "port": 5204, "capabilities": ["review", "refactor", "analysis", "audit"]},
]


def build_workers() -> list[dict]:
    """Generate full in-memory worker state from INITIAL_WORKERS template."""
    workers = []
    for cfg in INITIAL_WORKERS:
        workers.append({
            "id": cfg["id"],
            "engine": cfg["engine"],
            "port": cfg["port"],
            "worktree_path": f"/app/worktrees/{cfg['id']}",
            "status": "idle",
            "capabilities": cfg["capabilities"],
            "current_task_id": None,
            "pid": None,
            "started_at": None,
            "total_tasks_completed": 0,
            "lease_id": None,
            "last_seen_at": None,
            "cli_available": False,
            "health": {
                "last_heartbeat": None,
                "consecutive_failures": 0,
                "avg_task_duration_ms": 0,
            },
        })
    return workers
