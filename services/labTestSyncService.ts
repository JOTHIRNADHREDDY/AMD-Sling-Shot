/**
 * Lab Test Sync Service — cloud-first storage with offline fallback.
 *
 * Flow:
 *   1. Try to save scan results to the backend API (→ SQLite + optional Cloud Storage)
 *   2. If the backend is unreachable (offline), save to IndexedDB
 *   3. When connectivity returns, sync all pending IndexedDB scans to the backend
 *
 * Auto-sync is triggered by:
 *   • App startup (initLabTestSync)
 *   • `online` window event
 */

import type { LabTest } from '../types';
import { isFirebaseReachable } from './firebase';
import {
    savePendingLabScan,
    getPendingLabScans,
    deletePendingLabScan,
    type PendingLabScan,
} from './offlineStorage';

// ── Types ────────────────────────────────────────────────────────────────────

export interface LabScanSaveResult {
    saved: boolean;
    location: 'cloud' | 'offline';
    scanId: string;
    cloudUrl?: string;
}

// ── Backend API helpers ──────────────────────────────────────────────────────

const BASE = '/v1';

interface BackendScanResponse {
    id: string;
    registration_id: string | null;
    tests_data: Record<string, unknown>[];
    total_amount: number;
    cloud_storage_path: string | null;
    cloud_download_url: string | null;
    sync_status: string;
    created_at: string;
}

async function postScanToBackend(
    tests: LabTest[],
    registrationId?: string,
): Promise<BackendScanResponse> {
    const res = await fetch(`${BASE}/lab-tests/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tests: tests.map((t) => ({
                id: t.id,
                name: t.name,
                price: t.price,
                status: t.status,
            })),
            registration_id: registrationId ?? null,
            sync_status: 'synced',
        }),
    });
    if (!res.ok) {
        throw new Error(`Backend responded ${res.status}`);
    }
    return res.json();
}

// ── Primary save function ────────────────────────────────────────────────────

/**
 * Save lab test scan results — tries cloud first, falls back to offline.
 */
export async function saveLabTestScan(
    tests: LabTest[],
    registrationId?: string,
): Promise<LabScanSaveResult> {
    const totalAmount = tests.reduce((sum, t) => sum + t.price, 0);
    const scanId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Try backend (which saves to SQLite and can also push to Firebase Cloud Storage)
    try {
        const isOnline = navigator.onLine && (await isFirebaseReachable());
        if (!isOnline) throw new Error('Offline');

        const result = await postScanToBackend(tests, registrationId);
        console.log('[LabTestSync] Saved to cloud/backend:', result.id);
        return {
            saved: true,
            location: 'cloud',
            scanId: result.id,
            cloudUrl: result.cloud_download_url ?? undefined,
        };
    } catch (err) {
        console.warn('[LabTestSync] Cloud save failed, saving offline:', err);
    }

    // Fallback: save to IndexedDB
    try {
        const pendingScan: PendingLabScan = {
            id: scanId,
            registrationId,
            tests: tests.map((t) => ({
                id: t.id,
                name: t.name,
                price: t.price,
                status: t.status,
            })),
            totalAmount,
            createdAt: new Date().toISOString(),
        };
        await savePendingLabScan(pendingScan);
        console.log('[LabTestSync] Saved offline:', scanId);
        return { saved: true, location: 'offline', scanId };
    } catch (offlineErr) {
        console.error('[LabTestSync] Both cloud and offline save failed:', offlineErr);
        return { saved: false, location: 'offline', scanId };
    }
}

// ── Sync pending scans ───────────────────────────────────────────────────────

let _syncing = false;

/**
 * Upload all pending IndexedDB scans to the backend.
 * Called on startup and when the browser goes back online.
 */
export async function syncPendingScans(): Promise<{ synced: number; failed: number }> {
    if (_syncing) return { synced: 0, failed: 0 };
    _syncing = true;

    let synced = 0;
    let failed = 0;

    try {
        const pending = await getPendingLabScans();
        if (pending.length === 0) {
            console.log('[LabTestSync] No pending scans to sync.');
            return { synced: 0, failed: 0 };
        }

        console.log(`[LabTestSync] Syncing ${pending.length} pending scan(s)...`);

        for (const scan of pending) {
            try {
                const tests: LabTest[] = scan.tests.map((t) => ({
                    id: t.id,
                    name: t.name,
                    price: t.price,
                    status: t.status as LabTest['status'],
                }));

                await postScanToBackend(tests, scan.registrationId);
                await deletePendingLabScan(scan.id);
                synced++;
                console.log(`[LabTestSync] Synced scan ${scan.id}`);
            } catch (err) {
                failed++;
                console.warn(`[LabTestSync] Failed to sync scan ${scan.id}:`, err);
            }
        }
    } finally {
        _syncing = false;
    }

    console.log(`[LabTestSync] Sync complete: ${synced} synced, ${failed} failed.`);
    return { synced, failed };
}

// ── Auto-sync initializer ────────────────────────────────────────────────────

let _initialized = false;

/**
 * Initialize auto-sync: runs once on app startup, then listens for `online` events.
 */
export function initLabTestSync(): () => void {
    if (_initialized) return () => { };
    _initialized = true;

    // Sync existing pending scans on startup
    syncPendingScans().catch(console.error);

    // Re-sync whenever the browser regains connectivity
    const onOnline = () => {
        console.log('[LabTestSync] Browser went online — syncing pending scans...');
        syncPendingScans().catch(console.error);
    };

    window.addEventListener('online', onOnline);

    // Return cleanup function
    return () => {
        window.removeEventListener('online', onOnline);
        _initialized = false;
    };
}
