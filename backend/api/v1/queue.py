from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case

from core.database import get_db
from models.domain import QueuePosition
from schemas.api_models import QueueStatusResponse

router = APIRouter()


@router.get("/status", response_model=list[QueueStatusResponse])
async def get_queue_status(db: AsyncSession = Depends(get_db)):
    """
    Live queue status aggregated per department from today's data.
    Falls back to a minimal fallback list if no data exists yet.
    """
    start_of_day = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

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

    result = await db.execute(stmt)
    rows = result.all()

    if not rows:
        # Return configured departments with zero counts so the UI isn't empty
        departments = [
            "General Medicine", "Gastroenterology", "Orthopedics",
            "Cardiology", "Dermatology",
        ]
        return [
            QueueStatusResponse(
                department=d, current_serving=0, total_waiting=0, estimated_wait_time_mins=0
            )
            for d in departments
        ]

    out = []
    for dept, serving, waiting in rows:
        waiting = waiting or 0
        out.append(
            QueueStatusResponse(
                department=dept,
                current_serving=serving or 0,
                total_waiting=waiting,
                estimated_wait_time_mins=max(waiting * 5, 0),
            )
        )
    return out
