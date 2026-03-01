"""
LLM Tools Registry — tool implementations for all LLM-invokable actions.

Location: backend/services/llm_tools.py

Each tool:
- Accepts structured, validated parameters
- Calls internal business logic (existing API endpoints / DB operations)
- Returns a typed response dict for the orchestrator

The LLM never writes to the DB directly — tools do.
"""

import uuid
import logging
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import select, func, case
from sqlalchemy.ext.asyncio import AsyncSession

from models.domain import OPRegistration, QueuePosition
from schemas.api_models import (
    RegistrationResponse,
    QueueStatusResponse,
    MapDirectionResponse,
    RouteStep,
    PatientLookupResponse,
)

logger = logging.getLogger(__name__)


# ── Tool result wrapper ───────────────────────────────────────────────────────


class ToolResult:
    """Standardised result from any tool execution."""

    def __init__(
        self,
        success: bool,
        data: Optional[dict[str, Any]] = None,
        message: Optional[str] = None,
        navigate_to: Optional[str] = None,
        localization_key: Optional[str] = None,
        localization_params: Optional[dict[str, Any]] = None,
    ):
        self.success = success
        self.data = data or {}
        self.message = message or ""
        self.navigate_to = navigate_to
        self.localization_key = localization_key
        self.localization_params = localization_params or {}

    def to_dict(self) -> dict[str, Any]:
        result = {
            "success": self.success,
            "message": self.message,
            "data": self.data,
        }
        if self.navigate_to:
            result["navigate_to"] = self.navigate_to
        if self.localization_key:
            result["_loc_key"] = self.localization_key
            result["_loc_params"] = self.localization_params
        return result


# ═══════════════════════════════════════════════════════════════════════════════
#  TOOL IMPLEMENTATIONS
# ═══════════════════════════════════════════════════════════════════════════════


def _generate_token(department: str, position: int) -> str:
    prefix = department[0].upper() if department else "A"
    return f"{prefix}-{position:03d}"


