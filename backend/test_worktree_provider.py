from __future__ import annotations

from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from backend.worktree_provider import ensure_worktree


class WorktreeProviderTests(TestCase):
    @patch("backend.worktree_provider._git_ensure_worktree")
    def test_git_provider(self, mock_git):
        selected = ensure_worktree(
            repo=Path("/tmp/repo"),
            wt_path=Path("/tmp/repo/.agent-worktrees/w1"),
            branch_name="worker/w1",
            provider="git",
            claude_worktree_cmd=None,
        )
        self.assertEqual(selected, "git")
        mock_git.assert_called_once()

    @patch("backend.worktree_provider._run_claude_worktree_command")
    @patch("backend.worktree_provider._git_ensure_worktree")
    def test_claude_provider_success(self, mock_git, mock_claude):
        selected = ensure_worktree(
            repo=Path("/tmp/repo"),
            wt_path=Path("/tmp/repo/.agent-worktrees/w1"),
            branch_name="worker/w1",
            provider="claude",
            claude_worktree_cmd='claude wt --repo "{repo}" --path "{path}" --branch "{branch}"',
        )
        self.assertEqual(selected, "claude")
        mock_claude.assert_called_once()
        mock_git.assert_not_called()

    @patch("backend.worktree_provider._run_claude_worktree_command", side_effect=ValueError("bad template"))
    @patch("backend.worktree_provider._git_ensure_worktree")
    def test_claude_provider_fallback_to_git_on_error(self, mock_git, _mock_claude):
        selected = ensure_worktree(
            repo=Path("/tmp/repo"),
            wt_path=Path("/tmp/repo/.agent-worktrees/w1"),
            branch_name="worker/w1",
            provider="claude",
            claude_worktree_cmd='claude wt --repo "{repo}" --path "{path}" --branch "{branch}"',
        )
        self.assertEqual(selected, "git")
        mock_git.assert_called_once()

    @patch("backend.worktree_provider._git_ensure_worktree")
    def test_auto_provider_without_command_falls_back_to_git(self, mock_git):
        selected = ensure_worktree(
            repo=Path("/tmp/repo"),
            wt_path=Path("/tmp/repo/.agent-worktrees/w1"),
            branch_name="worker/w1",
            provider="auto",
            claude_worktree_cmd=None,
        )
        self.assertEqual(selected, "git")
        mock_git.assert_called_once()

    @patch("backend.worktree_provider._run_claude_worktree_command")
    @patch("backend.worktree_provider._git_ensure_worktree")
    def test_auto_provider_with_command_prefers_claude(self, mock_git, mock_claude):
        selected = ensure_worktree(
            repo=Path("/tmp/repo"),
            wt_path=Path("/tmp/repo/.agent-worktrees/w1"),
            branch_name="worker/w1",
            provider="auto",
            claude_worktree_cmd='claude wt --repo "{repo}" --path "{path}" --branch "{branch}"',
        )
        self.assertEqual(selected, "claude")
        mock_claude.assert_called_once()
        mock_git.assert_not_called()
