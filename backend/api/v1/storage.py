"""
Cloud Storage API endpoints — enhanced edition.

Endpoints:
  POST   /receipt              – upload receipt (multipart)
  POST   /receipt/base64       – upload receipt (base64 string)
  POST   /document             – upload generic document
  POST   /lab-report           – upload lab report
  GET    /url                  – get signed download URL
  GET    /metadata             – get file metadata
  PATCH  /metadata             – update custom metadata
  GET    /exists               – check if file exists
  POST   /copy                 – copy a file
  POST   /move                 – move a file
  GET    /list                 – list files (paths only)
  GET    /list/detailed        – list files with metadata
  DELETE /file                 – delete a single file
  DELETE /files                – batch-delete multiple files
"""

import base64
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from pydantic import BaseModel

from core.firebase_storage import (
    upload_receipt,
    upload_document,
    upload_lab_report,
    get_download_url,
    get_file_metadata,
    update_metadata,
    file_exists,
    copy_file,
    move_file,
    delete_file,
    delete_files,
    list_files,
    list_files_with_metadata,
    StorageValidationError,
)

router = APIRouter()

# ── Response schemas ──────────────────────────────────────────────────────────


class UploadResponse(BaseModel):
    download_url: str
    storage_path: str
    file_name: Optional[str] = None


class FileListResponse(BaseModel):
    files: list[str]


class FileMetadataResponse(BaseModel):
    name: Optional[str] = None
    size: Optional[int] = None
    content_type: Optional[str] = None
    time_created: Optional[str] = None
    updated: Optional[str] = None
    custom_metadata: dict = {}


class DetailedFileItem(BaseModel):
    path: str
    size: Optional[int] = None
    content_type: Optional[str] = None
    time_created: Optional[str] = None


class DetailedFileListResponse(BaseModel):
    files: list[DetailedFileItem]


class BatchDeleteRequest(BaseModel):
    paths: list[str]


class BatchDeleteResponse(BaseModel):
    deleted: list[str]
    errors: list[dict] = []


# ── Shared error handler ─────────────────────────────────────────────────────

def _handle_storage_error(exc: Exception, default_status: int = 503):
    """Convert known exceptions to appropriate HTTP errors."""
    if isinstance(exc, StorageValidationError):
        raise HTTPException(status_code=422, detail=str(exc))
    if isinstance(exc, FileNotFoundError):
        raise HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, RuntimeError):
        raise HTTPException(status_code=503, detail=str(exc))
    raise HTTPException(status_code=default_status, detail=str(exc))


# ═══════════════════════════════════════════════════════════════════════════════
#  RECEIPT UPLOAD
# ═══════════════════════════════════════════════════════════════════════════════


@router.post("/receipt", response_model=UploadResponse)
async def upload_receipt_endpoint(
    registration_id: str = Form(...),
    file: UploadFile = File(...),
):
    """Upload a receipt image (PNG/JPEG) for a registration."""
    data = await file.read()
    content_type = file.content_type or "image/png"
    try:
        result = upload_receipt(registration_id, data, content_type)
    except Exception as exc:
        _handle_storage_error(exc)
    return UploadResponse(download_url=result["download_url"], storage_path=result["storage_path"])


class ReceiptBase64Request(BaseModel):
    registration_id: str
    image_base64: str
    content_type: str = "image/png"


@router.post("/receipt/base64", response_model=UploadResponse)
async def upload_receipt_base64(req: ReceiptBase64Request):
    """Upload a receipt as a base-64 encoded string (from canvas.toDataURL)."""
    raw = req.image_base64
    if "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        data = base64.b64decode(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 payload")
    try:
        result = upload_receipt(req.registration_id, data, req.content_type)
    except Exception as exc:
        _handle_storage_error(exc)
    return UploadResponse(download_url=result["download_url"], storage_path=result["storage_path"])


# ═══════════════════════════════════════════════════════════════════════════════
#  DOCUMENT UPLOAD
# ═══════════════════════════════════════════════════════════════════════════════


@router.post("/document", response_model=UploadResponse)
async def upload_document_endpoint(
    file: UploadFile = File(...),
    subfolder: str = Form("documents"),
):
    """Upload a generic document (PDF, image, etc.)."""
    data = await file.read()
    content_type = file.content_type or "application/octet-stream"
    try:
        result = upload_document(data, file.filename or "unnamed", content_type, subfolder)
    except Exception as exc:
        _handle_storage_error(exc)
    return UploadResponse(**result)


# ═══════════════════════════════════════════════════════════════════════════════
#  LAB REPORT UPLOAD
# ═══════════════════════════════════════════════════════════════════════════════


