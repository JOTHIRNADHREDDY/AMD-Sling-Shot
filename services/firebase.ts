/**
 * Firebase configuration & initialisation for the MediKiosk project.
 *
 * Exports:
 *   app       – FirebaseApp singleton
 *   analytics – Firebase Analytics (browser-only)
 *   storage   – Cloud Storage instance
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAnalytics, isSupported as isAnalyticsSupported, type Analytics } from 'firebase/analytics';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

// ── Firebase config ──────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "",
};

// Avoid re-initialising when Vite hot-reloads
const app: FirebaseApp =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// ── Analytics (guard for SSR / environments that block it) ───────────────────

let analytics: Analytics | null = null;
isAnalyticsSupported()
  .then((supported) => {
    if (supported) analytics = getAnalytics(app);
  })
  .catch(() => {
    /* analytics unavailable — ignore */
  });

// ── Cloud Storage instance ───────────────────────────────────────────────────

const storage: FirebaseStorage = getStorage(app);

// ── Connection health helper ─────────────────────────────────────────────────

/**
 * Quick connectivity check — tries to fetch the storage emulator /
 * production endpoint.  Returns true if the Firebase backend is reachable.
 */
export async function isFirebaseReachable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4_000);
    await fetch(`https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}`, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

export { app, analytics, storage };
