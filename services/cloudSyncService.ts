/**
 * Cloud Sync Service — unified cloud-first save with offline fallback for
 * ALL data types in the MediKiosk application.
 *
 * Covers:
 *   • Patient registration
 *   • Receipt uploads (base64 / blob)
 *   • Document uploads
 *   • Lab report uploads
 *   • Lab test scans (delegates to labTestSyncService)
 *
 * Each save operation:
 *   1. Checks connectivity (navigator.onLine + isFirebaseReachable)
 *   2. Tries the cloud/backend first
 *   3. On failure, persists locally in IndexedDB
 *   4. On reconnect, automatically syncs all pending items
 */

import { isFirebaseReachable } from './firebase';
import {
    registerPatient,
    type RegisterPatientRequest,
} from './api';
import {
    uploadReceiptDataUrl,
    uploadReceiptBlob,
    uploadDocument as firebaseUploadDocument,
    uploadLabReport as firebaseUploadLabReport,
    type ReceiptUploadResult,
    type DocumentUploadResult,
} from './firebaseStorage';
import {
    // Registrations
    savePendingRegistration,
    getPendingRegistrations,
    deletePendingRegistration,
    type PendingRegistration,
    // Receipts
    savePendingReceipt,
    getPendingReceipts,
    deletePendingReceipt,
    type PendingReceipt,
    // Documents
    savePendingDocument,
    getPendingDocuments,
    deletePendingDocument,
    type PendingDocument,
    // Lab Reports
    savePendingLabReport,
    getPendingLabReports,
    deletePendingLabReport,
    type PendingLabReport,
    // Aggregate
    getTotalPendingCount,
} from './offlineStorage';
import { syncPendingScans } from './labTestSyncService';
import type { RegistrationResult } from '../types';

// ═══════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type SaveLocation = 'cloud' | 'offline';

export interface CloudSaveResult<T = unknown> {
    saved: boolean;
    location: SaveLocation;
    id: string;
    data?: T;
}