@router.post("/lab-report", response_model=UploadResponse)
async def upload_lab_report_endpoint(
    patient_id: str = Form(...),
    file: UploadFile = File(...),
):
    """Upload a lab report PDF/image for a patient."""
    data = await file.read()
    content_type = file.content_type or "application/pdf"
    try:
        result = upload_lab_report(data, file.filename or "report", content_type, patient_id)
    except Exception as exc:
        _handle_storage_error(exc)
    return UploadResponse(**result)


# ═══════════════════════════════════════════════════════════════════════════════
#  DOWNLOAD URL
# ═══════════════════════════════════════════════════════════════════════════════


@router.get("/url")
async def get_file_url(
    storage_path: str = Query(...),
    expiry_mins: int = Query(60, ge=1, le=1440),
):
    """Return a signed download URL for a stored file (configurable expiry)."""
    try:
        url = get_download_url(storage_path, expiry_mins)
    except Exception as exc:
        _handle_storage_error(exc, 404)
    return {"download_url": url, "expires_in_mins": expiry_mins}


# ═══════════════════════════════════════════════════════════════════════════════
#  METADATA
# ═══════════════════════════════════════════════════════════════════════════════


@router.get("/metadata", response_model=FileMetadataResponse)
async def get_metadata_endpoint(storage_path: str = Query(...)):
    """Retrieve metadata for a stored file."""
    try:
        meta = get_file_metadata(storage_path)
    except Exception as exc:
        _handle_storage_error(exc, 404)
    return FileMetadataResponse(**meta)


class UpdateMetadataRequest(BaseModel):
    storage_path: str
    metadata: dict


@router.patch("/metadata")
async def update_metadata_endpoint(req: UpdateMetadataRequest):
    """Update custom metadata on an existing file."""
    try:
        updated = update_metadata(req.storage_path, req.metadata)
    except Exception as exc:
        _handle_storage_error(exc, 404)
    return {"storage_path": req.storage_path, "metadata": updated}


# ═══════════════════════════════════════════════════════════════════════════════
#  EXISTENCE CHECK
# ═══════════════════════════════════════════════════════════════════════════════


@router.get("/exists")
async def check_file_exists(storage_path: str = Query(...)):
    """Check whether a file exists in Cloud Storage."""
    try:
        exists = file_exists(storage_path)
    except Exception as exc:
        _handle_storage_error(exc)
    return {"exists": exists, "storage_path": storage_path}


# ═══════════════════════════════════════════════════════════════════════════════
#  COPY / MOVE
# ═══════════════════════════════════════════════════════════════════════════════


class CopyMoveRequest(BaseModel):
    src_path: str
    dest_path: str


@router.post("/copy")
async def copy_file_endpoint(req: CopyMoveRequest):
    """Copy a file to a new storage path."""
    try:
        url = copy_file(req.src_path, req.dest_path)
    except Exception as exc:
        _handle_storage_error(exc, 404)
    return {"download_url": url, "storage_path": req.dest_path}


@router.post("/move")
async def move_file_endpoint(req: CopyMoveRequest):
    """Move a file to a new storage path (copy + delete original)."""
    try:
        url = move_file(req.src_path, req.dest_path)
    except Exception as exc:
        _handle_storage_error(exc, 404)
    return {"download_url": url, "storage_path": req.dest_path}


# ═══════════════════════════════════════════════════════════════════════════════
#  LIST FILES
# ═══════════════════════════════════════════════════════════════════════════════


@router.get("/list", response_model=FileListResponse)
async def list_files_endpoint(prefix: str = Query("")):
    """List all file paths under a given storage prefix."""
    try:
        files = list_files(prefix)
    except Exception as exc:
        _handle_storage_error(exc)
    return FileListResponse(files=files)


@router.get("/list/detailed", response_model=DetailedFileListResponse)
async def list_files_detailed_endpoint(prefix: str = Query("")):
    """List files with size, content type, and creation time."""
    try:
        items = list_files_with_metadata(prefix)
    except Exception as exc:
        _handle_storage_error(exc)
    return DetailedFileListResponse(files=[DetailedFileItem(**i) for i in items])


# ═══════════════════════════════════════════════════════════════════════════════
#  DELETE
# ═══════════════════════════════════════════════════════════════════════════════


@router.delete("/file")
async def delete_file_endpoint(storage_path: str = Query(...)):
    """Delete a single file from Cloud Storage."""
    try:
        delete_file(storage_path)
    except Exception as exc:
        _handle_storage_error(exc, 404)
    return {"deleted": True, "storage_path": storage_path}


@router.delete("/files", response_model=BatchDeleteResponse)
async def batch_delete_endpoint(req: BatchDeleteRequest):
    """Delete multiple files from Cloud Storage in one request."""
    try:
        result = delete_files(req.paths)
    except Exception as exc:
        _handle_storage_error(exc)
    return BatchDeleteResponse(**result)
