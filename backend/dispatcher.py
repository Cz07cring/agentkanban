"""Agent Kanban - production dispatch and health loops."""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

logger = logging.getLogger("agentkanban.dispatcher")


def _sla_rank(task: dict) -> int:
    return {"urgent": 0, "expedite": 1, "standard": 2}.get(task.get("sla_tier", "standard"), 2)


class DispatchRuntime:
    """Single source-of-truth dispatcher runtime.

    `main.py` owns API composition; this module owns only background loop logic.
    """

    def __init__(
        self,
        *,
        read_tasks: Callable[..., dict],
        write_tasks: Callable[..., None],
        read_projects: Callable[[], dict] | None = None,
        workers: list[dict],
        engine_health: dict[str, bool],
        runtime_executions: dict[str, asyncio.Task],
        route_task: Callable[[dict], str],
        dependencies_satisfied: Callable[[dict, dict], bool],
        ensure_task_shape: Callable[[dict], None],
        append_attempt: Callable[[dict, str, str], None],
        add_timeline: Callable[[dict, str, dict | None], None],
        emit_event: Callable[..., dict],
        broadcast_event: Callable[[dict], Any],
        broadcast_task_event: Callable[[dict, str], Any],
        run_worker_task: Callable[[dict, str, str | None], Any],
        refresh_parent_rollup: Callable[[dict], None],
        update_worker_cli_health: Callable[[], None],
        now_iso: Callable[[], str],
        safe_iso: Callable[[str | None], datetime | None],
        dispatch_interval_sec: int = 5,
        health_interval_sec: int = 30,
        worker_heartbeat_timeout_sec: int = 120,
        worker_cooldown_sec: int = 60,
        worker_max_consecutive_failures: int = 5,
        dispatch_enabled_ref: Callable[[], bool] | None = None,
        dispatch_stats: dict | None = None,
        send_push: Callable[..., Any] | None = None,
    ):
        self.read_tasks = read_tasks
        self.write_tasks = write_tasks
        self.read_projects = read_projects
        self.workers = workers
        self.engine_health = engine_health
        self.runtime_executions = runtime_executions
        self.route_task = route_task
        self.dependencies_satisfied = dependencies_satisfied
        self.ensure_task_shape = ensure_task_shape
        self.append_attempt = append_attempt
        self.add_timeline = add_timeline
        self.emit_event = emit_event
        self.broadcast_event = broadcast_event
        self.broadcast_task_event = broadcast_task_event
        self.run_worker_task = run_worker_task
        self.refresh_parent_rollup = refresh_parent_rollup
        self.update_worker_cli_health = update_worker_cli_health
        self.now_iso = now_iso
        self.safe_iso = safe_iso
        self.dispatch_interval_sec = dispatch_interval_sec
        self.health_interval_sec = health_interval_sec
        self.worker_heartbeat_timeout_sec = worker_heartbeat_timeout_sec
        self.worker_cooldown_sec = worker_cooldown_sec
        self.worker_max_consecutive_failures = worker_max_consecutive_failures
        self._dispatch_enabled_ref = dispatch_enabled_ref or (lambda: True)
        self._dispatch_stats = dispatch_stats or {}
        self._send_push = send_push

    async def dispatch_cycle(self):
        # Collect project IDs to iterate over
        project_ids: list[str | None] = [None]  # None = legacy default
        if self.read_projects:
            try:
                pdata = self.read_projects()
                project_ids = [p["id"] for p in pdata.get("projects", [])]
                if not project_ids:
                    project_ids = [None]
            except Exception:
                pass

        for pid in project_ids:
            await self._dispatch_for_project(pid)

    async def _dispatch_for_project(self, project_id: str | None):
        data = self.read_tasks(project_id) if project_id else self.read_tasks()
        changed = False

        self.refresh_parent_rollup(data)

        idle_workers = [
            w for w in self.workers
            if w.get("status") == "idle" and w.get("cli_available", True)
        ]
        if not idle_workers:
            if not any(self.engine_health.values()):
                event = self.emit_event(
                    data,
                    "alert_triggered",
                    level="critical",
                    message="Both Claude and Codex are unavailable",
                    meta={"engines": self.engine_health.copy()},
                )
                if project_id:
                    self.write_tasks(data, project_id)
                else:
                    self.write_tasks(data)
                await self.broadcast_event(event)
                if self._send_push:
                    asyncio.ensure_future(self._send_push(
                        "引擎全部不可用",
                        "Claude 和 Codex 均不可用，任务无法调度",
                        {"url": "/dashboard"},
                    ))
            return

        now = datetime.now(timezone.utc)
        pending: list[dict] = []
        for task in data.get("tasks", []):
            self.ensure_task_shape(task)
            if task.get("status") != "pending":
                continue
            if task.get("assigned_worker"):
                continue
            if not self.dependencies_satisfied(task, data):
                continue
            # Skip tasks in retry delay window
            retry_after = task.get("retry_after")
            if retry_after:
                retry_dt = self.safe_iso(retry_after)
                if retry_dt and now < retry_dt:
                    continue
            routed = task.get("routed_engine") or self.route_task(task)
            task["routed_engine"] = routed
            pending.append(task)

        pending.sort(key=lambda t: (_sla_rank(t), {"high": 0, "medium": 1, "low": 2}.get(t.get("priority", "medium"), 1), t.get("created_at", "")))

        for task in pending:
            engine = task.get("routed_engine") or self.route_task(task)
            worker = next((w for w in idle_workers if w.get("engine") == engine), None)
            if not worker:
                # Review tasks must NOT fallback to a different engine — it would
                # defeat adversarial cross-engine review (e.g. Claude reviewing its
                # own code instead of Codex reviewing it).
                if task.get("task_type") == "review":
                    continue
                fallback = "codex" if engine == "claude" else "claude"
                worker = next((w for w in idle_workers if w.get("engine") == fallback), None)
                if worker:
                    task["fallback_reason"] = f"no_idle_{engine}"
                    fallback_event = self.emit_event(
                        data,
                        "engine_fallback",
                        level="warning",
                        task_id=task["id"],
                        message=f"Task routed to fallback engine {fallback}",
                        meta={"preferred": engine, "fallback": fallback},
                    )
                    await self.broadcast_event(fallback_event)

            if not worker:
                continue

            lease_id = f"lease-{uuid.uuid4().hex[:12]}"
            task["status"] = "in_progress"
            task["assigned_worker"] = worker["id"]
            task["started_at"] = task.get("started_at") or self.now_iso()
            task["blocked_reason"] = None
            self.add_timeline(task, "task_dispatched", {"worker_id": worker["id"], "lease_id": lease_id})
            self.append_attempt(task, worker["id"], lease_id)

            worker["status"] = "busy"
            worker["current_task_id"] = task["id"]
            worker["current_project_id"] = project_id
            worker["started_at"] = self.now_iso()
            worker["lease_id"] = lease_id
            worker["last_seen_at"] = self.now_iso()
            worker["health"]["last_heartbeat"] = self.now_iso()

            dispatch_event = self.emit_event(
                data,
                "task_dispatched",
                task_id=task["id"],
                worker_id=worker["id"],
                message=f"Task {task['id']} dispatched to {worker['id']}",
                meta={"engine": worker["engine"], "lease_id": lease_id, "project_id": project_id},
            )
            claim_event = self.emit_event(
                data,
                "worker_claimed",
                task_id=task["id"],
                worker_id=worker["id"],
                message="Task claimed by dispatcher",
                meta={"lease_id": lease_id, "source": "dispatch_loop", "project_id": project_id},
            )

            changed = True
            idle_workers = [w for w in idle_workers if w["id"] != worker["id"]]

            if worker["id"] not in self.runtime_executions:
                self.runtime_executions[worker["id"]] = asyncio.create_task(self.run_worker_task(worker, task["id"], project_id))

            await self.broadcast_event(dispatch_event)
            await self.broadcast_event(claim_event)
            await self.broadcast_task_event(task, "task_updated")

            if not idle_workers:
                break

        if changed:
            if project_id:
                self.write_tasks(data, project_id)
            else:
                self.write_tasks(data)

    async def dispatch_loop(self):
        logger.info("Dispatcher loop started")
        while True:
            try:
                if self._dispatch_enabled_ref():
                    await self.dispatch_cycle()
                    self._dispatch_stats["last_cycle_at"] = self.now_iso()
                    self._dispatch_stats["cycle_count"] = self._dispatch_stats.get("cycle_count", 0) + 1
            except Exception as exc:  # noqa: BLE001
                logger.exception("dispatch loop error: %s", exc)
            await asyncio.sleep(self.dispatch_interval_sec)

    async def health_loop(self):
        logger.info("Health loop started")
        while True:
            try:
                self.update_worker_cli_health()
                now = datetime.now(timezone.utc)
                for worker in self.workers:
                    status = worker.get("status")
                    health = worker.get("health", {})
                    last = self.safe_iso(health.get("last_heartbeat"))

                    # Detect stale busy workers
                    if status == "busy" and last:
                        if (now - last).total_seconds() > self.worker_heartbeat_timeout_sec:
                            logger.warning("Worker %s heartbeat timeout, marking error", worker["id"])
                            worker["status"] = "error"
                            worker["current_task_id"] = None
                            worker["lease_id"] = None
                            worker["pid"] = None
                            worker["started_at"] = None
                            health["consecutive_failures"] = health.get("consecutive_failures", 0) + 1
                            worker["_error_at"] = now.isoformat()

                    # Auto-recover error workers after cooldown
                    elif status == "error":
                        consecutive = health.get("consecutive_failures", 0)
                        if consecutive >= self.worker_max_consecutive_failures:
                            # Too many failures - leave disabled, needs manual intervention
                            continue
                        error_at = self.safe_iso(worker.get("_error_at"))
                        if error_at and (now - error_at).total_seconds() >= self.worker_cooldown_sec:
                            logger.info("Worker %s recovered after cooldown (failures=%d)", worker["id"], consecutive)
                            worker["status"] = "idle"
                            worker["_error_at"] = None
                            worker["last_seen_at"] = now.isoformat()
                            health["last_heartbeat"] = now.isoformat()
                            data = self.read_tasks()
                            recovery_event = self.emit_event(
                                data,
                                "worker_recovered",
                                level="info",
                                worker_id=worker["id"],
                                message=f"Worker {worker['id']} auto-recovered after {self.worker_cooldown_sec}s cooldown",
                                meta={"consecutive_failures": consecutive},
                            )
                            self.write_tasks(data)
                            await self.broadcast_event(recovery_event)

            except Exception as exc:  # noqa: BLE001
                logger.exception("health loop error: %s", exc)
            await asyncio.sleep(self.health_interval_sec)
