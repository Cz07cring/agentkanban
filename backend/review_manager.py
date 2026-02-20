"""Agent Kanban - Adversarial Review Manager"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from config import MAX_REVIEW_ROUNDS

logger = logging.getLogger("agentkanban.review")


class ReviewManager:
    """Manages adversarial code review workflow."""

    def create_review_task(self, original_task: dict, tasks: list, gen_id_fn) -> dict:
        """Create a review sub-task for a completed development task.

        The review is assigned to the opposite engine:
        - Claude development → Codex review
        - Codex development → Claude review
        """
        dev_engine = original_task.get("routed_engine", "claude")
        review_engine = "codex" if dev_engine == "claude" else "claude"

        review_task = {
            "id": gen_id_fn(),
            "title": f"Review: {original_task['title']}",
            "description": f"Adversarial review of {original_task['id']}: {original_task['description']}",
            "status": "pending",
            "priority": original_task.get("priority", "medium"),
            "task_type": "review",
            "engine": review_engine,
            "routed_engine": review_engine,
            "parent_task_id": original_task["id"],
            "sub_tasks": [],
            "depends_on": [original_task["id"]],
            "plan_mode": False,
            "plan_content": None,
            "assigned_worker": None,
            "worktree_branch": None,
            "review_status": None,
            "review_engine": review_engine,
            "review_result": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "started_at": None,
            "completed_at": None,
            "commit_ids": [],
            "error_log": None,
            "retry_count": 0,
            "max_retries": 3,
        }

        # Update original task to reflect it's under review
        original_task["review_status"] = "pending"
        original_task["review_engine"] = review_engine

        return review_task

    def submit_review(self, task: dict, verdict: str, summary: str, issues: list) -> dict:
        """Process a submitted review result.

        Returns the updated review result dict.
        """
        review_result = {
            "verdict": verdict,
            "summary": summary,
            "issues": issues,
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
            "round": (task.get("retry_count", 0) + 1),
        }

        task["review_result"] = review_result
        task["review_status"] = verdict

        if verdict == "approved":
            task["status"] = "completed"
            task["completed_at"] = datetime.now(timezone.utc).isoformat()
        elif verdict == "changes_requested":
            if task.get("retry_count", 0) < MAX_REVIEW_ROUNDS:
                task["status"] = "pending"  # Send back for revision
                task["retry_count"] = task.get("retry_count", 0) + 1
            else:
                task["status"] = "failed"
                task["error_log"] = f"Max review rounds ({MAX_REVIEW_ROUNDS}) exceeded"
        elif verdict == "needs_discussion":
            task["status"] = "plan_review"  # Needs human input

        return review_result

    def get_review_summary(self, task: dict) -> Optional[dict]:
        """Get review summary for a task."""
        if not task.get("review_result"):
            return None
        result = task["review_result"]
        issues = result.get("issues", [])
        return {
            "verdict": result.get("verdict"),
            "summary": result.get("summary"),
            "total_issues": len(issues),
            "critical": sum(1 for i in issues if i.get("severity") == "critical"),
            "high": sum(1 for i in issues if i.get("severity") == "high"),
            "medium": sum(1 for i in issues if i.get("severity") == "medium"),
            "low": sum(1 for i in issues if i.get("severity") == "low"),
            "round": result.get("round", 1),
        }


# Singleton
review_manager = ReviewManager()
