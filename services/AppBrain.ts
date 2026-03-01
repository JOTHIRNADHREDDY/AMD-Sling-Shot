/**
 * ════════════════════════════════════════════════════════════════════════════════
 * Central Interaction Controller — "App Brain"
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * ALL interactions (voice, touch, programmatic) MUST flow through this controller.
 * Buttons do NOT directly execute logic — they dispatch actions here.
 * Voice commands use the same actions.
 *
 * Features:
 *  - Global action dispatcher with type-safe command envelopes
 *  - Action debouncing (prevents double-execution)
 *  - Interaction lock during transitions
 *  - Full action logging for debugging
 *  - Confirmation gating for destructive actions
 *  - Field overwrite protection
 */

import { ScreenName, InteractionAction, InteractionActionType } from '../types';

// ── Debug Mode ────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    APP_DEBUG: boolean;
    APP_BRAIN_LOG: BrainLogEntry[];
  }
}

// Initialize debug mode
if (typeof window !== 'undefined') {
  window.APP_DEBUG = window.APP_DEBUG ?? false;
  window.APP_BRAIN_LOG = window.APP_BRAIN_LOG ?? [];
}

export interface BrainLogEntry {
  timestamp: number;
  type: 'ACTION' | 'VOICE_INPUT' | 'PARSED_COMMAND' | 'NAVIGATION' | 'FIELD_FILL' | 'ERROR' | 'BLOCKED' | 'CONFIRMED' | 'STT' | 'TTS';
  action?: string;
  detail?: unknown;
}

// ── Debug Mode Control ────────────────────────────────────────────────────────

export function enableDebug() {
  if (typeof window !== 'undefined') {
    window.APP_DEBUG = true;
    (window as any).VOICE_DEBUG = true;
    console.log('[App Brain] Debug mode ENABLED — all voice/intent/dispatch logs visible');
  }
}

export function disableDebug() {
  if (typeof window !== 'undefined') {
    window.APP_DEBUG = false;
    (window as any).VOICE_DEBUG = false;
    console.log('[App Brain] Debug mode DISABLED');
  }
}

export function isDebugEnabled(): boolean {
  return typeof window !== 'undefined' && window.APP_DEBUG;
}

// Expose on window for console access
if (typeof window !== 'undefined') {
  (window as any).enableVoiceDebug = enableDebug;
  (window as any).disableVoiceDebug = disableDebug;
  (window as any).getVoiceLogs = () => window.APP_BRAIN_LOG;
}

function debugLog(entry: Omit<BrainLogEntry, 'timestamp'>) {
  const full: BrainLogEntry = { ...entry, timestamp: Date.now() };
  if (typeof window !== 'undefined') {
    window.APP_BRAIN_LOG.push(full);
    // Keep log bounded
    if (window.APP_BRAIN_LOG.length > 500) {
      window.APP_BRAIN_LOG = window.APP_BRAIN_LOG.slice(-300);
    }
  }
  if (typeof window !== 'undefined' && window.APP_DEBUG) {
    const tag = `[App Brain][${entry.type}]`;
    console.log(tag, entry.action ?? '', entry.detail ?? '');
  }
}

// ── Action Debouncer ──────────────────────────────────────────────────────────

const DEBOUNCE_MS = 350;
const lastActionTime: Map<string, number> = new Map();

export function isDebouncedAction(actionType: string, targetKey?: string): boolean {
  const key = `${actionType}:${targetKey ?? ''}`;
  const now = Date.now();
  const last = lastActionTime.get(key);
  if (last && now - last < DEBOUNCE_MS) {
    debugLog({ type: 'BLOCKED', action: 'DEBOUNCE', detail: { key, elapsed: now - (last ?? 0) } });
    return true;
  }
  lastActionTime.set(key, now);
  return false;
}

// ── Interaction Lock ──────────────────────────────────────────────────────────

let _locked = false;
let _lockTimer: ReturnType<typeof setTimeout> | null = null;
const _lockListeners: Array<(locked: boolean) => void> = [];

export function isInteractionLocked(): boolean {
  return _locked;
}

export function lockInteraction(durationMs = 400): void {
  _locked = true;
  _lockListeners.forEach(fn => fn(true));
  debugLog({ type: 'ACTION', action: 'LOCK', detail: { durationMs } });
  if (_lockTimer) clearTimeout(_lockTimer);
  _lockTimer = setTimeout(() => {
    _locked = false;
    _lockListeners.forEach(fn => fn(false));
    debugLog({ type: 'ACTION', action: 'UNLOCK' });
  }, durationMs);
}

