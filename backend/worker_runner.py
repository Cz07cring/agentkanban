"""Worker CLI runner for Claude/Codex task execution."""
from __future__ import annotations

import asyncio
import inspect
import re
from datetime import datetime, timezone
from typing import Awaitable, Callable, Optional


class WorkerRunner:
    def __init__(self, *, claude_cli: str, codex_cli: str, exec_mode: str = "real"):
        self.claude_cli = claude_cli
        self.codex_cli = codex_cli
        self.exec_mode = exec_mode.lower()

    @staticmethod
    def build_prompt(task: dict) -> str:
        return (
            "你是 Agent Kanban 自动执行 Worker。\\n"
            f"任务ID: {task['id']}\\n"
            f"任务标题: {task['title']}\\n"
            f"任务描述: {task.get('description', '')}\\n"
            f"任务类型: {task.get('task_type')}\\n"
            f"优先级: {task.get('priority')}\\n"
            "请在当前仓库工作目录中完成此任务。"
            "完成后输出简要总结，并尽量输出 commit hash。"
        )

    def _build_cmd(self, engine: str, prompt: str) -> list[str]:
        if engine == "claude":
            return [
                self.claude_cli,
                "-p",
                prompt,
                "--dangerously-skip-permissions",
                "--output-format",
                "stream-json",
                "--verbose",
            ]
        return [self.codex_cli, "exec", prompt, "--json", "--full-auto"]

    @staticmethod
    def _extract_commit_ids(text: str) -> list[str]:
        if not text:
            return []
        matches = re.findall(r"\b[0-9a-f]{7,40}\b", text.lower())
        seen: set[str] = set()
        out: list[str] = []
        for item in matches:
            if item not in seen:
                seen.add(item)
                out.append(item)
        return out[:20]

    @staticmethod
    async def _maybe_await(value):
        if inspect.isawaitable(value):
            return await value
        return value

    async def run_task(
        self,
        *,
        worker: dict,
        task: dict,
        cwd: str,
        on_complete: Callable[[list[str], Optional[str]], Awaitable[None] | None],
        on_fail: Callable[[str, Optional[int]], Awaitable[None] | None],
        on_release: Callable[[], Awaitable[None] | None],
        on_log: Callable[[str], None] | None = None,
    ):
        prompt = self.build_prompt(task)
        cmd = self._build_cmd(worker["engine"], prompt)

        started_at = datetime.now(timezone.utc)
        stdout_lines: list[str] = []
        stderr = ""
        rc = 1

        try:
            if self.exec_mode == "dry-run":
                await asyncio.sleep(0.2)
                msg = "dry-run completed"
                stdout_lines.append(msg)
                if on_log:
                    on_log(msg)
                rc = 0
            else:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    cwd=cwd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                worker["pid"] = proc.pid

                # Stream stdout line-by-line for real-time logging
                async def _read_stderr():
                    nonlocal stderr
                    if proc.stderr:
                        data = await proc.stderr.read()
                        stderr = data.decode("utf-8", errors="ignore") if data else ""

                stderr_task = asyncio.create_task(_read_stderr())

                if proc.stdout:
                    async for raw_line in proc.stdout:
                        line = raw_line.decode("utf-8", errors="ignore").rstrip("\n\r")
                        stdout_lines.append(line)
                        if on_log:
                            on_log(line)

                await stderr_task
                await proc.wait()
                rc = proc.returncode or 0

            stdout = "\n".join(stdout_lines)

            if rc == 0:
                commit_ids = self._extract_commit_ids(stdout)
                await self._maybe_await(on_complete(commit_ids, stdout[-1000:] if stdout else None))
            else:
                err = (stderr or stdout or "worker execution failed")[-4000:]
                await self._maybe_await(on_fail(err, rc))
        except Exception as exc:  # noqa: BLE001
            await self._maybe_await(on_fail(f"Worker runtime error: {exc}", 255))
        finally:
            worker["pid"] = None
            duration_ms = int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000)
            avg = worker.get("health", {}).get("avg_task_duration_ms", 0)
            if avg <= 0:
                worker["health"]["avg_task_duration_ms"] = duration_ms
            else:
                worker["health"]["avg_task_duration_ms"] = int((avg * 0.8) + (duration_ms * 0.2))
            await self._maybe_await(on_release())
