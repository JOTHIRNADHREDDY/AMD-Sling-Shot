/**
 * Firebase Cloud Storage service — enhanced edition.
 *
 * Features:
 *   • Resumable uploads with real-time progress callbacks
 *   • Automatic retry with exponential back-off (configurable)
 *   • Client-side file validation (size & MIME type)
 *   • Image compression before upload (optional)
 *   • Download URL caching (LRU, in-memory)
 *   • Batch / multi-file upload helper
 *   • Metadata retrieval
 *   • Date-partitioned folder layout:
 *       receipts/{YYYY-MM-DD}/{registration_id}.png
 *       documents/{YYYY-MM-DD}/{filename}
 *       lab-reports/{YYYY-MM-DD}/{patientId}_{filename}
 */

import {
  ref,
  uploadBytes,
  uploadString,
  uploadBytesResumable,
  getDownloadURL,
  getMetadata,
  deleteObject,
  listAll,
  type StorageReference,
  type UploadResult,
  type UploadTask,
  type UploadMetadata,
  type FullMetadata,
} from 'firebase/storage';
import { storage } from './firebase';

// ═══════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface UploadProgress {
  /** 0 → 1 */
  progress: number;
  /** Bytes transferred so far */
  bytesTransferred: number;
  /** Total bytes */
  totalBytes: number;
  /** Upload state: 'running' | 'paused' | 'success' | 'canceled' | 'error' */
  state: string;
}

export type ProgressCallback = (progress: UploadProgress) => void;

export interface ReceiptUploadResult {
  downloadUrl: string;
  storagePath: string;
}

export interface DocumentUploadResult {
  downloadUrl: string;
  storagePath: string;
  fileName: string;
}

export interface FileMetadata {
  name: string;
  fullPath: string;
  size: number;
  contentType: string;
  timeCreated: string;
  updated: string;
  customMetadata: Record<string, string>;
}

export interface BatchUploadResult {
  succeeded: DocumentUploadResult[];
  failed: { file: File; error: string }[];
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONFIG / CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/** Maximum upload size in bytes (default 20 MB). */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/** Allowed MIME types per category. */
const ALLOWED_TYPES: Record<string, string[]> = {
  receipt: ['image/png', 'image/jpeg', 'image/webp'],
  document: [
    'image/png', 'image/jpeg', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  labReport: [
    'image/png', 'image/jpeg', 'image/webp',
    'application/pdf',
  ],
};

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

// ═══════════════════════════════════════════════════════════════════════════════
//  INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** YYYY-MM-DD */
function todayPartition(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildRef(folder: string, fileName: string): StorageReference {
  return ref(storage, `${folder}/${todayPartition()}/${fileName}`);
}

function sanitise(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Sleep helper for retry back-off. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Validation ───────────────────────────────────────────────────────────────

export class StorageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageValidationError';
  }
}

function validateFile(file: File | Blob, category: keyof typeof ALLOWED_TYPES): void {
  if (file.size > MAX_FILE_SIZE) {
    const mb = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
    throw new StorageValidationError(`File exceeds maximum size of ${mb} MB.`);
  }
  const allowed = ALLOWED_TYPES[category];
  if (allowed && file.type && !allowed.includes(file.type)) {
    throw new StorageValidationError(
      `File type "${file.type}" is not allowed. Accepted: ${allowed.join(', ')}`,
    );
  }
}

// ── Retry wrapper ────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delay = RETRY_BASE_MS * 2 ** attempt + Math.random() * 200;
        console.warn(`[FirebaseStorage] Retry ${attempt + 1}/${retries} in ${Math.round(delay)}ms`, err);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

// ── Image compression ────────────────────────────────────────────────────────

/**
 * Compress an image blob client-side by drawing to a <canvas> and re-encoding.
 * Returns the original blob unchanged for non-image or if compression yields
 * a larger result.
 */
export async function compressImage(
  blob: Blob,
  { maxWidth = 1920, maxHeight = 1920, quality = 0.82 } = {},
): Promise<Blob> {
  if (!blob.type.startsWith('image/')) return blob;

  return new Promise<Blob>((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (compressed) => {
          // Keep whichever is smaller
          if (compressed && compressed.size < blob.size) {
            resolve(compressed);
          } else {
            resolve(blob);
          }
        },
        'image/webp',
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(blob); // fallback to original
    };
    img.src = url;
  });
}

// ── Download URL cache (LRU-ish, max 200 entries) ───────────────────────────

const _urlCache = new Map<string, { url: string; expires: number }>();
const URL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const URL_CACHE_MAX = 200;

function getCachedUrl(path: string): string | null {
  const entry = _urlCache.get(path);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    _urlCache.delete(path);
    return null;
  }
  return entry.url;
}

