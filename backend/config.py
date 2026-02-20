"""Agent Kanban - Configuration Management"""
from __future__ import annotations

import os
from pathlib import Path

# --- Paths ---
DATA_DIR = Path(__file__).parent / "data"
TASKS_FILE = DATA_DIR / "dev-tasks.json"
LOCK_FILE = DATA_DIR / "dev-task.lock"

# --- Dispatcher ---
DISPATCHER_ENABLED = os.getenv("DISPATCHER_ENABLED", "false").lower() == "true"
DISPATCHER_INTERVAL_SEC = int(os.getenv("DISPATCHER_INTERVAL_SEC", "10"))

# --- Engines ---
CLAUDE_CLI = os.getenv("CLAUDE_CLI", "claude")
CODEX_CLI = os.getenv("CODEX_CLI", "codex")

# --- Workers ---
WORKER_HEARTBEAT_INTERVAL_SEC = 30
WORKER_HEARTBEAT_TIMEOUT_SEC = 120

# --- Review ---
MAX_REVIEW_ROUNDS = 3

# --- Routing rules ---
ROUTING_RULES = [
    {"task_type": "feature", "keywords": ["开发", "实现", "新增", "添加", "创建", "implement", "add", "create"], "preferred_engine": "claude", "fallback_engine": "codex"},
    {"task_type": "review", "keywords": ["review", "审查", "检查", "code review", "PR review"], "preferred_engine": "codex", "fallback_engine": "claude"},
    {"task_type": "refactor", "keywords": ["重构", "优化", "refactor", "cleanup", "整理"], "preferred_engine": "codex", "fallback_engine": "claude"},
    {"task_type": "bugfix", "keywords": ["修复", "bug", "fix", "错误", "异常", "crash"], "preferred_engine": "claude", "fallback_engine": "codex"},
    {"task_type": "analysis", "keywords": ["分析", "审计", "analyze", "audit", "检测", "扫描"], "preferred_engine": "codex", "fallback_engine": "claude"},
    {"task_type": "plan", "keywords": ["计划", "拆解", "设计", "plan", "design", "架构"], "preferred_engine": "claude", "fallback_engine": "codex"},
]

# --- Initial worker pool ---
INITIAL_WORKERS = [
    {"id": "worker-0", "engine": "claude", "port": 5200, "capabilities": ["feature", "bugfix", "plan"]},
    {"id": "worker-1", "engine": "claude", "port": 5201, "capabilities": ["feature", "bugfix", "plan"]},
    {"id": "worker-2", "engine": "claude", "port": 5202, "capabilities": ["feature", "bugfix", "plan"]},
    {"id": "worker-3", "engine": "codex", "port": 5203, "capabilities": ["review", "refactor", "analysis", "audit"]},
    {"id": "worker-4", "engine": "codex", "port": 5204, "capabilities": ["review", "refactor", "analysis", "audit"]},
]
