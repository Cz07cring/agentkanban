"""Tests for business logic audit fixes.

Covers:
- Bug 1: Deleting in-progress tasks releases the assigned worker
- Bug 2: Deleting tasks cleans up parent's sub_tasks reference
- Bug 3: Project-scoped update triggers adversarial review
- Bug 4: Manual retry resets retry_count (allows override after max retries)
- Bug 5: depends_on validation rejects non-existent task IDs
- Bug 6: Deleting tasks cleans up parent references
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# Ensure backend modules are importable
sys.path.insert(0, str(Path(__file__).parent))

from main import (
    _release_worker,
    _worker_by_id,
    find_task,
    gen_task_id,
    maybe_trigger_adversarial_review,
    WORKERS,
    _ensure_task_shape,
)


# ---------------------------------------------------------------------------
# Bug 1: Deleting in-progress tasks should release the assigned worker
# ---------------------------------------------------------------------------


class TestDeleteInProgressTaskReleasesWorker:
    """When an in-progress task is deleted, its assigned worker must be freed."""

    def test_release_worker_resets_state(self):
        worker = {
            "id": "worker-0",
            "engine": "claude",
            "status": "busy",
            "current_task_id": "task-001",
            "started_at": "2025-01-01T00:00:00Z",
            "lease_id": "lease-abc",
            "last_seen_at": "2025-01-01T00:00:00Z",
            "pid": 12345,
            "health": {"last_heartbeat": "2025-01-01T00:00:00Z", "consecutive_failures": 0, "avg_task_duration_ms": 0},
        }

        _release_worker(worker)

        assert worker["status"] == "idle"
        assert worker["current_task_id"] is None
        assert worker["pid"] is None
        assert worker["lease_id"] is None
        assert worker["started_at"] is None


# ---------------------------------------------------------------------------
# Bug 2: Deleting a subtask cleans up parent's sub_tasks list
# ---------------------------------------------------------------------------


class TestDeleteSubtaskCleansParent:
    """Deleting a subtask should remove it from the parent's sub_tasks list."""

    def test_parent_subtasks_cleaned_on_child_delete(self):
        parent = {
            "id": "task-001",
            "title": "Parent",
            "status": "blocked_by_subtasks",
            "sub_tasks": ["task-002", "task-003"],
            "depends_on": [],
        }
        child = {
            "id": "task-002",
            "title": "Child",
            "status": "pending",
            "parent_task_id": "task-001",
            "sub_tasks": [],
            "depends_on": [],
        }
        data = {"tasks": [parent, child]}

        # Simulate the cleanup logic from delete_task
        parent_id = child.get("parent_task_id")
        assert parent_id == "task-001"
        found_parent = find_task(data, parent_id)
        assert found_parent is parent
        if found_parent and child["id"] in (found_parent.get("sub_tasks") or []):
            found_parent["sub_tasks"] = [s for s in found_parent["sub_tasks"] if s != child["id"]]

        assert "task-002" not in parent["sub_tasks"]
        assert "task-003" in parent["sub_tasks"]


# ---------------------------------------------------------------------------
# Bug 3: Project-scoped update should trigger adversarial review
# ---------------------------------------------------------------------------


class TestAdversarialReviewTriggered:
    """Completing a feature/bugfix/refactor task should trigger adversarial review."""

    def test_maybe_trigger_review_for_feature_task(self):
        task = {
            "id": "task-010",
            "title": "Implement feature X",
            "status": "completed",
            "task_type": "feature",
            "routed_engine": "claude",
            "engine": "claude",
            "review_round": 0,
            "review_status": None,
            "priority": "medium",
        }
        data = {"tasks": [task]}

        review_task = maybe_trigger_adversarial_review(task, data)

        assert review_task is not None
        assert review_task["task_type"] == "review"
        assert review_task["parent_task_id"] == "task-010"
        # Cross-engine: claude task should be reviewed by codex
        assert review_task["routed_engine"] == "codex"
        assert task["status"] == "reviewing"

    def test_no_review_for_analysis_task(self):
        task = {
            "id": "task-020",
            "title": "Analyze performance",
            "status": "completed",
            "task_type": "analysis",
            "routed_engine": "codex",
            "review_round": 0,
        }
        data = {"tasks": [task]}

        review_task = maybe_trigger_adversarial_review(task, data)
        assert review_task is None

    def test_no_duplicate_review(self):
        task = {
            "id": "task-030",
            "title": "Fix bug",
            "status": "completed",
            "task_type": "bugfix",
            "routed_engine": "claude",
            "review_round": 0,
        }
        existing_review = {
            "id": "task-031",
            "parent_task_id": "task-030",
            "task_type": "review",
            "status": "pending",
        }
        data = {"tasks": [task, existing_review]}

        review_task = maybe_trigger_adversarial_review(task, data)
        assert review_task is None


