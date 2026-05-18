/**
 * API Service – typed HTTP client for the FastAPI backend.
 *
 * All paths go through the Vite dev-server proxy (/v1 → http://localhost:8000/v1)
 * so no absolute URLs are needed during development.
 */

import type {
  QueueStatus,
  MapDirections,
  RegistrationResult,
  PatientLookup,
} from '../types';

// ─── Additional API-only types ───────────────────────────────────────────────

export interface VoiceIntentResult {
  intent: string;
  confidence: number;
  extracted_entities: Record<string, unknown>;
  transcript: string;
}

export interface RegisterPatientRequest {
  name: string;
  age: string;
  gender: string;
  phone: string;
  department: string;
  language: string;
}

// Re-export the canonical types so existing imports keep working
export type { QueueStatus, MapDirections, RegistrationResult, PatientLookup };

// Alias names used by callers that expect the *Response suffix
export type RegisterPatientResponse = RegistrationResult;
export type PatientLookupResponse = PatientLookup;

// ─── Base helpers ────────────────────────────────────────────────────────────

const BASE = '/v1';
const DEFAULT_TIMEOUT_MS = 10_000;

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  options?: { params?: Record<string, string>; body?: unknown; timeoutMs?: number },
): Promise<T> {
  const { params, body, timeoutMs = DEFAULT_TIMEOUT_MS } = options ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(`${BASE}${path}`, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    const res = await fetch(url.toString(), {
      method,
      signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(res.status, `${method} ${path} failed (${res.status}): ${text}`);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API methods ──────────────────────────────────────────────────────

/** Fetch live queue / department throughput. */
export function fetchQueueStatus(): Promise<QueueStatus[]> {
  return request<QueueStatus[]>('GET', '/queue/status');
}

/** Get Dijkstra-based directions between two nodes. */
export function fetchDirections(from: string, to: string): Promise<MapDirections> {
  return request<MapDirections>('GET', '/map/directions', {
    params: { from_node: from, to_node: to },
  });
}

/** Send a short voice clip for intent extraction (REST). */
export function sendVoiceIntent(audioBase64: string, language = 'en-IN'): Promise<VoiceIntentResult> {
  return request<VoiceIntentResult>('POST', '/voice/intent', {
    body: { audio_base64: audioBase64, language },
  });
}

/** Health-check ping. */
export function healthCheck(): Promise<{ status: string; service: string }> {
  return fetch('/').then((r) => r.json());
}

// ─── Registration ────────────────────────────────────────────────────────────

/** Register a new outpatient and get a queue token. */
export function registerPatient(req: RegisterPatientRequest): Promise<RegisterPatientResponse> {
  return request<RegisterPatientResponse>('POST', '/registration/register', { body: req });
}

/** Look up a patient by their token number (from QR scan). */
export function lookupPatient(tokenNumber: string): Promise<PatientLookupResponse> {
  return request<PatientLookupResponse>('GET', `/registration/lookup/${encodeURIComponent(tokenNumber)}`);
}

// ─── WebSocket helper ────────────────────────────────────────────────────────

/**
 * Opens a WebSocket to /v1/voice/stream for real-time audio streaming.
 * Returns the raw WebSocket so callers can attach handlers.
 */
export function openVoiceStream(): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}${BASE}/voice/stream`;
  return new WebSocket(wsUrl);
}

// ─── Cloud Storage (Firebase via backend) ────────────────────────────────────

export interface StorageUploadResponse {
  download_url: string;
  storage_path: string;
  file_name?: string;
}

/** Upload a receipt image (base-64 data URL) via the backend. */
export function uploadReceiptBase64(
  registrationId: string,
  imageBase64: string,
): Promise<StorageUploadResponse> {
  return request<StorageUploadResponse>('POST', '/storage/receipt/base64', {
    body: { registration_id: registrationId, image_base64: imageBase64 },
  });
}

/** Upload a generic document via multipart form. */
export async function uploadDocument(file: File, subfolder = 'documents'): Promise<StorageUploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('subfolder', subfolder);

  const res = await fetch(`${BASE}/storage/document`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return res.json();
}

/** Upload a lab report via multipart form. */
export async function uploadLabReport(file: File, patientId: string): Promise<StorageUploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('patient_id', patientId);

  const res = await fetch(`${BASE}/storage/lab-report`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return res.json();
}

/** Get signed download URL for a file by its storage path. */
export function getStorageFileUrl(
  storagePath: string,
  expiryMins = 60,
): Promise<{ download_url: string; expires_in_mins: number }> {
  return request<{ download_url: string; expires_in_mins: number }>('GET', '/storage/url', {
    params: { storage_path: storagePath, expiry_mins: String(expiryMins) },
  });
}

/** Retrieve metadata for a stored file. */
export function getStorageFileMetadata(storagePath: string): Promise<{
  name: string;
  size: number;
  content_type: string;
  time_created: string;
  updated: string;
  custom_metadata: Record<string, string>;
}> {
  return request('GET', '/storage/metadata', { params: { storage_path: storagePath } });
}

/** Check if a file exists in storage. */
export function checkFileExists(storagePath: string): Promise<{ exists: boolean }> {
  return request<{ exists: boolean }>('GET', '/storage/exists', {
    params: { storage_path: storagePath },
  });
}

/** Copy a file to a new path. */
export function copyStorageFile(srcPath: string, destPath: string): Promise<StorageUploadResponse> {
  return request<StorageUploadResponse>('POST', '/storage/copy', {
    body: { src_path: srcPath, dest_path: destPath },
  });
}

/** Move a file to a new path. */
export function moveStorageFile(srcPath: string, destPath: string): Promise<StorageUploadResponse> {
  return request<StorageUploadResponse>('POST', '/storage/move', {
    body: { src_path: srcPath, dest_path: destPath },
  });
}

/** List all files under a prefix. */
export function listStorageFiles(prefix: string): Promise<{ files: string[] }> {
  return request<{ files: string[] }>('GET', '/storage/list', {
    params: { prefix },
  });
}

/** List files with detailed metadata. */
export function listStorageFilesDetailed(prefix: string): Promise<{
  files: { path: string; size: number; content_type: string; time_created: string }[];
}> {
  return request('GET', '/storage/list/detailed', { params: { prefix } });
}

/** Delete a file from Cloud Storage. */
export function deleteStorageFile(storagePath: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>('DELETE', '/storage/file', {
    params: { storage_path: storagePath },
  });
}

/** Batch-delete multiple files. */
export function deleteStorageFiles(paths: string[]): Promise<{ deleted: string[]; errors: { path: string; error: string }[] }> {
  return request('DELETE', '/storage/files', { body: { paths } });
}
