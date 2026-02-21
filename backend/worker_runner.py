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
    def build_plan_prompt(task: dict) -> str:
        """Build a read-only prompt for AI plan generation."""
        return (
            "你是 Agent Kanban 的计划生成助手，工作在只读模式下。\n"
            f"任务ID: {task['id']}\n"
            f"任务标题: {task['title']}\n"
            f"任务描述: {task.get('description', '')}\n"
            f"任务类型: {task.get('task_type')}\n\n"
            "请探索当前代码仓库，理解相关上下文，然后输出一个详细的有编号的实施计划。\n"
            "要求:\n"
            "- 每一步都以数字和点开头（如 '1. 做某事'）\n"
            "- 步骤应具体可执行，聚焦代码改动\n"
            "- 最多输出 8 个步骤\n"
            "- 不要输出任何代码，只输出计划步骤\n"
            "只输出计划内容，不要有任何前缀说明或附加内容。"
        )

    def _build_plan_cmd(self, prompt: str) -> list[str]:
        """Build a restricted Claude CLI command for read-only plan generation."""
        return [
            self.claude_cli,
            "-p",
            prompt,
            "--allowedTools",
            "Read,Glob,Grep",
            "--output-format",
            "text",
        ]

    async def run_plan_generation(
        self,
        *,
        task: dict,
        cwd: str,
        on_complete: Callable[[str], Awaitable[None] | None],
        on_fail: Callable[[str], Awaitable[None] | None],
    ) -> None:
        """Run Claude in read-only mode to generate a plan. Calls on_complete(plan_text) on success."""
        prompt = self.build_plan_prompt(task)

        if self.exec_mode == "dry-run":
            await asyncio.sleep(0.5)
            fake_plan = (
                f"1. 分析 {task['title']} 的需求和上下文\n"
                "2. 识别需要修改的关键文件\n"
                "3. 实施核心逻辑变更\n"
                "4. 编写单元测试覆盖新功能\n"
                "5. 运行构建验证无错误\n"
                "6. 提交代码并验证"
            )
            await self._maybe_await(on_complete(fake_plan))
            return

        cmd = self._build_plan_cmd(prompt)
        stdout_lines: list[str] = []
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=cwd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            if proc.stdout:
                async for raw_line in proc.stdout:
                    line = raw_line.decode("utf-8", errors="ignore").rstrip("\n\r")
                    stdout_lines.append(line)

            stderr_data = b""
            if proc.stderr:
                stderr_data = await proc.stderr.read()

            await proc.wait()
            rc = proc.returncode or 0

            plan_text = "\n".join(stdout_lines).strip()
            if rc == 0 and plan_text:
                await self._maybe_await(on_complete(plan_text))
            else:
                err = (stderr_data.decode("utf-8", errors="ignore") or plan_text or "plan generation failed")[-2000:]
                await self._maybe_await(on_fail(err))
        except Exception as exc:  # noqa: BLE001
            await self._maybe_await(on_fail(f"Plan generation runtime error: {exc}"))

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
