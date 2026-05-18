"""
OP Registration endpoints — stores patients, creates queue tokens,
and provides a lookup-by-token for QR scanning.
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from core.database import get_db
from models.domain import OPRegistration, QueuePosition
from schemas.api_models import (
    RegistrationRequest,
    RegistrationResponse,
    PatientLookupResponse,
)

router = APIRouter()


def _generate_token(department: str, position: int) -> str:
    """Human-friendly token: first letter of dept + zero-padded position."""
    prefix = department[0].upper() if department else "A"
    return f"{prefix}-{position:03d}"


@router.post("/register", response_model=RegistrationResponse)
async def register_patient(req: RegistrationRequest, db: AsyncSession = Depends(get_db)):
    """
    1. Create an OP registration row.
    2. Find the next queue position for the department.
    3. Return token number + queue info.
    """
    reg_id = str(uuid.uuid4())

    # Build the OP registration
    registration = OPRegistration(
        id=reg_id,
        patient_id=None,           # kiosk patients are anonymous (no User row)
        branch_id=None,
        form_data={
            "name": req.name,
            "age": req.age,
            "gender": req.gender,
            "phone": req.phone,
            "department": req.department,
            "language": req.language,
        },
        status="registered",
        created_at=datetime.utcnow(),
    )
    db.add(registration)

    # Determine the next queue position for this department today
    start_of_day = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(func.count(QueuePosition.id)).where(
            QueuePosition.department == req.department,
            QueuePosition.created_at >= start_of_day,
        )
    )
    count_today: int = result.scalar() or 0
    new_position = count_today + 1

    token_number = _generate_token(req.department, new_position)

    queue_entry = QueuePosition(
        id=str(uuid.uuid4()),
        registration_id=reg_id,
        department=req.department,
        position=new_position,
        status="waiting",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(queue_entry)
    await db.commit()

    # Estimate wait: ~5 min per person ahead
    people_ahead = new_position - 1
    estimated_wait = max(people_ahead * 5, 0)

    return RegistrationResponse(
        registration_id=reg_id,
        token_number=token_number,
        department=req.department,
        position=new_position,
        estimated_wait_time_mins=estimated_wait,
        patient_name=req.name,
        patient_age=req.age,
        patient_gender=req.gender,
        patient_phone=req.phone,
        language=req.language,
        created_at=datetime.utcnow().isoformat(),
    )


@router.get("/lookup/{token_number}", response_model=PatientLookupResponse)
async def lookup_by_token(token_number: str, db: AsyncSession = Depends(get_db)):
    """
    Called when the QR code / token is scanned.
    Returns full patient details + current queue position.
    """
    # Token format: "C-003" → department starts with C, position 3
    # We need to find the QueuePosition that matches
    start_of_day = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    # Parse token
    parts = token_number.split("-")
    if len(parts) != 2:
        raise HTTPException(status_code=404, detail="Invalid token format")

    try:
        position_num = int(parts[1])
    except ValueError:
        raise HTTPException(status_code=404, detail="Invalid token format")

    dept_prefix = parts[0].upper()

    # Find the queue entry
    result = await db.execute(
        select(QueuePosition).where(
            QueuePosition.position == position_num,
            QueuePosition.created_at >= start_of_day,
            QueuePosition.department.ilike(f"{dept_prefix}%"),
        )
    )
    queue_entry = result.scalars().first()

    if not queue_entry:
        raise HTTPException(status_code=404, detail="Token not found for today")

    # Load registration
    reg_result = await db.execute(
        select(OPRegistration).where(OPRegistration.id == queue_entry.registration_id)
    )
    registration = reg_result.scalars().first()
    if not registration:
        raise HTTPException(status_code=404, detail="Registration not found")

    form = registration.form_data or {}

    # People currently ahead
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

    return PatientLookupResponse(
        registration_id=registration.id,
        token_number=token_number,
        department=queue_entry.department,
        position=queue_entry.position,
        queue_status=queue_entry.status,
        estimated_wait_time_mins=estimated_wait,
        patient_name=form.get("name", ""),
        patient_age=form.get("age", ""),
        patient_gender=form.get("gender", ""),
        patient_phone=form.get("phone", ""),
        language=form.get("language", "en"),
        created_at=registration.created_at.isoformat() if registration.created_at else "",
    )