export interface SyncReport {
    registrations: { synced: number; failed: number };
    receipts: { synced: number; failed: number };
    documents: { synced: number; failed: number };
    labReports: { synced: number; failed: number };
    labScans: { synced: number; failed: number };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONNECTIVITY
// ═══════════════════════════════════════════════════════════════════════════════

async function isOnline(): Promise<boolean> {
    if (!navigator.onLine) return false;
    try {
        return await isFirebaseReachable();
    } catch {
        return false;
    }
}

function generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  1. REGISTRATION — cloud-first save
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Register a patient — cloud-first with offline fallback.
 * When offline, stores the form data in IndexedDB and returns a temporary
 * registration result so the UI can still proceed.
 */
export async function saveRegistration(
    formData: RegisterPatientRequest,
): Promise<CloudSaveResult<RegistrationResult>> {
    const pendingId = generateId('reg');

    // Try cloud
    try {
        const online = await isOnline();
        if (!online) throw new Error('Offline');

        const result = await registerPatient(formData);
        console.log('[CloudSync] Registration saved to cloud:', result.registration_id);
        return { saved: true, location: 'cloud', id: result.registration_id, data: result };
    } catch (err) {
        console.warn('[CloudSync] Registration cloud save failed, going offline:', err);
    }

    // Offline fallback
    try {
        const pending: PendingRegistration = {
            id: pendingId,
            formData: {
                name: formData.name,
                age: formData.age,
                gender: formData.gender,
                phone: formData.phone,
                department: formData.department,
                language: formData.language,
            },
            createdAt: new Date().toISOString(),
        };
        await savePendingRegistration(pending);
        console.log('[CloudSync] Registration saved offline:', pendingId);

        // Build a temporary RegistrationResult for the UI
        const tempResult: RegistrationResult = {
            registration_id: pendingId,
            token_number: `OFFLINE-${pendingId.slice(-4).toUpperCase()}`,
            department: formData.department,
            position: 0,
            estimated_wait_time_mins: 0,
            patient_name: formData.name,
            patient_age: formData.age,
            patient_gender: formData.gender,
            patient_phone: formData.phone,
            language: formData.language,
            created_at: new Date().toISOString(),
        };
        return { saved: true, location: 'offline', id: pendingId, data: tempResult };
    } catch (offErr) {
        console.error('[CloudSync] Registration both cloud and offline failed:', offErr);
        return { saved: false, location: 'offline', id: pendingId };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  2. RECEIPT UPLOAD — cloud-first save
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Upload a receipt from a data URL — cloud-first, falls back to IndexedDB.
 */
export async function saveReceiptDataUrl(
    registrationId: string,
    dataUrl: string,
): Promise<CloudSaveResult<ReceiptUploadResult>> {
    const pendingId = generateId('rcpt');

    try {
        const online = await isOnline();
        if (!online) throw new Error('Offline');

        const result = await uploadReceiptDataUrl(registrationId, dataUrl);
        console.log('[CloudSync] Receipt (dataUrl) saved to cloud:', result.storagePath);
        return { saved: true, location: 'cloud', id: registrationId, data: result };
    } catch (err) {
        console.warn('[CloudSync] Receipt cloud upload failed, going offline:', err);
    }

    try {
        const pending: PendingReceipt = {
            id: pendingId,
            registrationId,
            dataUrl,
            contentType: 'image/png',
            createdAt: new Date().toISOString(),
        };
        await savePendingReceipt(pending);
        console.log('[CloudSync] Receipt saved offline:', pendingId);
        return { saved: true, location: 'offline', id: pendingId };
    } catch (offErr) {
        console.error('[CloudSync] Receipt both cloud and offline failed:', offErr);
        return { saved: false, location: 'offline', id: pendingId };
    }
}

/**
 * Upload a receipt blob — cloud-first, falls back to IndexedDB.
 */
export async function saveReceiptBlob(
    registrationId: string,
    blob: Blob,
    options?: { compress?: boolean; onProgress?: (p: { progress: number }) => void },
): Promise<CloudSaveResult<ReceiptUploadResult>> {
    const pendingId = generateId('rcpt');

    try {
        const online = await isOnline();
        if (!online) throw new Error('Offline');

        const result = await uploadReceiptBlob(registrationId, blob, {
            compress: options?.compress,
            onProgress: options?.onProgress,
        });
        console.log('[CloudSync] Receipt (blob) saved to cloud:', result.storagePath);
        return { saved: true, location: 'cloud', id: registrationId, data: result };
    } catch (err) {
        console.warn('[CloudSync] Receipt blob cloud upload failed, going offline:', err);
    }

    try {
        const arrayBuffer = await blob.arrayBuffer();
        const pending: PendingReceipt = {
            id: pendingId,
            registrationId,
            blobData: arrayBuffer,
            contentType: blob.type || 'image/png',
            createdAt: new Date().toISOString(),
        };
        await savePendingReceipt(pending);
        console.log('[CloudSync] Receipt blob saved offline:', pendingId);
        return { saved: true, location: 'offline', id: pendingId };
    } catch (offErr) {
        console.error('[CloudSync] Receipt blob both cloud and offline failed:', offErr);
        return { saved: false, location: 'offline', id: pendingId };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  3. DOCUMENT UPLOAD — cloud-first save
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Upload a generic document — cloud-first, falls back to IndexedDB.
 */
export async function saveDocument(
    file: File,
    options?: { compress?: boolean; subfolder?: string },
): Promise<CloudSaveResult<DocumentUploadResult>> {
    const pendingId = generateId('doc');

    try {
        const online = await isOnline();
        if (!online) throw new Error('Offline');

        const result = await firebaseUploadDocument(file, {
            compress: options?.compress,
            subfolder: options?.subfolder,
        });
        console.log('[CloudSync] Document saved to cloud:', result.storagePath);
        return { saved: true, location: 'cloud', id: result.storagePath, data: result };
    } catch (err) {
        console.warn('[CloudSync] Document cloud upload failed, going offline:', err);
    }

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pending: PendingDocument = {
            id: pendingId,
            fileName: file.name,
            fileData: arrayBuffer,
            contentType: file.type || 'application/octet-stream',
            subfolder: options?.subfolder ?? 'documents',
            createdAt: new Date().toISOString(),
        };
        await savePendingDocument(pending);
        console.log('[CloudSync] Document saved offline:', pendingId);
        return { saved: true, location: 'offline', id: pendingId };
    } catch (offErr) {
        console.error('[CloudSync] Document both cloud and offline failed:', offErr);
        return { saved: false, location: 'offline', id: pendingId };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  4. LAB REPORT UPLOAD — cloud-first save
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Upload a lab report — cloud-first, falls back to IndexedDB.
 */
export async function saveLabReport(
    file: File,
    patientId: string,
    options?: { compress?: boolean },
): Promise<CloudSaveResult<DocumentUploadResult>> {
    const pendingId = generateId('lab');

    try {
        const online = await isOnline();
        if (!online) throw new Error('Offline');

        const result = await firebaseUploadLabReport(file, patientId, {
            compress: options?.compress,
        });
        console.log('[CloudSync] Lab report saved to cloud:', result.storagePath);
        return { saved: true, location: 'cloud', id: result.storagePath, data: result };
    } catch (err) {
        console.warn('[CloudSync] Lab report cloud upload failed, going offline:', err);
    }

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pending: PendingLabReport = {
            id: pendingId,
            patientId,
            fileName: file.name,
            fileData: arrayBuffer,
            contentType: file.type || 'application/pdf',
            createdAt: new Date().toISOString(),
        };
        await savePendingLabReport(pending);
        console.log('[CloudSync] Lab report saved offline:', pendingId);
        return { saved: true, location: 'offline', id: pendingId };
    } catch (offErr) {
        console.error('[CloudSync] Lab report both cloud and offline failed:', offErr);
        return { saved: false, location: 'offline', id: pendingId };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SYNC — upload all pending items when connectivity returns
// ═══════════════════════════════════════════════════════════════════════════════

let _syncing = false;

/**
 * Sync ALL pending offline data to the cloud. Safe to call multiple times
 * (concurrent calls are de-duped).
 */
export async function syncAllPending(): Promise<SyncReport> {
    if (_syncing) {
        return {
            registrations: { synced: 0, failed: 0 },
            receipts: { synced: 0, failed: 0 },
            documents: { synced: 0, failed: 0 },
            labReports: { synced: 0, failed: 0 },
            labScans: { synced: 0, failed: 0 },
        };
    }
    _syncing = true;

    const report: SyncReport = {
        registrations: { synced: 0, failed: 0 },
        receipts: { synced: 0, failed: 0 },
        documents: { synced: 0, failed: 0 },
        labReports: { synced: 0, failed: 0 },
        labScans: { synced: 0, failed: 0 },
    };

    try {
        // 1. Registrations
        const pendingRegs = await getPendingRegistrations();
        for (const reg of pendingRegs) {
            try {
                await registerPatient(reg.formData);
                await deletePendingRegistration(reg.id);
                report.registrations.synced++;
            } catch {
                report.registrations.failed++;
            }
        }

        // 2. Receipts
        const pendingReceipts = await getPendingReceipts();
        for (const rcpt of pendingReceipts) {
            try {
                if (rcpt.dataUrl) {
                    await uploadReceiptDataUrl(rcpt.registrationId, rcpt.dataUrl);
                } else if (rcpt.blobData) {
                    const blob = new Blob([rcpt.blobData], { type: rcpt.contentType });
                    await uploadReceiptBlob(rcpt.registrationId, blob);
                }
                await deletePendingReceipt(rcpt.id);
                report.receipts.synced++;
            } catch {
                report.receipts.failed++;
            }
        }

        // 3. Documents
        const pendingDocs = await getPendingDocuments();
        for (const doc of pendingDocs) {
            try {
                const file = new File([doc.fileData], doc.fileName, { type: doc.contentType });
                await firebaseUploadDocument(file, { subfolder: doc.subfolder });
                await deletePendingDocument(doc.id);
                report.documents.synced++;
            } catch {
                report.documents.failed++;
            }
        }

        // 4. Lab Reports
        const pendingReports = await getPendingLabReports();
        for (const rpt of pendingReports) {
            try {
                const file = new File([rpt.fileData], rpt.fileName, { type: rpt.contentType });
                await firebaseUploadLabReport(file, rpt.patientId);
                await deletePendingLabReport(rpt.id);
                report.labReports.synced++;
            } catch {
                report.labReports.failed++;
            }
        }

        // 5. Lab Scans (delegate to existing service)
        report.labScans = await syncPendingScans();
    } finally {
        _syncing = false;
    }

    const total =
        report.registrations.synced + report.receipts.synced +
        report.documents.synced + report.labReports.synced +
        report.labScans.synced;
    const totalFailed =
        report.registrations.failed + report.receipts.failed +
        report.documents.failed + report.labReports.failed +
        report.labScans.failed;

    if (total > 0 || totalFailed > 0) {
        console.log(`[CloudSync] Sync complete: ${total} synced, ${totalFailed} failed.`, report);
    }

    return report;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTO-SYNC INITIALIZER
// ═══════════════════════════════════════════════════════════════════════════════

let _initialized = false;

/**
 * Initialize the unified auto-sync system. Call once on app mount.
 * Returns a cleanup function.
 */
export function initCloudSync(): () => void {
    if (_initialized) return () => {};
    _initialized = true;

    // Sync everything on startup
    syncAllPending().catch(console.error);

    // Re-sync whenever the browser regains connectivity
    const onOnline = () => {
        console.log('[CloudSync] Browser went online — syncing all pending data...');
        syncAllPending().catch(console.error);
    };

    window.addEventListener('online', onOnline);

    return () => {
        window.removeEventListener('online', onOnline);
        _initialized = false;
    };
}

/** Re-export for convenience */
export { getTotalPendingCount };
