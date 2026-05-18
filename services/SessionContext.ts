/**
 * ════════════════════════════════════════════════════════════════════════════════
 * Session Context Memory (Section 8 — Cross-flow state persistence)
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * Stores session-level context that persists across screens and voice commands.
 * Used for:
 *  - Remembering the last token so "What is my queue status?" auto-uses it
 *  - Remembering the last department for follow-up queries
 *  - Tracking which flow the user is currently in
 *  - Storing partial form data across screens
 *  - **FlowLock** — prevents screen drift during active flows
 *
 * Persisted in sessionStorage for tab-lifetime persistence.
 */

import { debugLog } from './AppBrain';

// ── Flow Lock ─────────────────────────────────────────────────────────────────

export type ActiveFlowType = 'registration' | 'complaint' | null;

export interface FlowLockState {
  /** Which flow is currently active (null = none) */
  activeFlow: ActiveFlowType;
  /** Current step within the flow (e.g. 'NAME', 'AGE') */
  currentStep: string;
  /** Whether the screen is locked to the flow's screen */
  screenLocked: boolean;
}

/**
 * Global flow-lock singleton.
 * Rules:
 *  - When activeFlow is non-null, only flow-related or exit commands are allowed
 *  - Navigation is blocked unless user says "cancel" / "home" / "start over"
 *  - Reset only after flow completes or user cancels
 */
class FlowLock {
  private state: FlowLockState = { activeFlow: null, currentStep: 'IDLE', screenLocked: false };

  get(): FlowLockState { return { ...this.state }; }
  isLocked(): boolean { return this.state.activeFlow !== null && this.state.screenLocked; }
  getActiveFlow(): ActiveFlowType { return this.state.activeFlow; }
  getCurrentStep(): string { return this.state.currentStep; }

  /** Activate a flow lock — blocks unrelated navigation. */
  activate(flow: 'registration' | 'complaint', startStep: string = 'IDLE') {
    this.state = { activeFlow: flow, currentStep: startStep, screenLocked: true };
    debugLog({ type: 'ACTION', action: 'FLOW_LOCK_ACTIVATE', detail: { flow, step: startStep } });
  }

  /** Update the current step within the locked flow. */
  setStep(step: string) {
    this.state.currentStep = step;
    debugLog({ type: 'ACTION', action: 'FLOW_LOCK_STEP', detail: { flow: this.state.activeFlow, step } });
  }

  /** Release the flow lock (flow completed or cancelled). */
  release() {
    debugLog({ type: 'ACTION', action: 'FLOW_LOCK_RELEASE', detail: { wasFlow: this.state.activeFlow } });
    this.state = { activeFlow: null, currentStep: 'IDLE', screenLocked: false };
  }

  /**
   * Check whether a navigation intent should be allowed.
   * During an active flow, only 'cancel', 'home', 'start over' can navigate away.
   */
  /**
   * Get the designated screen for the current flow.
   * Returns null if no flow is active.
   */
  getFlowScreen(): string | null {
    if (this.state.activeFlow === 'registration') return 'REGISTRATION';
    if (this.state.activeFlow === 'complaint') return 'COMPLAINT';
    return null;
  }

  shouldAllowNavigation(intentType: string): boolean {
    if (!this.isLocked()) return true;
    // Always allow exit intents
    const EXIT_INTENTS = ['START_OVER', 'NAVIGATE_SCREEN'];
    if (EXIT_INTENTS.includes(intentType)) return true;
    // Allow re-triggering the same flow (user says "register" while already in registration)
    if (this.state.activeFlow === 'registration' && intentType === 'START_REGISTRATION') return true;
    if (this.state.activeFlow === 'complaint' && intentType === 'START_COMPLAINT') return true;
    // Block all other navigation
    debugLog({ type: 'BLOCKED', action: 'FLOW_LOCK_NAV_BLOCKED', detail: { intentType, activeFlow: this.state.activeFlow } });
    return false;
  }
}

export const flowLock = new FlowLock();

// ── Session Context Data ──────────────────────────────────────────────────────

export interface SessionContextData {
  lastToken?: string;
  lastDepartment?: string;
  currentFlow?: 'registration' | 'complaint' | 'queue' | null;
  lastPatientName?: string;
  lastRegistrationId?: string;
  /** Number of interactions in this session */
  interactionCount: number;
  /** Timestamp of last interaction */
  lastInteractionAt: number;
}

const STORAGE_KEY = 'medikiosk_session_context';

class SessionContextService {
  private data: SessionContextData;
  private listeners: Array<(data: SessionContextData) => void> = [];

  constructor() {
    this.data = this.load();
  }

  /** Get the full session context. */
  get(): SessionContextData {
    return { ...this.data };
  }

  /** Update one or more fields. */
  update(partial: Partial<SessionContextData>) {
    const old = { ...this.data };
    this.data = {
      ...this.data,
      ...partial,
      lastInteractionAt: Date.now(),
      interactionCount: this.data.interactionCount + 1,
    };
    this.save();
    debugLog({ type: 'ACTION', action: 'SESSION_CTX_UPDATE', detail: { changed: Object.keys(partial), data: this.data } });
    this.listeners.forEach(l => l(this.data));
  }

  /** Set the remembered token. */
  setToken(token: string) {
    this.update({ lastToken: token });
  }

  /** Get the remembered token, if any. */
  getToken(): string | undefined {
    return this.data.lastToken;
  }

  /** Set the current flow. */
  setFlow(flow: SessionContextData['currentFlow']) {
    this.update({ currentFlow: flow });
  }

  /** Get the current flow. */
  getFlow(): SessionContextData['currentFlow'] {
    return this.data.currentFlow;
  }

  /** Set last department for follow-ups. */
  setDepartment(dept: string) {
    this.update({ lastDepartment: dept });
  }

  /** Get last department. */
  getDepartment(): string | undefined {
    return this.data.lastDepartment;
  }

  /** Clear the session (e.g. kiosk reset). */
  clear() {
    this.data = {
      interactionCount: 0,
      lastInteractionAt: Date.now(),
    };
    this.save();
    debugLog({ type: 'ACTION', action: 'SESSION_CTX_CLEAR' });
    this.listeners.forEach(l => l(this.data));
  }

  /** Subscribe to context changes. */
  onChange(callback: (data: SessionContextData) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  private load(): SessionContextData {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch { /* ignore */ }
    return { interactionCount: 0, lastInteractionAt: Date.now() };
  }

  private save() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch { /* ignore */ }
  }
}

export const sessionContext = new SessionContextService();
