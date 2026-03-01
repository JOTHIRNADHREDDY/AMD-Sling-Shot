"""
JSON Validator — validates LLM output against strict Pydantic schemas.

Location: backend/services/json_validator.py

Responsibilities:
- Parse raw LLM JSON output
- Validate against action whitelist
- Type-check parameters via Pydantic models
- Return typed, safe action descriptors
"""

import json
import logging
from typing import Any, Optional

from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger(__name__)

# ── Allowed actions (whitelist) ───────────────────────────────────────────────

ALLOWED_ACTIONS = frozenset({
    "register_patient",
    "get_queue_status",
    "get_directions",
    "lookup_token",
    "submit_complaint",
    "upload_receipt",
    "upload_lab_scan",
    "navigate_screen",
    "batch_fill_form",
    "trigger_button",
    "clarify",
})

# ── Parameter schemas per action ──────────────────────────────────────────────


class RegisterPatientParams(BaseModel):
    name: str = Field(..., min_length=1)
    age: str = Field(..., min_length=1)
    gender: str = Field(default="Male")
    phone: str = Field(default="")
    department: str = Field(..., min_length=1)
    language: str = Field(default="en")


class GetQueueStatusParams(BaseModel):
    department: Optional[str] = None


class GetDirectionsParams(BaseModel):
    from_node: str = Field(default="Kiosk")
    to_node: str = Field(..., min_length=1)


class LookupTokenParams(BaseModel):
    token_number: str = Field(..., min_length=1)


class SubmitComplaintParams(BaseModel):
    complaint_text: str = Field(..., min_length=1)
    department: Optional[str] = None


class UploadReceiptParams(BaseModel):
    registration_id: str = Field(..., min_length=1)


class UploadLabScanParams(BaseModel):
    registration_id: Optional[str] = None
    patient_id: Optional[str] = None


class NavigateScreenParams(BaseModel):
    screen: str = Field(..., min_length=1)


class BatchFillFormParams(BaseModel):
    target: str = Field(default="RegistrationForm", min_length=1)
    fields: dict[str, Any] = Field(default_factory=dict)


class TriggerButtonParams(BaseModel):
    button_id: str = Field(..., min_length=1)


# ── Map action → parameter schema ────────────────────────────────────────────

ACTION_SCHEMAS: dict[str, type[BaseModel]] = {
    "register_patient": RegisterPatientParams,
    "get_queue_status": GetQueueStatusParams,
    "get_directions": GetDirectionsParams,
    "lookup_token": LookupTokenParams,
    "submit_complaint": SubmitComplaintParams,
    "upload_receipt": UploadReceiptParams,
    "upload_lab_scan": UploadLabScanParams,
    "navigate_screen": NavigateScreenParams,
    "batch_fill_form": BatchFillFormParams,
    "trigger_button": TriggerButtonParams,
}


# ── Validated action model ────────────────────────────────────────────────────


class LLMAction(BaseModel):
    """The validated output from the LLM."""
    action: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    message: Optional[str] = None  # populated when action == "clarify"
    confidence: Optional[str] = Field(None, description="Confidence score: high, medium, or low")
    suggestions: Optional[list[str]] = Field(None, description="Array of 2-3 short suggestion chips")


class ValidationResult(BaseModel):
    success: bool
    action: Optional[LLMAction] = None
    error: Optional[str] = None


# ── Public API ────────────────────────────────────────────────────────────────


def validate_llm_output(raw_text: str) -> ValidationResult:
    """
    Parse and validate the raw LLM JSON output.

    Expected format:
        {"action": "tool_name", "parameters": {...}}
    or:
        {"action": "clarify", "message": "..."}

    Returns a ValidationResult with either a valid LLMAction or an error.
    """
    # 1. Parse JSON
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as e:
        logger.warning("LLM output is not valid JSON: %s", e)
        return ValidationResult(success=False, error=f"Invalid JSON: {e}")

    if not isinstance(data, dict):
        return ValidationResult(success=False, error="LLM output must be a JSON object")

    # 2. Extract action
    action_name = data.get("action")
    if not action_name or not isinstance(action_name, str):
        return ValidationResult(success=False, error="Missing or invalid 'action' field")

    # 3. Whitelist check
    if action_name not in ALLOWED_ACTIONS:
        logger.warning("LLM tried disallowed action: %s", action_name)
        return ValidationResult(
            success=False,
            error=f"Action '{action_name}' is not allowed",
        )

    # 4. Handle clarification — also preserve any partial parameters the LLM included
    if action_name == "clarify":
        message = data.get("message", "Could you please clarify?")
        # Allow the LLM to pass along collected data (e.g. {"name": "Rajesh"})
        # so partial_registration stays up-to-date between clarify steps
        partial_params = data.get("parameters", {})
        if not isinstance(partial_params, dict):
            partial_params = {}
        return ValidationResult(
            success=True,
            action=LLMAction(
                action=action_name, 
                message=str(message),
                parameters=partial_params,
                confidence=data.get("confidence"),
                suggestions=data.get("suggestions", []),
            ),
        )

    # 5. Validate parameters against the Pydantic schema
    params = data.get("parameters", {})
    if not isinstance(params, dict):
        return ValidationResult(success=False, error="'parameters' must be an object")

    schema_cls = ACTION_SCHEMAS.get(action_name)
    if schema_cls:
        try:
            validated = schema_cls(**params)
            params = validated.model_dump()
        except ValidationError as e:
            logger.warning("Parameter validation failed for %s: %s", action_name, e)
            return ValidationResult(
                success=False,
                error=f"Parameter validation failed: {e.errors()}",
            )

    return ValidationResult(
        success=True,
        action=LLMAction(
            action=action_name, 
            parameters=params,
            confidence=data.get("confidence"),
            suggestions=data.get("suggestions", []),
        ),
    )
