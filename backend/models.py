"""Agent Kanban - Pydantic Models"""
from __future__ import annotations

from typing import Any, List, Optional

from pydantic import BaseModel, Field


# --- Request models ---

class TaskCreate(BaseModel):
    title: str
    description: str = ""
    engine: str = "auto"
    plan_mode: bool = False
    priority: str = "medium"
    task_type: Optional[str] = None


class TaskUpdate(BaseModel):
    status: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    engine: Optional[str] = None
    plan_mode: Optional[bool] = None
    plan_content: Optional[str] = None
    assigned_worker: Optional[str] = None
    error_log: Optional[str] = None
    review_status: Optional[str] = None
    review_result: Optional[dict] = None


class PlanApproval(BaseModel):
    approved: bool
    feedback: Optional[str] = None


class DecomposeRequest(BaseModel):
    sub_tasks: List[SubTaskInput]


class SubTaskInput(BaseModel):
    title: str
    description: str = ""
    task_type: str = "feature"
    engine: str = "auto"
    priority: str = "medium"


class WorkerUpdate(BaseModel):
    status: Optional[str] = None
    current_task_id: Optional[str] = None


class ReviewSubmit(BaseModel):
    """Submitted by a review worker when review is complete."""
    verdict: str  # approved, changes_requested, needs_discussion
    summary: str
    issues: List[ReviewIssueInput] = []


class ReviewIssueInput(BaseModel):
    severity: str  # critical, high, medium, low
    file: str
    line: int = 0
    description: str
    suggestion: str = ""
