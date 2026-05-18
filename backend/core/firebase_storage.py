"""
Firebase Admin SDK — enhanced Cloud Storage helpers.

Features beyond basic upload/download:
  • Signed URLs with configurable expiration (instead of make_public)
  • File existence check
  • Copy & move operations
  • Metadata retrieval & update
  • Automatic retry with exponential back-off
  • File-size & content-type validation
  • Batch operations

Place a Firebase service-account JSON file at the path given by the
FIREBASE_SERVICE_ACCOUNT_KEY env-var (defaults to ./firebase-sa-key.json).
Set FIREBASE_STORAGE_BUCKET to your bucket name (e.g. medikisok.firebasestorage.app).
"""

import os
import time
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import firebase_admin
from firebase_admin import credentials, storage as fb_storage

logger = logging.getLogger("firebase_storage")

# ═══════════════════════════════════════════════════════════════════════════════
#  CONFIG
# ═══════════════════════════════════════════════════════════════════════════════

_SA_KEY_PATH = os.getenv("FIREBASE_SERVICE_ACCOUNT_KEY", "./firebase-sa-key.json")
_STORAGE_BUCKET = os.getenv("FIREBASE_STORAGE_BUCKET", "medikisok.firebasestorage.app")

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB
MAX_RETRIES = 3
RETRY_BASE_SEC = 0.5
SIGNED_URL_EXPIRY_MINS = int(os.getenv("SIGNED_URL_EXPIRY_MINS", "60"))

