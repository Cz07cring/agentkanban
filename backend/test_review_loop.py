"""Tests for Review→Fix→Verify auto-loop logic."""
import json
import sys
from pathlib import Path

import pytest

# Ensure backend is on the path
sys.path.insert(0, str(Path(__file__).parent))

from main import _parse_review_json, _apply_review_to_parent


# ---------------------------------------------------------------------------
# _parse_review_json
# ---------------------------------------------------------------------------

class TestParseReviewJson:
    def test_valid_json_block(self):
        text = (
            "Some review text\n"
            "```json\n"
            '{"issues": [{"severity": "high", "file": "main.py", "line": 10, '
            '"description": "bug", "suggestion": "fix it"}], '
            '"summary": "Found 1 issue"}\n'
            "```\n"
            "End of review"
        )
        issues, summary = _parse_review_json(text)
        assert issues is not None
        assert len(issues) == 1
        assert issues[0]["severity"] == "high"
        assert summary == "Found 1 issue"

    def test_empty_issues(self):
        text = '```json\n{"issues": [], "summary": "All good"}\n```'
        issues, summary = _parse_review_json(text)
        assert issues == []
        assert summary == "All good"

    def test_multiple_json_blocks_uses_last(self):
        text = (
            '```json\n{"issues": [{"severity": "low"}], "summary": "first"}\n```\n'
            "More text\n"
            '```json\n{"issues": [{"severity": "critical"}], "summary": "second"}\n```'
        )
        issues, summary = _parse_review_json(text)
        assert issues is not None
        assert issues[0]["severity"] == "critical"
        assert summary == "second"

    def test_no_json_block_returns_none(self):
        text = "Just some plain text review output with no JSON."
        issues, summary = _parse_review_json(text)
        assert issues is None
        assert summary == ""

    def test_malformed_json_returns_none(self):
        text = "```json\n{not valid json}\n```"
        issues, summary = _parse_review_json(text)
        assert issues is None
        assert summary == ""


# ---------------------------------------------------------------------------
# _apply_review_to_parent
# ---------------------------------------------------------------------------

class TestApplyReviewToParent:
    def _make_parent(self, **overrides) -> dict:
        base = {
            "id": "task-001",
            "status": "reviewing",
            "review_status": None,
            "review_round": 0,
            "timeline": [],
            "_review_feedback": None,
            "assigned_worker": "worker-0",
            "started_at": "2026-01-01T00:00:00Z",
            "completed_at": None,
        }
        base.update(overrides)
        return base

    def test_no_critical_issues_approves_parent(self):
        parent = self._make_parent()
        issues = [
            {"severity": "low", "file": "a.py", "line": 1, "description": "minor"},
            {"severity": "medium", "file": "b.py", "line": 2, "description": "ok"},
        ]
        _apply_review_to_parent(issues, "Looks good", parent)

        assert parent["review_status"] == "approved"
        assert parent["status"] == "completed"
        assert parent["completed_at"] is not None

    def test_empty_issues_approves_parent(self):
        parent = self._make_parent()
        _apply_review_to_parent([], "Clean code", parent)

        assert parent["review_status"] == "approved"
        assert parent["status"] == "completed"

    def test_critical_issues_trigger_fix_cycle(self):
        parent = self._make_parent(review_round=0)
        issues = [
            {"severity": "critical", "file": "main.py", "line": 42, "description": "SQL injection"},
        ]
        _apply_review_to_parent(issues, "Security issue", parent)

        assert parent["review_status"] == "changes_requested"
        assert parent["status"] == "pending"
        assert parent["review_round"] == 1
        assert parent["assigned_worker"] is None
        assert parent["started_at"] is None
        assert "SQL injection" in parent["_review_feedback"]

    def test_high_issues_trigger_fix_cycle(self):
        parent = self._make_parent(review_round=0)
        issues = [
            {"severity": "high", "file": "api.py", "line": 10, "description": "Missing auth"},
        ]
        _apply_review_to_parent(issues, "Auth needed", parent)

        assert parent["status"] == "pending"
        assert parent["review_round"] == 1

    def test_max_rounds_escalates_to_plan_review(self):
        # review_round=2 means next round (3) hits MAX_REVIEW_ROUNDS=3
        parent = self._make_parent(review_round=2)
        issues = [
            {"severity": "critical", "file": "x.py", "line": 1, "description": "still broken"},
        ]
        _apply_review_to_parent(issues, "Still failing", parent)

        assert parent["status"] == "plan_review"
        assert parent["blocked_reason"] == "max_review_rounds_exceeded"
        assert parent["review_round"] == 3

    def test_already_completed_parent_stays_completed_on_approval(self):
        parent = self._make_parent(status="completed", completed_at="2026-01-01T12:00:00Z")
        _apply_review_to_parent([], "LGTM", parent)

        assert parent["status"] == "completed"
        # completed_at should not be overwritten
        assert parent["completed_at"] == "2026-01-01T12:00:00Z"

    def test_feedback_includes_all_issues(self):
        parent = self._make_parent()
        issues = [
            {"severity": "critical", "file": "a.py", "line": 1, "description": "issue A"},
            {"severity": "high", "file": "b.py", "line": 2, "description": "issue B"},
            {"severity": "low", "file": "c.py", "line": 3, "description": "issue C"},
        ]
        _apply_review_to_parent(issues, "Multiple problems", parent)

        feedback = parent["_review_feedback"]
        assert "issue A" in feedback
        assert "issue B" in feedback
        assert "issue C" in feedback
        assert "[critical]" in feedback
        assert "[high]" in feedback
        assert "[low]" in feedback