async def register_patient_tool(params: dict[str, Any], db: AsyncSession) -> ToolResult:
    """Register a new outpatient and assign a queue token."""
    try:
        name = params.get("name", "")
        age = params.get("age", "")
        gender = params.get("gender", "Male")
        phone = params.get("phone", "")
        department = params.get("department", "General Medicine")
        language = params.get("language", "en")

        reg_id = str(uuid.uuid4())

        registration = OPRegistration(
            id=reg_id,
            patient_id=None,
            branch_id=None,
            form_data={
                "name": name,
                "age": age,
                "gender": gender,
                "phone": phone,
                "department": department,
                "language": language,
            },
            status="registered",
            created_at=datetime.utcnow(),
        )
        db.add(registration)

        start_of_day = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        result = await db.execute(
            select(func.count(QueuePosition.id)).where(
                QueuePosition.department == department,
                QueuePosition.created_at >= start_of_day,
            )
        )
        count_today: int = result.scalar() or 0
        new_position = count_today + 1
        token_number = _generate_token(department, new_position)

        queue_entry = QueuePosition(
            id=str(uuid.uuid4()),
            registration_id=reg_id,
            department=department,
            position=new_position,
            status="waiting",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(queue_entry)
        await db.commit()

        people_ahead = new_position - 1
        estimated_wait = max(people_ahead * 5, 0)

        return ToolResult(
            success=True,
            data={
                "registration_id": reg_id,
                "token_number": token_number,
                "department": department,
                "position": new_position,
                "estimated_wait_time_mins": estimated_wait,
                "patient_name": name,
                "patient_age": age,
                "patient_gender": gender,
                "patient_phone": phone,
                "language": language,
                "created_at": datetime.utcnow().isoformat(),
            },
            message=f"Registration successful! Your token is {token_number}. "
                    f"Position {new_position} in {department}. "
                    f"Estimated wait: {estimated_wait} minutes.",
            navigate_to="RECEIPT",
            localization_key="registration_success",
            localization_params={
                "token": token_number,
                "position": new_position,
                "department": department,
                "wait": estimated_wait,
            },
        )
    except Exception as e:
        logger.error("register_patient_tool failed: %s", e)
        return ToolResult(success=False, message=f"Registration failed: {str(e)}")


async def get_queue_status_tool(params: dict[str, Any], db: AsyncSession) -> ToolResult:
    """Fetch live queue status, optionally filtered by department."""
    try:
        start_of_day = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        department = params.get("department")

        stmt = (
            select(
                QueuePosition.department,
                func.max(
                    case(
                        (QueuePosition.status == "serving", QueuePosition.position),
                        else_=0,
                    )
                ).label("current_serving"),
                func.sum(
                    case(
                        (QueuePosition.status == "waiting", 1),
                        else_=0,
                    )
                ).label("total_waiting"),
            )
            .where(QueuePosition.created_at >= start_of_day)
            .group_by(QueuePosition.department)
        )

        if department:
            stmt = stmt.where(QueuePosition.department == department)

        result = await db.execute(stmt)
        rows = result.all()

        if not rows:
            departments = [
                "General Medicine", "Gastroenterology", "Orthopedics",
                "Cardiology", "Dermatology",
            ]
            queue_data = [
                {"department": d, "current_serving": 0, "total_waiting": 0, "estimated_wait_time_mins": 0}
                for d in departments
            ]
            return ToolResult(
                success=True,
                data={"queue": queue_data},
                message="No patients in queue yet today.",
                navigate_to="QUEUE",
                localization_key="no_queue",
            )

        queue_data = []
        for dept, serving, waiting in rows:
            waiting = waiting or 0
            queue_data.append({
                "department": dept,
                "current_serving": serving or 0,
                "total_waiting": waiting,
                "estimated_wait_time_mins": max(waiting * 5, 0),
            })

        dept_summary = ", ".join(
            f"{q['department']}: {q['total_waiting']} waiting (~{q['estimated_wait_time_mins']} min)"
            for q in queue_data
        )

        return ToolResult(
            success=True,
            data={"queue": queue_data},
            message=f"Current queue status: {dept_summary}",
            navigate_to="QUEUE",
            localization_key="queue_status",
            localization_params={"summary": dept_summary},
        )
    except Exception as e:
        logger.error("get_queue_status_tool failed: %s", e)
        return ToolResult(success=False, message=f"Failed to get queue status: {str(e)}")


async def get_directions_tool(params: dict[str, Any], db: AsyncSession) -> ToolResult:
    """Get wayfinding directions to a destination."""
    try:
        from_node = params.get("from_node", "Kiosk")
        to_node = params.get("to_node", "")

        # For now, return mock Dijkstra-based directions
        # In production, this would query a graph database
        directions = {
            "from_node": from_node,
            "to_node": to_node,
            "total_distance_meters": 150,
            "estimated_time_mins": 3,
            "steps": [
                {"instruction": f"Walk straight from {from_node}.", "distance_meters": 50, "direction": "straight"},
                {"instruction": "Turn left at the reception.", "distance_meters": 20, "direction": "left"},
                {"instruction": "Take the elevator to floor 2.", "distance_meters": 10, "direction": "elevator_up"},
                {"instruction": f"Walk to {to_node}.", "distance_meters": 70, "direction": "straight"},
            ],
        }

        return ToolResult(
            success=True,
            data={"directions": directions},
            message=f"Directions from {from_node} to {to_node}: about {directions['estimated_time_mins']} minutes walk.",
            navigate_to="NAVIGATION",
            localization_key="directions",
            localization_params={"to_node": to_node, "time": directions['estimated_time_mins']},
        )
    except Exception as e:
        logger.error("get_directions_tool failed: %s", e)
        return ToolResult(success=False, message=f"Failed to get directions: {str(e)}")


def _normalize_token(raw: str) -> str:
    """Normalize token formats: 'D001' → 'D-001', 'd-001' → 'D-001'."""
    import re
    raw = raw.strip().upper()
    # Already in correct format
    if re.match(r'^[A-Z]-\d{3}$', raw):
        return raw
    # Missing hyphen: D001 → D-001
    m = re.match(r'^([A-Z])(\d{3})$', raw)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    # Spaced: D 001 or D 0 0 1
    m = re.match(r'^([A-Z])\s*[-]?\s*(\d)\s*(\d)\s*(\d)$', raw)
    if m:
        return f"{m.group(1)}-{m.group(2)}{m.group(3)}{m.group(4)}"
    return raw


async def lookup_token_tool(params: dict[str, Any], db: AsyncSession) -> ToolResult:
    """Look up a patient's status by token number."""
    try:
        token_number = params.get("token_number", "")
        start_of_day = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

        # Normalize token: "D001" → "D-001", "d-001" → "D-001"
        token_number = _normalize_token(token_number)

        parts = token_number.split("-")
        if len(parts) != 2:
            return ToolResult(success=False, message="Invalid token format. Expected format: D-001")

        try:
            position_num = int(parts[1])
        except ValueError:
            return ToolResult(success=False, message="Invalid token format.")

        dept_prefix = parts[0].upper()

        result = await db.execute(
            select(QueuePosition).where(
                QueuePosition.position == position_num,
                QueuePosition.created_at >= start_of_day,
                QueuePosition.department.ilike(f"{dept_prefix}%"),
            )
        )
        queue_entry = result.scalars().first()

        if not queue_entry:
            return ToolResult(success=False, message=f"Token {token_number} not found for today.")

        reg_result = await db.execute(
            select(OPRegistration).where(OPRegistration.id == queue_entry.registration_id)
        )
        registration = reg_result.scalars().first()
        if not registration:
            return ToolResult(success=False, message="Registration not found.")

        form = registration.form_data or {}

        ahead_result = await db.execute(
            select(func.count(QueuePosition.id)).where(
                QueuePosition.department == queue_entry.department,
                QueuePosition.created_at >= start_of_day,
                QueuePosition.status == "waiting",
                QueuePosition.position < queue_entry.position,
            )
        )
        people_ahead: int = ahead_result.scalar() or 0
        estimated_wait = max(people_ahead * 5, 0)

        return ToolResult(
            success=True,
            data={
                "registration_id": registration.id,
                "token_number": token_number,
                "department": queue_entry.department,
                "position": queue_entry.position,
                "queue_status": queue_entry.status,
                "estimated_wait_time_mins": estimated_wait,
                "patient_name": form.get("name", ""),
                "patient_age": form.get("age", ""),
                "patient_gender": form.get("gender", ""),
                "patient_phone": form.get("phone", ""),
                "language": form.get("language", "en"),
                "created_at": registration.created_at.isoformat() if registration.created_at else "",
            },
            message=f"Token {token_number}: {form.get('name', 'Patient')} in {queue_entry.department}, "
                    f"position {queue_entry.position}, status: {queue_entry.status}, "
                    f"estimated wait: {estimated_wait} minutes.",
            navigate_to="QUEUE",
            localization_key="token_found",
            localization_params={
                "token": token_number,
                "name": form.get("name", "Patient"),
                "department": queue_entry.department,
                "position": queue_entry.position,
                "wait": estimated_wait,
            },
        )
    except Exception as e:
        logger.error("lookup_token_tool failed: %s", e)
        return ToolResult(success=False, message=f"Token lookup failed: {str(e)}")


async def submit_complaint_tool(params: dict[str, Any], db: AsyncSession) -> ToolResult:
    """Submit a patient complaint."""
    try:
        complaint_text = params.get("complaint_text", "")
        department = params.get("department")

        # In production, this would persist to a complaints table
        logger.info(
            "Complaint submitted: text=%s, department=%s",
            complaint_text[:100],
            department,
        )

        return ToolResult(
            success=True,
            data={
                "complaint_id": str(uuid.uuid4()),
                "complaint_text": complaint_text,
                "department": department,
                "status": "submitted",
                "submitted_at": datetime.utcnow().isoformat(),
            },
            message="Your complaint has been submitted successfully. Our team will look into it.",
            navigate_to="COMPLAINT",
            localization_key="complaint_success",
        )
    except Exception as e:
        logger.error("submit_complaint_tool failed: %s", e)
        return ToolResult(success=False, message=f"Failed to submit complaint: {str(e)}")


async def upload_receipt_tool(params: dict[str, Any], db: AsyncSession) -> ToolResult:
    """Trigger receipt upload for a registration."""
    try:
        registration_id = params.get("registration_id", "")

        return ToolResult(
            success=True,
            data={"registration_id": registration_id},
            message="Please use the upload button to submit your receipt image.",
            navigate_to="RECEIPT",
        )
    except Exception as e:
        logger.error("upload_receipt_tool failed: %s", e)
        return ToolResult(success=False, message=f"Receipt upload failed: {str(e)}")


async def upload_lab_scan_tool(params: dict[str, Any], db: AsyncSession) -> ToolResult:
    """Navigate to lab scan upload."""
    try:
        return ToolResult(
            success=True,
            data={
                "registration_id": params.get("registration_id"),
                "patient_id": params.get("patient_id"),
            },
            message="Please use the scanner or upload button to submit your lab test document.",
            navigate_to="LAB_TESTS",
        )
    except Exception as e:
        logger.error("upload_lab_scan_tool failed: %s", e)
        return ToolResult(success=False, message=f"Lab scan upload failed: {str(e)}")


async def navigate_screen_tool(params: dict[str, Any], db: AsyncSession) -> ToolResult:
    """Navigate the kiosk UI to a specific screen."""
    screen = params.get("screen", "HOME")
    valid_screens = {"HOME", "REGISTRATION", "QUEUE", "NAVIGATION", "COMPLAINT", "LANGUAGE", "RECEIPT", "LAB_TESTS"}

    if screen.upper() not in valid_screens:
        return ToolResult(
            success=False,
            message=f"Unknown screen: {screen}. Available: {', '.join(sorted(valid_screens))}",
        )

    return ToolResult(
        success=True,
        data={"screen": screen.upper()},
        message=f"Navigating to {screen.replace('_', ' ').title()} screen.",
        navigate_to=screen.upper(),
    )


async def batch_fill_form_tool(params: dict[str, Any], db: AsyncSession) -> ToolResult:
    """
    Batch-fill a form with multiple fields at once.
    Architecture Section 7 — Command Execution Engine.
    """
    target = params.get("target", "RegistrationForm")
    fields = params.get("fields", {})

    if not fields:
        return ToolResult(success=False, message="No fields provided for form fill.")

    screen_map = {
        "RegistrationForm": "REGISTRATION",
        "ComplaintForm": "COMPLAINT",
    }
    navigate_to = screen_map.get(target)

    return ToolResult(
        success=True,
        data={"target": target, "fields": fields},
        message=f"Filling {len(fields)} field(s) in {target}.",
        navigate_to=navigate_to,
    )


async def trigger_button_tool(params: dict[str, Any], db: AsyncSession) -> ToolResult:
    """
    Trigger a named button on the current screen.
    Architecture Section 7 — Command Execution Engine.
    """
    button_id = params.get("button_id", "")

    if not button_id:
        return ToolResult(success=False, message="No button specified.")

    return ToolResult(
        success=True,
        data={"button_id": button_id},
        message=f"Triggering button: {button_id}.",
    )


# ═══════════════════════════════════════════════════════════════════════════════
#  TOOL REGISTRY
# ═══════════════════════════════════════════════════════════════════════════════

TOOLS = {
    "register_patient": register_patient_tool,
    "get_queue_status": get_queue_status_tool,
    "get_directions": get_directions_tool,
    "lookup_token": lookup_token_tool,
    "submit_complaint": submit_complaint_tool,
    "upload_receipt": upload_receipt_tool,
    "upload_lab_scan": upload_lab_scan_tool,
    "navigate_screen": navigate_screen_tool,
    "batch_fill_form": batch_fill_form_tool,
    "trigger_button": trigger_button_tool,
}


async def execute_tool(
    action: str,
    parameters: dict[str, Any],
    db: AsyncSession,
) -> ToolResult:
    """
    Execute a tool by name.
    
    This is the single entry point for all tool execution.
    The action must be in the TOOLS registry.
    """
    tool_fn = TOOLS.get(action)
    if not tool_fn:
        logger.error("No tool registered for action: %s", action)
        return ToolResult(success=False, message=f"Unknown action: {action}")

    logger.info("Executing tool: %s with params: %s", action, parameters)
    return await tool_fn(parameters, db)
