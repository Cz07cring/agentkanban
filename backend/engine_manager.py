"""Agent Kanban - Engine Health & Failover Manager"""
from __future__ import annotations

import asyncio
import logging
import shutil
from datetime import datetime, timezone
from typing import Dict, List, Optional

from config import (
    CLAUDE_CLI,
    CODEX_CLI,
    WORKER_HEARTBEAT_TIMEOUT_SEC,
)

logger = logging.getLogger("agentkanban.engine")


class EngineManager:
    """Manages engine health checks and worker failover."""

    def __init__(self):
        self.engine_health: Dict[str, bool] = {"claude": True, "codex": True}
        self.workers: List[dict] = []
        self._running = False

    def init_workers(self, worker_configs: List[dict]):
        """Initialize worker pool from config."""
        now = datetime.now(timezone.utc).isoformat()
        self.workers = []
        for cfg in worker_configs:
            self.workers.append({
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
                "health": {
                    "last_heartbeat": now,
                    "consecutive_failures": 0,
                    "avg_task_duration_ms": 0,
                },
            })

    def get_worker(self, worker_id: str) -> Optional[dict]:
        for w in self.workers:
            if w["id"] == worker_id:
                return w
        return None

    def get_idle_worker(self, engine: str) -> Optional[dict]:
        """Find an idle worker for the given engine type."""
        candidates = [
            w for w in self.workers
            if w["engine"] == engine and w["status"] == "idle"
        ]
        if not candidates:
            return None
        # Prefer worker with fewest failures
        return min(candidates, key=lambda w: w["health"]["consecutive_failures"])

    def assign_worker(self, worker_id: str, task_id: str):
        """Mark a worker as busy with a task."""
        w = self.get_worker(worker_id)
        if w:
            w["status"] = "busy"
            w["current_task_id"] = task_id
            w["started_at"] = datetime.now(timezone.utc).isoformat()

    def release_worker(self, worker_id: str, success: bool = True):
        """Release a worker back to idle."""
        w = self.get_worker(worker_id)
        if w:
            if success:
                w["total_tasks_completed"] += 1
                w["health"]["consecutive_failures"] = 0
            else:
                w["health"]["consecutive_failures"] += 1
            w["status"] = "idle"
            w["current_task_id"] = None
            w["pid"] = None
            w["started_at"] = None
            w["health"]["last_heartbeat"] = datetime.now(timezone.utc).isoformat()

    def check_cli_available(self, engine: str) -> bool:
        """Check if engine CLI binary is available on PATH."""
        cli = CLAUDE_CLI if engine == "claude" else CODEX_CLI
        return shutil.which(cli) is not None

    async def probe_engine_health(self):
        """Probe engine health by checking CLI availability."""
        for engine in ["claude", "codex"]:
            self.engine_health[engine] = self.check_cli_available(engine)

    def get_fallback_engine(self, preferred: str) -> Optional[str]:
        """Get fallback engine if preferred is unhealthy."""
        if self.engine_health.get(preferred, False):
            return preferred
        fallback = "codex" if preferred == "claude" else "claude"
        if self.engine_health.get(fallback, False):
            return fallback
        return None

    def get_engine_stats(self) -> dict:
        """Get engine health and worker stats."""
        result = {}
        for engine in ["claude", "codex"]:
            engine_workers = [w for w in self.workers if w["engine"] == engine]
            result[engine] = {
                "healthy": self.engine_health.get(engine, False),
                "workers_total": len(engine_workers),
                "workers_busy": sum(1 for w in engine_workers if w["status"] == "busy"),
                "workers_idle": sum(1 for w in engine_workers if w["status"] == "idle"),
                "workers_error": sum(1 for w in engine_workers if w["status"] == "error"),
                "total_completed": sum(w["total_tasks_completed"] for w in engine_workers),
            }
        return result

    async def health_check_loop(self, interval: int = 60):
        """Background loop for periodic health checks."""
        self._running = True
        while self._running:
            await self.probe_engine_health()
            # Check for stale workers
            now = datetime.now(timezone.utc)
            for w in self.workers:
                if w["status"] == "busy" and w["health"]["last_heartbeat"]:
                    last = datetime.fromisoformat(w["health"]["last_heartbeat"])
                    if (now - last).total_seconds() > WORKER_HEARTBEAT_TIMEOUT_SEC:
                        logger.warning(f"Worker {w['id']} heartbeat timeout, marking as error")
                        w["status"] = "error"
                        w["health"]["consecutive_failures"] += 1
            await asyncio.sleep(interval)

    def stop(self):
        self._running = False


# Singleton
engine_manager = EngineManager()