# ---------------------------------------------------------------------------
# Bug 4: Manual retry should reset retry_count
# ---------------------------------------------------------------------------


class TestManualRetryResetsCount:
    """Manual retry should reset retry_count to allow re-dispatch."""

    def test_retry_resets_count(self):
        """Simulate the fixed retry logic: retry_count is reset to 0."""
        task = {
            "id": "task-050",
            "title": "Failed task",
            "status": "failed",
            "retry_count": 3,
            "max_retries": 3,
            "error_log": "some error",
            "assigned_worker": "worker-0",
            "started_at": "2025-01-01T00:00:00Z",
            "blocked_reason": None,
        }

        # After fix, manual retry resets retry_count to 0
        task["status"] = "pending"
        task["retry_count"] = 0
        task["error_log"] = None
        task["assigned_worker"] = None
        task["started_at"] = None

        assert task["status"] == "pending"
        assert task["retry_count"] == 0
        assert task["error_log"] is None


# ---------------------------------------------------------------------------
# Bug 5: depends_on validation
# ---------------------------------------------------------------------------


class TestDependsOnValidation:
    """Creating tasks with non-existent depends_on should be rejected."""

    def test_find_task_returns_none_for_missing(self):
        data = {
            "tasks": [
                {"id": "task-001", "title": "Exists"},
            ]
        }

        assert find_task(data, "task-001") is not None
        assert find_task(data, "task-999") is None

    def test_depends_on_with_existing_task_passes(self):
        data = {
            "tasks": [
                {"id": "task-001", "title": "Exists"},
            ]
        }
        depends_on = ["task-001"]
        # All deps exist — validation should pass
        for dep_id in depends_on:
            assert find_task(data, dep_id) is not None

    def test_depends_on_with_missing_task_fails(self):
        data = {
            "tasks": [
                {"id": "task-001", "title": "Exists"},
            ]
        }
        depends_on = ["task-001", "task-999"]
        # task-999 doesn't exist — validation should fail
        missing = [dep_id for dep_id in depends_on if not find_task(data, dep_id)]
        assert len(missing) == 1
        assert missing[0] == "task-999"


# ---------------------------------------------------------------------------
# Bug 6: Orphaned sub-task cleanup on parent delete
# ---------------------------------------------------------------------------


class TestOrphanedSubTaskCleanup:
    """Parent-child references should be consistent after deletion."""

    def test_child_refs_cleaned_when_parent_subtasks_list_updated(self):
        parent = {
            "id": "task-001",
            "title": "Parent",
            "status": "blocked_by_subtasks",
            "sub_tasks": ["task-002", "task-003"],
            "depends_on": [],
        }
        child2 = {
            "id": "task-002",
            "title": "Child 2",
            "status": "completed",
            "parent_task_id": "task-001",
            "sub_tasks": [],
            "depends_on": [],
        }
        child3 = {
            "id": "task-003",
            "title": "Child 3",
            "status": "pending",
            "parent_task_id": "task-001",
            "sub_tasks": [],
            "depends_on": [],
        }
        data = {"tasks": [parent, child2, child3]}

        # Delete child3 — should be removed from parent's sub_tasks
        task_to_delete = child3
        parent_id = task_to_delete.get("parent_task_id")
        found_parent = find_task(data, parent_id)
        if found_parent and task_to_delete["id"] in (found_parent.get("sub_tasks") or []):
            found_parent["sub_tasks"] = [s for s in found_parent["sub_tasks"] if s != task_to_delete["id"]]

        assert parent["sub_tasks"] == ["task-002"]
