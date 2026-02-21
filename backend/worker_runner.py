"""Worker CLI runner for Claude/Codex task execution."""
from __future__ import annotations

import asyncio
import inspect
import os
import re
from datetime import datetime, timezone
from typing import Awaitable, Callable, Optional


class WorkerRunner:
    def __init__(self, *, claude_cli: str, codex_cli: str, exec_mode: str = "real"):
        self.claude_cli = claude_cli
        self.codex_cli = codex_cli
        self.exec_mode = exec_mode.lower()

    @staticmethod
    def _clean_env() -> dict[str, str]:
        """Return env dict with CLAUDECODE removed so nested CLI invocations work."""
        env = os.environ.copy()
        env.pop("CLAUDECODE", None)
        return env

    @staticmethod
    def build_prompt(task: dict) -> str:
        base = (
            "你是 Agent Kanban 自动执行 Worker。\\n"
            f"任务ID: {task['id']}\\n"
            f"任务标题: {task['title']}\\n"
            f"任务描述: {task.get('description', '')}\\n"
            f"任务类型: {task.get('task_type')}\\n"
            f"优先级: {task.get('priority')}\\n"
            "请在当前仓库工作目录中完成此任务。"
            "完成后输出简要总结，并尽量输出 commit hash。"
        )
        review_feedback = task.get("_review_feedback")
        if review_feedback:
            base += (
                "\n\n⚠️ 上一轮 Code Review 发现了以下问题，请优先修复：\n"
                f"{review_feedback}\n"
                "修复完成后提交代码。"
            )
        return base

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
    def build_review_prompt(task: dict) -> str:
        """Build a structured-output prompt for adversarial code review."""
        parent_id = task.get("parent_task_id", "unknown")
        return (
            "你是 Agent Kanban 的代码审查 Worker，执行对抗式 Code Review。\n"
            f"任务ID: {task['id']}\n"
            f"审查目标: 任务 {parent_id} 的代码变更\n"
            f"任务描述: {task.get('description', '')}\n\n"
            "请仔细阅读当前仓库中的代码，从以下角度审查：\n"
            "- 逻辑正确性和边界条件\n"
            "- 安全漏洞（注入、越权等）\n"
            "- 错误处理的完整性\n"
            "- 性能问题\n"
            "- 代码风格和可维护性\n\n"
            "完成审查后，你必须在输出末尾附上如下 JSON 块（用 ```json 包裹）：\n"
            "```json\n"
            '{"issues": [\n'
            '  {"severity": "critical|high|medium|low", "file": "路径", "line": 行号, '
            '"description": "问题描述", "suggestion": "修复建议"}\n'
            '], "summary": "一句话总结审查结论"}\n'
            "```\n"
            "severity 只能是 critical/high/medium/low 之一。\n"
            "如果没有发现问题，issues 为空数组即可。"
        )

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
            "--dangerously-skip-permissions",
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
        import logging
        logger = logging.getLogger("agentkanban.worker_runner")

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
        logger.info("Plan generation starting: cmd=%s, cwd=%s", cmd[0], cwd)
        stdout_lines: list[str] = []
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=cwd,
                env=self._clean_env(),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            logger.info("Plan generation process started, pid=%s", proc.pid)
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
            logger.info("Plan generation finished: rc=%s, output_len=%d", rc, len(plan_text))
            if rc == 0 and plan_text:
                await self._maybe_await(on_complete(plan_text))
            else:
                err = (stderr_data.decode("utf-8", errors="ignore") or plan_text or "plan generation failed")[-2000:]
                logger.warning("Plan generation failed: rc=%s, err=%s", rc, err[:200])
                await self._maybe_await(on_fail(err))
        except Exception as exc:  # noqa: BLE001
            logger.error("Plan generation exception: %s", exc)
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
        if task.get("task_type") == "review":
            prompt = self.build_review_prompt(task)
        else:
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
                    env=self._clean_env(),
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
