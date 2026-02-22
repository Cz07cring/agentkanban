"""Agent Kanban - Pydantic request/response models."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class PlanQuestion(BaseModel):
    question: str
    options: list[str]
    selected: Optional[int] = None


class ReviewIssue(BaseModel):
    severity: str
    file: str
    line: int
    description: str
    suggestion: str


class ReviewResult(BaseModel):
    issues: list[ReviewIssue] = Field(default_factory=list)
    summary: Optional[str] = None


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    engine: Literal["auto", "claude", "codex"] = "auto"
    plan_mode: bool = False
    priority: Literal["high", "medium", "low"] = "medium"
    task_type: Optional[Literal["feature", "bugfix", "review", "refactor", "analysis", "plan", "audit"]] = None
    depends_on: list[str] = Field(default_factory=list)
    plan_questions: list[PlanQuestion] = Field(default_factory=list)
    risk_level: Literal["low", "medium", "high"] = "medium"
    sla_tier: Literal["standard", "expedite", "urgent"] = "standard"
    acceptance_criteria: list[str] = Field(default_factory=list)
    rollback_plan: Optional[str] = None


class TaskUpdate(BaseModel):
    status: Optional[Literal[
        "pending", "in_progress", "plan_review", "blocked_by_subtasks",
        "reviewing", "completed", "failed", "cancelled"
    ]] = None
    title: Optional[str] = Field(default=None, max_length=200)
    description: Optional[str] = Field(default=None, max_length=5000)
    priority: Optional[Literal["high", "medium", "low"]] = None
    engine: Optional[Literal["auto", "claude", "codex"]] = None
    routed_engine: Optional[Literal["claude", "codex"]] = None
    plan_mode: Optional[bool] = None
    plan_content: Optional[str] = None
    plan_questions: Optional[list[PlanQuestion]] = None
    risk_level: Optional[Literal["low", "medium", "high"]] = None
    sla_tier: Optional[Literal["standard", "expedite", "urgent"]] = None
    acceptance_criteria: Optional[list[str]] = None
    rollback_plan: Optional[str] = None
    assigned_worker: Optional[str] = None
    error_log: Optional[str] = None
    commit_ids: Optional[list[str]] = None
    review_status: Optional[str] = None
    review_engine: Optional[str] = None
    review_result: Optional[ReviewResult] = None
    depends_on: Optional[list[str]] = None
    sub_tasks: Optional[list[str]] = None
    worktree_branch: Optional[str] = None
    retry_count: Optional[int] = None
    max_retries: Optional[int] = None
    blocked_reason: Optional[str] = None
    fallback_reason: Optional[str] = None
    review_round: Optional[int] = None
    last_exit_code: Optional[int] = None


class DispatchRequest(BaseModel):
    worker_id: Optional[str] = None
    engine: Optional[str] = Field(default=None, pattern="^(claude|codex)$")
    allow_plan_tasks: bool = False


class EngineHealthUpdate(BaseModel):
    healthy: bool


class PlanApproval(BaseModel):
    approved: bool
    feedback: Optional[str] = None


class SubTaskInput(BaseModel):
    title: str
    description: str = ""
    task_type: str = "feature"
    engine: str = "auto"
    priority: str = "medium"


class DecomposeRequest(BaseModel):
    sub_tasks: list[SubTaskInput]


class WorkerUpdate(BaseModel):
    status: Optional[str] = None
    current_task_id: Optional[str] = None


class ClaimRequest(BaseModel):
    worker_id: str


class HeartbeatRequest(BaseModel):
    worker_id: str
    lease_id: Optional[str] = None


class CompleteRequest(BaseModel):
    worker_id: str
    lease_id: Optional[str] = None
    commit_ids: list[str] = Field(default_factory=list)
    summary: Optional[str] = None


class FailRequest(BaseModel):
    worker_id: str
    lease_id: Optional[str] = None
    error_log: str
    exit_code: Optional[int] = None


class EventAckRequest(BaseModel):
    by: Optional[str] = None


# --- Project models ---
class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = Field(default="", max_length=2000)
    repo_path: str = Field(..., min_length=1)
    status: Literal["draft", "active", "on_hold"] = "draft"
    init_brief: Optional[dict[str, Any]] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = Field(default=None, max_length=2000)
    repo_path: Optional[str] = None
    status: Optional[Literal["draft", "active", "on_hold", "completed", "archived"]] = None