export function onLockChange(fn: (locked: boolean) => void): () => void {
  _lockListeners.push(fn);
  return () => {
    const idx = _lockListeners.indexOf(fn);
    if (idx >= 0) _lockListeners.splice(idx, 1);
  };
}

// ── Highlight / Animation ──────────────────────────────────────────────────────

export function highlightElement(elementId: string, durationMs = 1200): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.classList.add('brain-highlight');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  debugLog({ type: 'ACTION', action: 'HIGHLIGHT', detail: { elementId } });
  setTimeout(() => el.classList.remove('brain-highlight'), durationMs);
}

export function animateAutoClick(elementId: string): void {
  const el = document.getElementById(elementId);
  if (!el) {
    debugLog({ type: 'ERROR', action: 'AUTO_CLICK_ANIM', detail: { elementId, error: 'Element not found' } });
    return;
  }
  // Step 1: Scroll into view
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Step 2: Add highlight + pulse animation
  el.classList.add('brain-auto-click', 'brain-pulse');
  debugLog({ type: 'ACTION', action: 'AUTO_CLICK_ANIM', detail: { elementId } });
  // Step 3: Remove animation classes after effect completes
  setTimeout(() => {
    el.classList.remove('brain-auto-click', 'brain-pulse');
  }, 800);
}

/**
 * Visually animate a button being auto-clicked by voice:
 * 1. Highlight the button
 * 2. Add pulse ring effect
 * 3. Trigger actual click
 * 4. Clean up animation classes
 */
export function voiceAutoClick(elementId: string): boolean {
  const el = document.getElementById(elementId);
  if (!el) {
    debugLog({ type: 'ERROR', action: 'VOICE_AUTO_CLICK', detail: { elementId, error: 'Element not found' } });
    return false;
  }

  // Scroll into view first
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Add visual feedback classes
  el.classList.add('brain-highlight', 'brain-pulse', 'brain-auto-click');

  debugLog({ type: 'ACTION', action: 'VOICE_AUTO_CLICK', detail: { elementId } });

  // Perform the actual click after brief visual delay (user sees the animation)
  setTimeout(() => {
    el.click();
    debugLog({ type: 'ACTION', action: 'VOICE_AUTO_CLICK_FIRED', detail: { elementId } });
  }, 300);

  // Clean up animation classes
  setTimeout(() => {
    el.classList.remove('brain-highlight', 'brain-pulse', 'brain-auto-click');
  }, 1200);

  return true;
}

// ── Scroll To ─────────────────────────────────────────────────────────────────

export function scrollToElement(elementId: string): void {
  const el = document.getElementById(elementId);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    debugLog({ type: 'ACTION', action: 'SCROLL_TO', detail: { elementId } });
  } else {
    debugLog({ type: 'ERROR', action: 'SCROLL_TO', detail: { elementId, error: 'Element not found' } });
  }
}

// ── Department Map (for voice → department routing) ───────────────────────────

export const DEPARTMENT_VOICE_MAP: Record<string, string> = {
  'cardiology': 'Cardiology',
  'heart': 'Cardiology',
  'general medicine': 'General Medicine',
  'fever': 'General Medicine',
  'cold': 'General Medicine',
  'orthopedics': 'Orthopedics',
  'bones': 'Orthopedics',
  'bone': 'Orthopedics',
  'pediatrics': 'Pediatrics',
  'child': 'Pediatrics',
  'children': 'Pediatrics',
  'baby': 'Pediatrics',
  'gynecology': 'Gynecology',
  'women': 'Gynecology',
  'ophthalmology': 'Ophthalmology',
  'eye': 'Ophthalmology',
  'eyes': 'Ophthalmology',
  'dermatology': 'Dermatology',
  'skin': 'Dermatology',
  'ent': 'ENT',
  'ear': 'ENT',
  'nose': 'ENT',
  'throat': 'ENT',
  'neurology': 'Neurology',
  'brain': 'Neurology',
  'pharmacy': 'Pharmacy',
  'medicine': 'Pharmacy',
  'medicines': 'Pharmacy',
  'laboratory': 'Laboratory',
  'lab': 'Laboratory',
  'radiology': 'Radiology',
  'xray': 'Radiology',
  'x-ray': 'Radiology',
  'scan': 'Radiology',
};

export function resolveDepartment(input: string): string | null {
  const normalized = input.toLowerCase().trim();
  if (DEPARTMENT_VOICE_MAP[normalized]) return DEPARTMENT_VOICE_MAP[normalized];
  // Fuzzy: check if input contains a key
  for (const [key, dept] of Object.entries(DEPARTMENT_VOICE_MAP)) {
    if (normalized.includes(key)) return dept;
  }
  return null;
}

// ── Central log export ───────────────────────────────────────────────────────

export { debugLog };
