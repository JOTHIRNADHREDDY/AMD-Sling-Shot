"""
Screen Capability Matrix — defines allowed actions and fields per screen.

Location: backend/services/screen_capabilities.py

Architecture Section 11 — Safety Controls:
• Action whitelist per screen
• Field-level edit control per form target
• Screen capability validation before any command is dispatched

The LLM may suggest any action, but the backend enforces the screen capability
matrix before generating a Command Envelope.
"""

from typing import Optional

# ── Allowed command types per screen ──────────────────────────────────────────

SCREEN_ALLOWED_ACTIONS: dict[str, frozenset[str]] = {
    "HOME": frozenset([
        "navigate_screen",
    ]),
    "REGISTRATION": frozenset([
        "navigate_screen",
        "register_patient",
        "batch_fill_form",
        "trigger_button",
    ]),
    "QUEUE": frozenset([
        "navigate_screen",
        "get_queue_status",
        "lookup_token",
    ]),
    "NAVIGATION": frozenset([
        "navigate_screen",
        "get_directions",
    ]),
    "COMPLAINT": frozenset([
        "navigate_screen",
        "submit_complaint",
        "batch_fill_form",
    ]),
    "LANGUAGE": frozenset([
        "navigate_screen",
        "trigger_button",
    ]),
    "RECEIPT": frozenset([
        "navigate_screen",
        "upload_receipt",
        "trigger_button",
    ]),
    "LAB_TESTS": frozenset([
        "navigate_screen",
        "upload_lab_scan",
        "trigger_button",
    ]),
}

# ── Field whitelists per form target ──────────────────────────────────────────

FIELD_WHITELIST: dict[str, frozenset[str]] = {
    "RegistrationForm": frozenset(["name", "age", "gender", "phone", "department"]),
    "ComplaintForm": frozenset(["complaint_text", "department"]),
}

# Actions that are always allowed regardless of current screen (global navigation)
GLOBAL_ACTIONS: frozenset[str] = frozenset([
    "navigate_screen",
    "clarify",
    "get_queue_status",
    "get_directions",
    "lookup_token",
])


def is_action_allowed(screen: str, action: str) -> bool:
    """Check whether *action* is permitted on *screen*."""
    if action in GLOBAL_ACTIONS:
        return True
    allowed = SCREEN_ALLOWED_ACTIONS.get(screen.upper(), frozenset())
    return action in allowed


def get_allowed_actions(screen: str) -> list[str]:
    """Return sorted list of actions allowed on *screen* (including globals)."""
    allowed = set(SCREEN_ALLOWED_ACTIONS.get(screen.upper(), set()))
    allowed |= GLOBAL_ACTIONS
    return sorted(allowed)


def validate_fields(target: str, fields: dict) -> tuple[bool, Optional[str]]:
    """
    Validate that all field keys in *fields* are in the whitelist for *target*.
    Returns (ok, error_message).
    """
    whitelist = FIELD_WHITELIST.get(target)
    if whitelist is None:
        return False, f"Unknown form target: {target}"
    illegal = set(fields.keys()) - whitelist
    if illegal:
        return False, f"Fields not allowed on {target}: {', '.join(sorted(illegal))}"
    return True, None
