/**
 * Offline Storage Service — IndexedDB-based local storage for ALL pending data.
 *
 * Used as a fallback when the backend / Firebase Cloud Storage is unreachable.
 * Stores pending writes that will be synced to the cloud when connectivity
 * is restored.
 *
 * Object stores (DB version 2):
 *   • pendingLabScans       — lab test scan results
 *   • pendingRegistrations  — OP registration form data
 *   • pendingReceipts       — receipt images (base64 or ArrayBuffer)
 *   • pendingDocuments      — generic document uploads
 *   • pendingLabReports     — lab report file uploads
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface PendingLabScan {
    id: string;
    registrationId?: string;
    tests: { id: string; name: string; price: number; status: string }[];
    totalAmount: number;
    createdAt: string;
}

export interface PendingRegistration {
    id: string;
    formData: {
        name: string;
        age: string;
        gender: string;
        phone: string;
        department: string;
        language: string;
    };
    createdAt: string;
}

export interface PendingReceipt {
    id: string;
    registrationId: string;
    /** base64 data-URL for dataUrl uploads */
    dataUrl?: string;
    /** Raw bytes for blob uploads */
    blobData?: ArrayBuffer;
    contentType: string;
    createdAt: string;
}

export interface PendingDocument {
    id: string;
    fileName: string;
    fileData: ArrayBuffer;
    contentType: string;
    subfolder: string;
    createdAt: string;
}

export interface PendingLabReport {
    id: string;
    patientId: string;
    fileName: string;
    fileData: ArrayBuffer;
    contentType: string;
    createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DATABASE
// ═══════════════════════════════════════════════════════════════════════════════

const DB_NAME = 'medikiosk';
const DB_VERSION = 2;

const STORES = {
    labScans: 'pendingLabScans',
    registrations: 'pendingRegistrations',
    receipts: 'pendingReceipts',
    documents: 'pendingDocuments',
    labReports: 'pendingLabReports',
} as const;

type StoreName = (typeof STORES)[keyof typeof STORES];

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = request.result;
            const oldVersion = (event as IDBVersionChangeEvent).oldVersion;

            // v1 → pendingLabScans
            if (oldVersion < 1) {
                if (!db.objectStoreNames.contains(STORES.labScans)) {
                    db.createObjectStore(STORES.labScans, { keyPath: 'id' });
                }
            }
            // v2 → registrations, receipts, documents, labReports
            if (oldVersion < 2) {
                if (!db.objectStoreNames.contains(STORES.registrations)) {
                    db.createObjectStore(STORES.registrations, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORES.receipts)) {
                    db.createObjectStore(STORES.receipts, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORES.documents)) {
                    db.createObjectStore(STORES.documents, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORES.labReports)) {
                    db.createObjectStore(STORES.labReports, { keyPath: 'id' });
                }
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GENERIC HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function putItem<T>(storeName: StoreName, item: T): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(item);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

async function getAllItems<T>(storeName: StoreName): Promise<T[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        tx.oncomplete = () => db.close();
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

async function deleteItem(storeName: StoreName, id: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

async function clearStore(storeName: StoreName): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

async function countItems(storeName: StoreName): Promise<number> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).count();
        req.onsuccess = () => resolve(req.result);
        tx.oncomplete = () => db.close();
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LAB SCANS
// ═══════════════════════════════════════════════════════════════════════════════

export const savePendingLabScan = (scan: PendingLabScan) => putItem(STORES.labScans, scan);
export const getPendingLabScans = () => getAllItems<PendingLabScan>(STORES.labScans);
export const deletePendingLabScan = (id: string) => deleteItem(STORES.labScans, id);
export const clearAllPendingScans = () => clearStore(STORES.labScans);
export const getPendingScanCount = () => countItems(STORES.labScans);

// ═══════════════════════════════════════════════════════════════════════════════
//  REGISTRATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export const savePendingRegistration = (reg: PendingRegistration) => putItem(STORES.registrations, reg);
export const getPendingRegistrations = () => getAllItems<PendingRegistration>(STORES.registrations);
export const deletePendingRegistration = (id: string) => deleteItem(STORES.registrations, id);
export const clearAllPendingRegistrations = () => clearStore(STORES.registrations);
export const getPendingRegistrationCount = () => countItems(STORES.registrations);

// ═══════════════════════════════════════════════════════════════════════════════
//  RECEIPTS
// ═══════════════════════════════════════════════════════════════════════════════

export const savePendingReceipt = (receipt: PendingReceipt) => putItem(STORES.receipts, receipt);
export const getPendingReceipts = () => getAllItems<PendingReceipt>(STORES.receipts);
export const deletePendingReceipt = (id: string) => deleteItem(STORES.receipts, id);
export const clearAllPendingReceipts = () => clearStore(STORES.receipts);
export const getPendingReceiptCount = () => countItems(STORES.receipts);

// ═══════════════════════════════════════════════════════════════════════════════
//  DOCUMENTS
// ═══════════════════════════════════════════════════════════════════════════════

export const savePendingDocument = (doc: PendingDocument) => putItem(STORES.documents, doc);
export const getPendingDocuments = () => getAllItems<PendingDocument>(STORES.documents);
export const deletePendingDocument = (id: string) => deleteItem(STORES.documents, id);
export const clearAllPendingDocuments = () => clearStore(STORES.documents);
export const getPendingDocumentCount = () => countItems(STORES.documents);

// ═══════════════════════════════════════════════════════════════════════════════
//  LAB REPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export const savePendingLabReport = (report: PendingLabReport) => putItem(STORES.labReports, report);
export const getPendingLabReports = () => getAllItems<PendingLabReport>(STORES.labReports);
export const deletePendingLabReport = (id: string) => deleteItem(STORES.labReports, id);
export const clearAllPendingLabReports = () => clearStore(STORES.labReports);
export const getPendingLabReportCount = () => countItems(STORES.labReports);

// ═══════════════════════════════════════════════════════════════════════════════
//  AGGREGATE
// ═══════════════════════════════════════════════════════════════════════════════

/** Total count of all pending items across every store. */
export async function getTotalPendingCount(): Promise<number> {
    const counts = await Promise.all([
        getPendingScanCount(),
        getPendingRegistrationCount(),
        getPendingReceiptCount(),
        getPendingDocumentCount(),
        getPendingLabReportCount(),
    ]);
    return counts.reduce((a, b) => a + b, 0);
}
