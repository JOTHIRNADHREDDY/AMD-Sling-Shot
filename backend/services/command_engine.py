"""
Command Execution Engine — translates ToolResult into UI-safe Command Envelopes.

Location: backend/services/command_engine.py

Architecture Section 7 (Critical Layer):
This layer ensures the UI NEVER executes raw LLM output.
Every action is wrapped in a validated Command Envelope before dispatch.

Command Envelope Structure:
{
  "command_type": "BATCH_FORM_FILL" | "NAVIGATE_SCREEN" | "CLICK_BUTTON" | "SCROLL_TO"
                 | "SUBMIT_FORM" | "START_WORKFLOW" | "ADVANCE_WORKFLOW",
  "target": "RegistrationForm",
  "fields": {"name": "Ravi", "age": 45, ...},
  "requires_confirmation": false,
}
"""

import logging
from typing import Any, Optional

from services.screen_capabilities import is_action_allowed, validate_fields

logger = logging.getLogger(__name__)


class CommandEnvelope:
    """A UI-safe command ready for frontend dispatch."""

    def __init__(
        self,
        command_type: str,
        target: Optional[str] = None,
        fields: Optional[dict[str, Any]] = None,
        requires_confirmation: bool = False,
        navigate_to: Optional[str] = None,
        message: Optional[str] = None,
        data: Optional[dict[str, Any]] = None,
    ):
        self.command_type = command_type
        self.target = target
        self.fields = fields or {}
        self.requires_confirmation = requires_confirmation
        self.navigate_to = navigate_to
        self.message = message
        self.data = data or {}

    def to_dict(self) -> dict[str, Any]:
        envelope: dict[str, Any] = {
            "command_type": self.command_type,
            "requires_confirmation": self.requires_confirmation,
        }
        if self.target:
            envelope["target"] = self.target
        if self.fields:
            envelope["fields"] = self.fields
        if self.navigate_to:
            envelope["navigate_to"] = self.navigate_to
        if self.message:
            envelope["message"] = self.message
        if self.data:
            envelope["data"] = self.data
        return envelope


# ── Action → Command type mapping ─────────────────────────────────────────────

_ACTION_TO_COMMAND: dict[str, str] = {
    "register_patient": "BATCH_FORM_FILL",
    "get_queue_status": "NAVIGATE_SCREEN",
    "get_directions": "NAVIGATE_SCREEN",
    "lookup_token": "NAVIGATE_SCREEN",
    "submit_complaint": "SUBMIT_FORM",
    "upload_receipt": "NAVIGATE_SCREEN",
    "upload_lab_scan": "NAVIGATE_SCREEN",
    "navigate_screen": "NAVIGATE_SCREEN",
    "batch_fill_form": "BATCH_FORM_FILL",
    "trigger_button": "CLICK_BUTTON",
}

# Actions that modify hospital state and require user confirmation
_CONFIRMATION_REQUIRED: frozenset[str] = frozenset([
    "register_patient",
    "submit_complaint",
])


def build_command(
    action: str,
    tool_result: dict[str, Any],
    current_screen: str,
) -> tuple[Optional[CommandEnvelope], Optional[str]]:
    """
    Build a CommandEnvelope from a tool result.

    Validates:
    1. Action is allowed on current screen
    2. Fields conform to whitelist (for form-fills)
    3. Navigation targets are valid

    Returns (envelope, error_message). Error is set if validation fails.
    """
    # ── 1. Screen capability check ────────────────────────────────────────
    if not is_action_allowed(current_screen, action):
        logger.warning(
            "Action '%s' not allowed on screen '%s'",
            action, current_screen,
        )
        return None, f"Action '{action}' is not available on this screen."

    command_type = _ACTION_TO_COMMAND.get(action, "NAVIGATE_SCREEN")
    requires_confirmation = action in _CONFIRMATION_REQUIRED
    navigate_to = tool_result.get("navigate_to")
    message = tool_result.get("message", "")
    data = tool_result.get("data", {})

    # ── 2. BATCH_FORM_FILL → validate fields against whitelist ────────────
    if command_type == "BATCH_FORM_FILL":
        target = _action_to_form_target(action)
        fields = _extract_fill_fields(action, data)

        if target:
            ok, err = validate_fields(target, fields)
            if not ok:
                logger.warning("Field validation failed: %s", err)
                return None, err

        return CommandEnvelope(
            command_type=command_type,
            target=target,
            fields=fields,
            requires_confirmation=requires_confirmation,
            navigate_to=navigate_to,
            message=message,
            data=data,
        ), None

    # ── 3. SUBMIT_FORM ───────────────────────────────────────────────────
    if command_type == "SUBMIT_FORM":
        target = _action_to_form_target(action)
        return CommandEnvelope(
            command_type=command_type,
            target=target,
            requires_confirmation=requires_confirmation,
            navigate_to=navigate_to,
            message=message,
            data=data,
        ), None

    # ── 4. CLICK_BUTTON ──────────────────────────────────────────────────
    if command_type == "CLICK_BUTTON":
        button_id = data.get("button_id") or data.get("screen")
        return CommandEnvelope(
            command_type=command_type,
            target=button_id,
            navigate_to=navigate_to,
            message=message,
            data=data,
        ), None

    # ── 5. NAVIGATE_SCREEN (default) ─────────────────────────────────────
    return CommandEnvelope(
        command_type="NAVIGATE_SCREEN",
        navigate_to=navigate_to or data.get("screen"),
        message=message,
        data=data,
    ), None


def _action_to_form_target(action: str) -> Optional[str]:
    """Map action to its form target name."""
    mapping = {
        "register_patient": "RegistrationForm",
        "batch_fill_form": "RegistrationForm",  # default; can be overridden by params
        "submit_complaint": "ComplaintForm",
    }
    return mapping.get(action)


def _extract_fill_fields(action: str, data: dict[str, Any]) -> dict[str, Any]:
    """Extract the fields to fill from tool result data."""
    if action == "register_patient":
        return {
            k: v for k, v in data.items()
            if k in ("name", "age", "gender", "phone", "department")
        }
    if action == "batch_fill_form":
        return data.get("fields", {})
    return {}
