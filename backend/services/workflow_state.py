"""
Workflow State Machine — deterministic state machine for multi-step operations.

Location: backend/services/workflow_state.py

Architecture Section 9:
Complex operations use deterministic state machines.
LLM may *suggest* transitions; the backend validates legality.
Illegal transitions are rejected.

Example — Complaint Filing:
  IDLE → COLLECTING_DETAILS → CONFIRMATION → SUBMITTED → COMPLETE
"""

import logging
from enum import Enum
from typing import Any, Optional

logger = logging.getLogger(__name__)


class WorkflowState(str, Enum):
    IDLE = "IDLE"
    COLLECTING_DETAILS = "COLLECTING_DETAILS"
    CONFIRMATION = "CONFIRMATION"
    SUBMITTED = "SUBMITTED"
    COMPLETE = "COMPLETE"


# ── Legal transitions ─────────────────────────────────────────────────────────

LEGAL_TRANSITIONS: dict[WorkflowState, frozenset[WorkflowState]] = {
    WorkflowState.IDLE: frozenset([WorkflowState.COLLECTING_DETAILS]),
    WorkflowState.COLLECTING_DETAILS: frozenset([
        WorkflowState.CONFIRMATION,
        WorkflowState.IDLE,  # cancel / reset
    ]),
    WorkflowState.CONFIRMATION: frozenset([
        WorkflowState.SUBMITTED,
        WorkflowState.COLLECTING_DETAILS,  # edit
        WorkflowState.IDLE,                # cancel
    ]),
    WorkflowState.SUBMITTED: frozenset([
        WorkflowState.COMPLETE,
        WorkflowState.IDLE,
    ]),
    WorkflowState.COMPLETE: frozenset([WorkflowState.IDLE]),
}


class WorkflowInstance:
    """A single running workflow (e.g. one complaint, one registration)."""

    def __init__(self, workflow_type: str, initial_data: Optional[dict[str, Any]] = None):
        self.workflow_type = workflow_type
        self.state = WorkflowState.IDLE
        self.data: dict[str, Any] = initial_data or {}

    def can_transition(self, target: WorkflowState) -> bool:
        allowed = LEGAL_TRANSITIONS.get(self.state, frozenset())
        return target in allowed

    def transition(self, target: WorkflowState) -> bool:
        """
        Attempt a state transition.
        Returns True if successful, False if illegal.
        """
        if not self.can_transition(target):
            logger.warning(
                "Illegal workflow transition: %s → %s (workflow=%s)",
                self.state.value,
                target.value,
                self.workflow_type,
            )
            return False
        logger.info(
            "Workflow transition: %s → %s (workflow=%s)",
            self.state.value,
            target.value,
            self.workflow_type,
        )
        self.state = target
        return True

    def update_data(self, fields: dict[str, Any]) -> None:
        """Merge new fields into this workflow's collected data."""
        self.data.update(fields)

    def reset(self) -> None:
        self.state = WorkflowState.IDLE
        self.data = {}

    def to_dict(self) -> dict[str, Any]:
        return {
            "workflow_type": self.workflow_type,
            "state": self.state.value,
            "data": self.data,
        }


# ── Session-level workflow store ──────────────────────────────────────────────

_active_workflows: dict[str, WorkflowInstance] = {}


def get_or_create_workflow(session_id: str, workflow_type: str) -> WorkflowInstance:
    key = f"{session_id}:{workflow_type}"
    if key not in _active_workflows:
        _active_workflows[key] = WorkflowInstance(workflow_type)
    return _active_workflows[key]


def get_workflow(session_id: str, workflow_type: str) -> Optional[WorkflowInstance]:
    return _active_workflows.get(f"{session_id}:{workflow_type}")


def delete_workflow(session_id: str, workflow_type: str) -> None:
    key = f"{session_id}:{workflow_type}"
    _active_workflows.pop(key, None)


def cleanup_session_workflows(session_id: str) -> int:
    """Remove all workflows for a session. Returns count removed."""
    keys = [k for k in _active_workflows if k.startswith(f"{session_id}:")]
    for k in keys:
        del _active_workflows[k]
    return len(keys)
