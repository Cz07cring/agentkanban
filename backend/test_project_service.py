from __future__ import annotations

from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from backend.project_service import (
    ProjectValidationError,
    ensure_project_can_transition,
    ensure_project_unique,
    normalize_project_text,
    summarize_project_tasks,
    validate_git_repo,
)


class ProjectServiceTests(TestCase):
    def test_normalize_project_text(self):
        name, desc, repo = normalize_project_text("  Demo  ", "  test  ", " /tmp/repo ")
        self.assertEqual(name, "Demo")
        self.assertEqual(desc, "test")
        self.assertEqual(repo, "/tmp/repo")

    def test_normalize_requires_name(self):
        with self.assertRaises(ProjectValidationError):
            normalize_project_text("", "", "/tmp/repo")

    @patch("backend.project_service.subprocess.run")
    def test_validate_git_repo(self, mock_run):
        mock_run.return_value.returncode = 0
        repo = validate_git_repo("/tmp")
        self.assertIsInstance(repo, Path)

    def test_ensure_project_unique_detects_name_conflict(self):
        with self.assertRaises(ProjectValidationError):
            ensure_project_unique(
                [{"id": "proj-1", "name": "Demo", "repo_path": "/tmp/repo-a"}],
                name="demo",
                repo_path="/tmp/repo-b",
            )

    def test_ensure_project_unique_detects_repo_conflict(self):
        with self.assertRaises(ProjectValidationError):
            ensure_project_unique(
                [{"id": "proj-1", "name": "A", "repo_path": "/tmp/repo-a"}],
                name="B",
                repo_path="/tmp/repo-a",
            )

    def test_summarize_project_tasks_counts_active(self):
        summary = summarize_project_tasks([
            {"status": "pending"},
            {"status": "in_progress"},
            {"status": "completed"},
            {"status": "failed"},
        ])
        self.assertEqual(summary["total"], 4)
        self.assertEqual(summary["active"], 2)
        self.assertEqual(summary["completed"], 1)
        self.assertEqual(summary["failed"], 1)

    def test_transition_to_completed_rejects_active_tasks(self):
        with self.assertRaises(ProjectValidationError):
            ensure_project_can_transition(
                "active",
                "completed",
                {"total": 3, "active": 1},
            )

    def test_transition_to_completed_allows_when_no_active_tasks(self):
        ensure_project_can_transition(
            "active",
            "completed",
            {"total": 3, "active": 0},
        )

    def test_invalid_transition_rejected(self):
        with self.assertRaises(ProjectValidationError):
            ensure_project_can_transition(
                "completed",
                "active",
                {"total": 0, "active": 0},
            )