function setCachedUrl(path: string, url: string): void {
  if (_urlCache.size >= URL_CACHE_MAX) {
    // evict oldest
    const oldest = _urlCache.keys().next().value;
    if (oldest !== undefined) _urlCache.delete(oldest);
  }
  _urlCache.set(path, { url, expires: Date.now() + URL_CACHE_TTL_MS });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RESUMABLE UPLOAD (with progress)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Start a resumable upload and return an object that lets callers
 * pause / resume / cancel and observe progress.
 */
export interface ResumableUploadHandle {
  /** The underlying Firebase UploadTask — gives full control. */
  task: UploadTask;
  /** Resolves when the upload finishes. */
  promise: Promise<ReceiptUploadResult>;
  pause: () => boolean;
  resume: () => boolean;
  cancel: () => boolean;
}

export function uploadResumable(
  storageRef: StorageReference,
  data: Blob | Uint8Array | ArrayBuffer,
  metadata: UploadMetadata,
  onProgress?: ProgressCallback,
): ResumableUploadHandle {
  const task = uploadBytesResumable(storageRef, data, metadata);

  const promise = new Promise<ReceiptUploadResult>((resolve, reject) => {
    task.on(
      'state_changed',
      (snap) => {
        onProgress?.({
          progress: snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0,
          bytesTransferred: snap.bytesTransferred,
          totalBytes: snap.totalBytes,
          state: snap.state,
        });
      },
      (err) => reject(err),
      async () => {
        const downloadUrl = await getDownloadURL(task.snapshot.ref);
        const storagePath = task.snapshot.ref.fullPath;
        setCachedUrl(storagePath, downloadUrl);
        resolve({ downloadUrl, storagePath });
      },
    );
  });

  return {
    task,
    promise,
    pause: () => task.pause(),
    resume: () => task.resume(),
    cancel: () => task.cancel(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RECEIPT UPLOADS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Upload a receipt blob with progress tracking, validation, optional
 * compression, and automatic retry.
 */
export async function uploadReceiptBlob(
  registrationId: string,
  blob: Blob,
  options?: {
    contentType?: string;
    compress?: boolean;
    onProgress?: ProgressCallback;
  },
): Promise<ReceiptUploadResult> {
  validateFile(blob, 'receipt');
  let data = blob;
  if (options?.compress !== false) {
    data = await compressImage(blob);
  }

  const storageRef = buildRef('receipts', `${registrationId}.png`);
  const meta: UploadMetadata = {
    contentType: options?.contentType ?? data.type ?? 'image/png',
    customMetadata: { registrationId, uploadedAt: new Date().toISOString() },
  };

  if (options?.onProgress) {
    const handle = uploadResumable(storageRef, data, meta, options.onProgress);
    return handle.promise;
  }

  return withRetry(async () => {
    const result: UploadResult = await uploadBytes(storageRef, data, meta);
    const downloadUrl = await getDownloadURL(result.ref);
    setCachedUrl(result.ref.fullPath, downloadUrl);
    return { downloadUrl, storagePath: result.ref.fullPath };
  });
}

/**
 * Upload a receipt from a base-64 data URL with retry.
 */
export async function uploadReceiptDataUrl(
  registrationId: string,
  dataUrl: string,
): Promise<ReceiptUploadResult> {
  const storageRef = buildRef('receipts', `${registrationId}.png`);
  return withRetry(async () => {
    const result = await uploadString(storageRef, dataUrl, 'data_url', {
      customMetadata: { registrationId, uploadedAt: new Date().toISOString() },
    });
    const downloadUrl = await getDownloadURL(result.ref);
    setCachedUrl(result.ref.fullPath, downloadUrl);
    return { downloadUrl, storagePath: result.ref.fullPath };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DOCUMENT UPLOADS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Upload a generic document with validation, progress, and retry.
 */
export async function uploadDocument(
  file: File,
  options?: {
    subfolder?: string;
    compress?: boolean;
    onProgress?: ProgressCallback;
  },
): Promise<DocumentUploadResult> {
  validateFile(file, 'document');
  let data: Blob = file;
  if (options?.compress && file.type.startsWith('image/')) {
    data = await compressImage(file);
  }

  const subfolder = options?.subfolder ?? 'documents';
  const safeName = `${Date.now()}_${sanitise(file.name)}`;
  const storageRef = buildRef(subfolder, safeName);
  const meta: UploadMetadata = {
    contentType: file.type,
    customMetadata: { originalName: file.name, uploadedAt: new Date().toISOString() },
  };

  if (options?.onProgress) {
    const handle = uploadResumable(storageRef, data, meta, options.onProgress);
    const res = await handle.promise;
    return { ...res, fileName: file.name };
  }

  return withRetry(async () => {
    const result = await uploadBytes(storageRef, data, meta);
    const downloadUrl = await getDownloadURL(result.ref);
    setCachedUrl(result.ref.fullPath, downloadUrl);
    return { downloadUrl, storagePath: result.ref.fullPath, fileName: file.name };
  });
}

/**
 * Upload a lab-test report with validation, progress, and retry.
 */
export async function uploadLabReport(
  file: File,
  patientId: string,
  options?: {
    compress?: boolean;
    onProgress?: ProgressCallback;
  },
): Promise<DocumentUploadResult> {
  validateFile(file, 'labReport');
  let data: Blob = file;
  if (options?.compress && file.type.startsWith('image/')) {
    data = await compressImage(file);
  }

  const safeName = `${patientId}_${sanitise(file.name)}`;
  const storageRef = buildRef('lab-reports', safeName);
  const meta: UploadMetadata = {
    contentType: file.type,
    customMetadata: { patientId, originalName: file.name, uploadedAt: new Date().toISOString() },
  };

  if (options?.onProgress) {
    const handle = uploadResumable(storageRef, data, meta, options.onProgress);
    const res = await handle.promise;
    return { ...res, fileName: file.name };
  }

  return withRetry(async () => {
    const result = await uploadBytes(storageRef, data, meta);
    const downloadUrl = await getDownloadURL(result.ref);
    setCachedUrl(result.ref.fullPath, downloadUrl);
    return { downloadUrl, storagePath: result.ref.fullPath, fileName: file.name };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BATCH UPLOAD
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Upload multiple files in parallel with individual progress tracking.
 * Returns a summary of succeeded and failed uploads.
 */
export async function uploadBatch(
  files: File[],
  options?: {
    subfolder?: string;
    compress?: boolean;
    onFileProgress?: (index: number, progress: UploadProgress) => void;
    concurrency?: number;
  },
): Promise<BatchUploadResult> {
  const concurrency = options?.concurrency ?? 3;
  const succeeded: DocumentUploadResult[] = [];
  const failed: { file: File; error: string }[] = [];

  // Process in chunks of `concurrency`
  for (let i = 0; i < files.length; i += concurrency) {
    const chunk = files.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      chunk.map((file, ci) =>
        uploadDocument(file, {
          subfolder: options?.subfolder,
          compress: options?.compress,
          onProgress: options?.onFileProgress
            ? (p) => options.onFileProgress!(i + ci, p)
            : undefined,
        }),
      ),
    );
    results.forEach((r, ci) => {
      if (r.status === 'fulfilled') succeeded.push(r.value);
      else failed.push({ file: chunk[ci], error: String(r.reason) });
    });
  }
  return { succeeded, failed };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DOWNLOADS & QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the download URL for a file (uses cache when available).
 */
export async function getFileUrl(storagePath: string): Promise<string> {
  const cached = getCachedUrl(storagePath);
  if (cached) return cached;

  const storageRef = ref(storage, storagePath);
  const url = await getDownloadURL(storageRef);
  setCachedUrl(storagePath, url);
  return url;
}

/**
 * Retrieve full metadata for a stored file.
 */
export async function getFileMetadata(storagePath: string): Promise<FileMetadata> {
  const storageRef = ref(storage, storagePath);
  const meta: FullMetadata = await getMetadata(storageRef);
  return {
    name: meta.name,
    fullPath: meta.fullPath,
    size: meta.size,
    contentType: meta.contentType ?? 'application/octet-stream',
    timeCreated: meta.timeCreated,
    updated: meta.updated,
    customMetadata: (meta.customMetadata as Record<string, string>) ?? {},
  };
}

/**
 * List all receipts for today.
 */
export async function listTodayReceipts(): Promise<string[]> {
  const folderRef = ref(storage, `receipts/${todayPartition()}`);
  const result = await listAll(folderRef);
  return result.items.map((item) => item.fullPath);
}

/**
 * List all files under an arbitrary folder path.
 */
export async function listFiles(folderPath: string): Promise<string[]> {
  const folderRef = ref(storage, folderPath);
  const result = await listAll(folderRef);
  return result.items.map((item) => item.fullPath);
}

/**
 * List files with their download URLs (for display grids, etc.).
 */
export async function listFilesWithUrls(
  folderPath: string,
): Promise<{ path: string; url: string }[]> {
  const paths = await listFiles(folderPath);
  return Promise.all(
    paths.map(async (p) => ({ path: p, url: await getFileUrl(p) })),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DELETION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Delete a single file from Cloud Storage.
 */
export async function deleteFile(storagePath: string): Promise<void> {
  const storageRef = ref(storage, storagePath);
  await deleteObject(storageRef);
  _urlCache.delete(storagePath);
}

/**
 * Delete multiple files in parallel.
 */
export async function deleteFiles(paths: string[]): Promise<{ deleted: string[]; errors: string[] }> {
  const deleted: string[] = [];
  const errors: string[] = [];
  await Promise.allSettled(
    paths.map(async (p) => {
      try {
        await deleteFile(p);
        deleted.push(p);
      } catch {
        errors.push(p);
      }
    }),
  );
  return { deleted, errors };
}
