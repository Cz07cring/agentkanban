"""Project creation/update validation helpers."""
from __future__ import annotations

import subprocess
from pathlib import Path


class ProjectValidationError(ValueError):
    """Raised when project payload or repo path is invalid."""


ACTIVE_PROJECT_TASK_STATUSES = {
    "pending",
    "in_progress",
    "plan_review",
    "blocked_by_subtasks",
    "reviewing",
}


def normalize_project_text(name: str, description: str, repo_path: str) -> tuple[str, str, str]:
    normalized_name = (name or "").strip()
    normalized_desc = (description or "").strip()
    normalized_repo = (repo_path or "").strip()

    if not normalized_name:
        raise ProjectValidationError("project name is required")
    if not normalized_repo:
        raise ProjectValidationError("repo_path is required")

    return normalized_name, normalized_desc, normalized_repo


def validate_git_repo(repo_path: str) -> Path:
    repo = Path(repo_path).expanduser().resolve()
    if not repo.is_absolute():
        raise ProjectValidationError("repo_path must be absolute")
    if not repo.exists():
        raise ProjectValidationError("repo_path does not exist")
    if not repo.is_dir():
        raise ProjectValidationError("repo_path must be a directory")

    try:
        result = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "--git-dir"],
            capture_output=True,
            timeout=10,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        raise ProjectValidationError(f"failed to validate git repository: {exc}") from exc

    if result.returncode != 0:
        raise ProjectValidationError("repo_path is not a git repository")

    return repo


def ensure_project_unique(projects: list[dict], *, name: str, repo_path: str, ignore_project_id: str | None = None) -> None:
    name_key = name.strip().lower()
    repo_key = str(Path(repo_path).resolve())

    for proj in projects:
        pid = str(proj.get("id", ""))
        if ignore_project_id and pid == ignore_project_id:
            continue
        existing_name = str(proj.get("name", "")).strip().lower()
        existing_repo = str(Path(str(proj.get("repo_path", ""))).resolve()) if proj.get("repo_path") else ""

        if existing_name and existing_name == name_key:
            raise ProjectValidationError("project name already exists")
        if existing_repo and existing_repo == repo_key:
            raise ProjectValidationError("repo_path already bound to another project")


def summarize_project_tasks(tasks: list[dict]) -> dict[str, int]:
    summary = {
        "total": len(tasks),
        "active": 0,
        "pending": 0,
        "in_progress": 0,
        "plan_review": 0,
        "blocked_by_subtasks": 0,
        "reviewing": 0,
        "completed": 0,
        "failed": 0,
    }
    for task in tasks:
        status = task.get("status") or "pending"
        if status in summary:
            summary[status] += 1
        if status in ACTIVE_PROJECT_TASK_STATUSES:
            summary["active"] += 1
    return summary


def ensure_project_can_transition(current_status: str, next_status: str, task_summary: dict[str, int]) -> None:
    if current_status == next_status:
        return

    allowed: dict[str, set[str]] = {
        "draft": {"active", "archived"},
        "active": {"on_hold", "completed", "archived"},
        "on_hold": {"active", "archived"},
        "completed": {"archived"},
        "archived": set(),
    }
    if next_status not in allowed.get(current_status, set()):
        raise ProjectValidationError(f"project status transition not allowed: {current_status} -> {next_status}")

    if next_status == "active" and task_summary.get("total", 0) == 0:
        raise ProjectValidationError("cannot activate project without tasks")
    if next_status == "completed" and task_summary.get("active", 0) > 0:
        raise ProjectValidationError("cannot complete project with active tasks")
    if next_status == "archived" and task_summary.get("active", 0) > 0:
        raise ProjectValidationError("cannot archive project with active tasks")