ALLOWED_CONTENT_TYPES: dict[str, list[str]] = {
    "receipt": ["image/png", "image/jpeg", "image/webp"],
    "document": [
        "image/png", "image/jpeg", "image/webp",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    "lab-report": [
        "image/png", "image/jpeg", "image/webp",
        "application/pdf",
    ],
}

# ═══════════════════════════════════════════════════════════════════════════════
#  INIT
# ═══════════════════════════════════════════════════════════════════════════════

_firebase_app: Optional[firebase_admin.App] = None


def _ensure_initialised() -> firebase_admin.App:
    """Lazy-init so the module can be imported when credentials are absent."""
    global _firebase_app
    if _firebase_app is not None:
        return _firebase_app

    if not os.path.isfile(_SA_KEY_PATH):
        raise RuntimeError(
            f"Firebase service-account key not found at {_SA_KEY_PATH!r}. "
            "Set FIREBASE_SERVICE_ACCOUNT_KEY env var to the correct path."
        )

    cred = credentials.Certificate(_SA_KEY_PATH)
    _firebase_app = firebase_admin.initialize_app(cred, {
        "storageBucket": _STORAGE_BUCKET,
    })
    return _firebase_app


def get_bucket():
    """Return the default Cloud Storage bucket."""
    _ensure_initialised()
    return fb_storage.bucket()


# ═══════════════════════════════════════════════════════════════════════════════
#  INTERNAL HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _sanitise(name: str) -> str:
    return name.replace(" ", "_").replace("/", "_")


class StorageValidationError(ValueError):
    """Raised when a file fails size or content-type validation."""
    pass


def validate_upload(
    data: bytes,
    content_type: str,
    category: str = "document",
) -> None:
    """Validate file size and content type before uploading."""
    if len(data) > MAX_FILE_SIZE:
        mb = MAX_FILE_SIZE // (1024 * 1024)
        raise StorageValidationError(f"File exceeds maximum size of {mb} MB.")
    allowed = ALLOWED_CONTENT_TYPES.get(category)
    if allowed and content_type not in allowed:
        raise StorageValidationError(
            f"Content type '{content_type}' not allowed for {category}. "
            f"Accepted: {', '.join(allowed)}"
        )


def _with_retry(fn, retries: int = MAX_RETRIES):
    """Execute `fn()` with exponential back-off retries."""
    last_exc = None
    for attempt in range(retries + 1):
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            if attempt < retries:
                delay = RETRY_BASE_SEC * (2 ** attempt)
                logger.warning("Retry %d/%d in %.1fs: %s", attempt + 1, retries, delay, exc)
                time.sleep(delay)
    raise last_exc  # type: ignore[misc]


# ═══════════════════════════════════════════════════════════════════════════════
#  CORE UPLOAD
# ═══════════════════════════════════════════════════════════════════════════════

def upload_bytes(
    data: bytes,
    destination_path: str,
    content_type: str = "application/octet-stream",
    metadata: Optional[dict] = None,
    category: str = "document",
) -> str:
    """Upload raw bytes with validation & retry.  Returns a signed download URL."""
    validate_upload(data, content_type, category)

    def _do():
        bucket = get_bucket()
        blob = bucket.blob(destination_path)
        blob.metadata = {**(metadata or {}), "uploadedAt": datetime.now(timezone.utc).isoformat()}
        blob.upload_from_string(data, content_type=content_type)
        # Generate a signed URL instead of making the file world-public
        return blob.generate_signed_url(
            expiration=timedelta(minutes=SIGNED_URL_EXPIRY_MINS),
            method="GET",
        )

    return _with_retry(_do)


# ═══════════════════════════════════════════════════════════════════════════════
#  DOMAIN UPLOADS
# ═══════════════════════════════════════════════════════════════════════════════

def upload_receipt(registration_id: str, data: bytes, content_type: str = "image/png") -> dict:
    """Upload a receipt image and return metadata."""
    path = f"receipts/{_today()}/{registration_id}.png"
    url = upload_bytes(data, path, content_type, {"registrationId": registration_id}, category="receipt")
    return {"download_url": url, "storage_path": path}


def upload_document(
    file_bytes: bytes,
    original_name: str,
    content_type: str,
    subfolder: str = "documents",
) -> dict:
    """Upload a generic document."""
    safe = _sanitise(original_name)
    path = f"{subfolder}/{_today()}/{uuid.uuid4().hex[:8]}_{safe}"
    url = upload_bytes(file_bytes, path, content_type, {"originalName": original_name}, category="document")
    return {"download_url": url, "storage_path": path, "file_name": original_name}


def upload_lab_report(
    file_bytes: bytes,
    original_name: str,
    content_type: str,
    patient_id: str,
) -> dict:
    """Upload a lab report under the lab-reports partition."""
    safe = _sanitise(original_name)
    path = f"lab-reports/{_today()}/{patient_id}_{safe}"
    url = upload_bytes(file_bytes, path, content_type, {"patientId": patient_id}, category="lab-report")
    return {"download_url": url, "storage_path": path, "file_name": original_name}


# ═══════════════════════════════════════════════════════════════════════════════
#  DOWNLOAD / SIGNED URLS
# ═══════════════════════════════════════════════════════════════════════════════

def get_download_url(storage_path: str, expiry_mins: int = SIGNED_URL_EXPIRY_MINS) -> str:
    """Generate a fresh signed download URL."""
    bucket = get_bucket()
    blob = bucket.blob(storage_path)
    if not blob.exists():
        raise FileNotFoundError(f"No file at {storage_path}")
    return blob.generate_signed_url(
        expiration=timedelta(minutes=expiry_mins),
        method="GET",
    )


# ═══════════════════════════════════════════════════════════════════════════════
#  METADATA
# ═══════════════════════════════════════════════════════════════════════════════

def get_file_metadata(storage_path: str) -> dict:
    """Retrieve metadata for a stored blob."""
    bucket = get_bucket()
    blob = bucket.blob(storage_path)
    blob.reload()
    return {
        "name": blob.name,
        "size": blob.size,
        "content_type": blob.content_type,
        "time_created": blob.time_created.isoformat() if blob.time_created else None,
        "updated": blob.updated.isoformat() if blob.updated else None,
        "custom_metadata": blob.metadata or {},
    }


def update_metadata(storage_path: str, custom_metadata: dict) -> dict:
    """Update custom metadata on an existing blob."""
    bucket = get_bucket()
    blob = bucket.blob(storage_path)
    blob.metadata = {**(blob.metadata or {}), **custom_metadata}
    blob.patch()
    return blob.metadata


# ═══════════════════════════════════════════════════════════════════════════════
#  EXISTENCE / COPY / MOVE
# ═══════════════════════════════════════════════════════════════════════════════

def file_exists(storage_path: str) -> bool:
    """Check whether a blob exists in the bucket."""
    bucket = get_bucket()
    return bucket.blob(storage_path).exists()


def copy_file(src_path: str, dest_path: str) -> str:
    """Copy a blob to a new path.  Returns the signed URL of the copy."""
    bucket = get_bucket()
    src_blob = bucket.blob(src_path)
    if not src_blob.exists():
        raise FileNotFoundError(f"Source file not found: {src_path}")
    bucket.copy_blob(src_blob, bucket, dest_path)
    dest_blob = bucket.blob(dest_path)
    return dest_blob.generate_signed_url(
        expiration=timedelta(minutes=SIGNED_URL_EXPIRY_MINS),
        method="GET",
    )


def move_file(src_path: str, dest_path: str) -> str:
    """Move (copy + delete) a blob.  Returns the signed URL of the new location."""
    url = copy_file(src_path, dest_path)
    delete_file(src_path)
    return url


# ═══════════════════════════════════════════════════════════════════════════════
#  DELETE / LIST
# ═══════════════════════════════════════════════════════════════════════════════

def delete_file(storage_path: str) -> None:
    """Delete a blob from Cloud Storage."""
    bucket = get_bucket()
    blob = bucket.blob(storage_path)
    blob.delete()


def delete_files(paths: list[str]) -> dict:
    """Delete multiple files; returns summary of successes and failures."""
    deleted, errors = [], []
    for p in paths:
        try:
            delete_file(p)
            deleted.append(p)
        except Exception as exc:
            errors.append({"path": p, "error": str(exc)})
    return {"deleted": deleted, "errors": errors}


def list_files(prefix: str) -> list[str]:
    """List all file paths under a given prefix."""
    bucket = get_bucket()
    blobs = bucket.list_blobs(prefix=prefix)
    return [blob.name for blob in blobs]


def list_files_with_metadata(prefix: str) -> list[dict]:
    """List files under a prefix with basic metadata."""
    bucket = get_bucket()
    blobs = list(bucket.list_blobs(prefix=prefix))
    results = []
    for blob in blobs:
        results.append({
            "path": blob.name,
            "size": blob.size,
            "content_type": blob.content_type,
            "time_created": blob.time_created.isoformat() if blob.time_created else None,
        })
    return results
