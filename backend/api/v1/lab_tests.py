"""
Lab Test Scan API endpoints.

Endpoints:
  POST   /scan          – save a lab test scan result
  GET    /scans         – list all scans (with pagination)
  GET    /scan/{id}     – get a single scan by ID
  PATCH  /scan/{id}     – update sync status after cloud upload
"""

from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db
from models.domain import LabTestScan

router = APIRouter()


# ── Request / Response schemas ────────────────────────────────────────────────

class LabTestItem(BaseModel):
    id: str
    name: str
    price: float
    status: str = "Pending"


class CreateLabTestScanRequest(BaseModel):
    tests: list[LabTestItem]
    registration_id: Optional[str] = None
    cloud_storage_path: Optional[str] = None
    cloud_download_url: Optional[str] = None
    sync_status: str = "synced"


class LabTestScanResponse(BaseModel):
    id: str
    registration_id: Optional[str]
    tests_data: list[dict]
    total_amount: int
    cloud_storage_path: Optional[str]
    cloud_download_url: Optional[str]
    sync_status: str
    created_at: str


class PaginatedScansResponse(BaseModel):
    items: list[LabTestScanResponse]
    total: int
    page: int
    page_size: int


class UpdateSyncStatusRequest(BaseModel):
    sync_status: str
    cloud_storage_path: Optional[str] = None
    cloud_download_url: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_response(scan: LabTestScan) -> LabTestScanResponse:
    return LabTestScanResponse(
        id=scan.id,
        registration_id=scan.registration_id,
        tests_data=scan.tests_data or [],
        total_amount=scan.total_amount or 0,
        cloud_storage_path=scan.cloud_storage_path,
        cloud_download_url=scan.cloud_download_url,
        sync_status=scan.sync_status or "synced",
        created_at=scan.created_at.isoformat() if scan.created_at else "",
    )


# ═══════════════════════════════════════════════════════════════════════════════
#  ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════


@router.post("/scan", response_model=LabTestScanResponse)
async def create_lab_test_scan(
    req: CreateLabTestScanRequest,
    db: AsyncSession = Depends(get_db),
):
    """Save a new lab test scan result."""
    total = int(sum(t.price for t in req.tests))
    scan = LabTestScan(
        registration_id=req.registration_id,
        tests_data=[t.model_dump() for t in req.tests],
        total_amount=total,
        cloud_storage_path=req.cloud_storage_path,
        cloud_download_url=req.cloud_download_url,
        sync_status=req.sync_status,
    )
    db.add(scan)
    await db.commit()
    await db.refresh(scan)
    return _to_response(scan)


@router.get("/scans", response_model=PaginatedScansResponse)
async def list_lab_test_scans(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List all lab test scans with pagination."""
    offset = (page - 1) * page_size

    count_q = select(func.count()).select_from(LabTestScan)
    total = (await db.execute(count_q)).scalar() or 0

    q = (
        select(LabTestScan)
        .order_by(LabTestScan.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    result = await db.execute(q)
    scans = result.scalars().all()

    return PaginatedScansResponse(
        items=[_to_response(s) for s in scans],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/scan/{scan_id}", response_model=LabTestScanResponse)
async def get_lab_test_scan(
    scan_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Retrieve a single lab test scan by ID."""
    result = await db.execute(select(LabTestScan).where(LabTestScan.id == scan_id))
    scan = result.scalar_one_or_none()
    if not scan:
        raise HTTPException(status_code=404, detail="Lab test scan not found")
    return _to_response(scan)


@router.patch("/scan/{scan_id}", response_model=LabTestScanResponse)
async def update_lab_test_scan_sync(
    scan_id: str,
    req: UpdateSyncStatusRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update the sync status of a lab test scan (after cloud upload)."""
    result = await db.execute(select(LabTestScan).where(LabTestScan.id == scan_id))
    scan = result.scalar_one_or_none()
    if not scan:
        raise HTTPException(status_code=404, detail="Lab test scan not found")

    scan.sync_status = req.sync_status
    if req.cloud_storage_path:
        scan.cloud_storage_path = req.cloud_storage_path
    if req.cloud_download_url:
        scan.cloud_download_url = req.cloud_download_url

    await db.commit()
    await db.refresh(scan)
    return _to_response(scan)
