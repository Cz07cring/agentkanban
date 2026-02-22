"""Worktree provider abstraction.

Supports two modes:
- git: use native `git worktree` commands
- claude: delegate to an external Claude Code worktree command, then fallback to git
"""
from __future__ import annotations

import shlex
import shutil
import subprocess
from pathlib import Path
from typing import Callable


LoggerFn = Callable[[str, object], None]
REQUIRED_PLACEHOLDERS = ("{repo}", "{path}", "{branch}")


def _git_ensure_worktree(repo: Path, wt_path: Path, branch_name: str) -> None:
    wt_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        subprocess.run(
            ["git", "worktree", "prune"],
            cwd=str(repo),
            capture_output=True,
            timeout=10,
        )
    except (subprocess.SubprocessError, OSError):
        pass

    branch_check = subprocess.run(
        ["git", "rev-parse", "--verify", branch_name],
        cwd=str(repo),
        capture_output=True,
        timeout=10,
    )

    if branch_check.returncode == 0:
        subprocess.run(
            ["git", "worktree", "add", str(wt_path), branch_name],
            cwd=str(repo),
            capture_output=True,
            check=True,
            timeout=30,
        )
    else:
        subprocess.run(
            ["git", "worktree", "add", "-b", branch_name, str(wt_path)],
            cwd=str(repo),
            capture_output=True,
            check=True,
            timeout=30,
        )


def _validate_claude_template(command_template: str) -> None:
    if not command_template.strip():
        raise ValueError("CLAUDE_WORKTREE_CMD is empty")
    missing = [token for token in REQUIRED_PLACEHOLDERS if token not in command_template]
    if missing:
        raise ValueError(f"CLAUDE_WORKTREE_CMD missing placeholders: {', '.join(missing)}")


def _run_claude_worktree_command(command_template: str, repo: Path, wt_path: Path, branch_name: str) -> None:
    _validate_claude_template(command_template)
    cmd_text = command_template.format(repo=repo, path=wt_path, branch=branch_name)
    cmd = shlex.split(cmd_text)
    if not cmd:
        raise ValueError("CLAUDE_WORKTREE_CMD renders to empty command")
    executable = cmd[0]
    if shutil.which(executable) is None:
        raise FileNotFoundError(f"Claude worktree executable not found: {executable}")

    subprocess.run(
        cmd,
        cwd=str(repo),
        capture_output=True,
        check=True,
        timeout=60,
    )


def ensure_worktree(
    *,
    repo: Path,
    wt_path: Path,
    branch_name: str,
    provider: str,
    claude_worktree_cmd: str | None,
    info: LoggerFn | None = None,
    warning: LoggerFn | None = None,
) -> str:
    """Ensure worktree exists and return selected provider name."""
    provider = (provider or "git").lower()

    if provider == "auto":
        provider = "claude" if claude_worktree_cmd else "git"

    if provider not in {"git", "claude"}:
        if warning:
            warning("Unknown WORKTREE_PROVIDER=%s, fallback to git", provider)
        provider = "git"

    if provider == "claude":
        if claude_worktree_cmd:
            try:
                _run_claude_worktree_command(claude_worktree_cmd, repo, wt_path, branch_name)
                return "claude"
            except (subprocess.SubprocessError, OSError, ValueError, KeyError) as exc:
                if warning:
                    warning("Claude worktree command failed, fallback to git: %s", exc)
        else:
            if info:
                info("WORKTREE_PROVIDER=claude but CLAUDE_WORKTREE_CMD is empty, fallback to git")

    _git_ensure_worktree(repo, wt_path, branch_name)
    return "git"
