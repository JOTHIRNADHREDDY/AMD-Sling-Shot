/**
 * ════════════════════════════════════════════════════════════════════════════════
 * Clarification Guard (Section 7 — Prevent infinite clarification loops)
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * Tracks how many times the system has asked for clarification in a row.
 * After MAX_CLARIFY attempts, switches to manual input mode.
 *
 * Rules:
 *  - Max 2 consecutive clarification asks per field
 *  - After limit: prompt "Please type your answer" + activate manual input
 *  - Counter resets on successful field fill or screen change
 */

import { debugLog } from './AppBrain';

const MAX_CLARIFY_COUNT = 2;

class ClarificationGuardService {
  private clarifyCount: number = 0;
  private lastQuestion: string = '';
  private manualInputRequested: boolean = false;
  private listeners: Array<(manual: boolean, message: string) => void> = [];

  /**
   * Record a clarification ask. Returns whether we should still ask
   * (true = ok to ask, false = switch to manual input).
   */
  recordClarification(question: string): boolean {
    // Same question repeated → increment
    if (this.isSameQuestion(question)) {
      this.clarifyCount++;
    } else {
      // New question → reset counter
      this.clarifyCount = 1;
      this.lastQuestion = question;
    }

    debugLog({
      type: 'ACTION',
      action: 'CLARIFY_GUARD',
      detail: { count: this.clarifyCount, max: MAX_CLARIFY_COUNT, question: question.slice(0, 50) },
    });

    if (this.clarifyCount > MAX_CLARIFY_COUNT) {
      this.triggerManualInput();
      return false;
    }

    return true;
  }

  /**
   * Record a successful action (field filled, command executed).
   * Resets the clarification counter.
   */
  recordSuccess() {
    if (this.clarifyCount > 0) {
      debugLog({ type: 'ACTION', action: 'CLARIFY_GUARD_RESET', detail: { previousCount: this.clarifyCount } });
    }
    this.clarifyCount = 0;
    this.lastQuestion = '';
    this.manualInputRequested = false;
  }

  /**
   * Reset on screen change.
   */
  reset() {
    this.clarifyCount = 0;
    this.lastQuestion = '';
    this.manualInputRequested = false;
  }

  /** Whether manual input mode has been triggered. */
  isManualInputRequested(): boolean {
    return this.manualInputRequested;
  }

  /** Current clarification count for the same question. */
  getCount(): number {
    return this.clarifyCount;
  }

  /** Subscribe to manual input mode triggers. */
  onManualInput(callback: (manual: boolean, message: string) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  private triggerManualInput() {
    this.manualInputRequested = true;
    const message = "I'm having trouble understanding. Please type your answer instead.";
    debugLog({ type: 'ACTION', action: 'CLARIFY_GUARD_MANUAL', detail: { count: this.clarifyCount, message } });
    this.listeners.forEach(l => l(true, message));
  }

  private isSameQuestion(question: string): boolean {
    if (!this.lastQuestion) return false;
    // Fuzzy match — same first 30 chars lowered
    const a = this.lastQuestion.toLowerCase().slice(0, 30);
    const b = question.toLowerCase().slice(0, 30);
    return a === b;
  }
}

export const clarificationGuard = new ClarificationGuardService();
