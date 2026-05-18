/**
 * ════════════════════════════════════════════════════════════════════════════════
 * Voice Command Engine — Central orchestration layer
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * This is the single orchestration point for ALL voice → action processing.
 * It ties together:
 *  - IntentRouter (classification)
 *  - ClarificationGuard (loop prevention)
 *  - SessionContext (cross-flow memory)
 *  - RegistrationFlow (form state machine)
 *  - AppBrain (dispatch + animation)
 *  - ConfidenceFilter (STT quality gate)
 *
 * Flow:
 *  transcript
 *    → ConfidenceFilter (reject < 0.7)
 *    → IntentRouter.classifyIntent() (screen-independent)
 *    → SessionContext enrichment (add stored token/dept)
 *    → ClarificationGuard check
 *    → IntentRouter.dispatchIntent() (screen-aware execution)
 *    → dispatch to KioskContext actions
 *    → optionally forward to backend LLM
 */

import { ScreenName } from '../types';
import { debugLog, voiceAutoClick } from './AppBrain';
import { processVoiceInput, type ClassifiedIntent, type IntentAction } from './IntentRouter';
import { clarificationGuard } from './ClarificationGuard';
import { sessionContext, flowLock } from './SessionContext';
import { detectScriptMismatch, isGarbageTranscript, type ConfidenceLevel } from './VoiceNormalizer';
import type { RegistrationFlowState, RegistrationFlowData } from './RegistrationFlow';

// ── Confidence filter ─────────────────────────────────────────────────────────

const LOW_CONFIDENCE_THRESHOLD: ConfidenceLevel = 'low';

export interface ConfidenceFilterResult {
  pass: boolean;
  message?: string;
}

/**
 * Check if transcript confidence is high enough to act on.
 * Returns false if confidence is too low and we should ask for repetition.
 */
export function filterByConfidence(confidence: ConfidenceLevel | null): ConfidenceFilterResult {
  if (!confidence || confidence === LOW_CONFIDENCE_THRESHOLD) {
    debugLog({ type: 'ACTION', action: 'CONFIDENCE_FILTER_REJECT', detail: { confidence } });
    return {
      pass: false,
      message: "I'm not sure I understood. Could you please repeat that?",
    };
  }
  return { pass: true };
}

// ── Engine Result ─────────────────────────────────────────────────────────────

export interface VoiceCommandResult {
  /** The classified intent */
  intent: ClassifiedIntent;
  /** The dispatched action */
  action: IntentAction;
  /** Whether the command was handled locally (no backend needed) */
  handledLocally: boolean;
  /** Whether to forward transcript to backend LLM */
  forwardToBackend: boolean;
  /** Message to speak/show to user (e.g. from confidence filter or clarification guard) */
  userMessage?: string;
  /** Whether manual input was triggered (clarification limit hit) */
  manualInputTriggered?: boolean;
  /** Whether confidence was too low */
  lowConfidence?: boolean;
  /** Navigation target, if any */
  navigateTo?: ScreenName;
  /** Field to fill, if in registration flow */
  fillField?: { field: string; value: string };
  /** Button to auto-click, if any */
  autoClickButton?: string;
}

// ── Main Engine ───────────────────────────────────────────────────────────────

/**
 * Process a voice transcript through the full engine pipeline.
 *
 * @param transcript — Raw STT output
 * @param currentScreen — Current screen the user is on
 * @param confidence — STT confidence level
 * @param regFlow — Current registration flow state (for context-aware field filling)
 */
export function processVoiceCommand(
  transcript: string,
  currentScreen: ScreenName,
  confidence: ConfidenceLevel = 'medium',
  regFlow?: RegistrationFlowState,
  language?: string,
): VoiceCommandResult {
  debugLog({
    type: 'VOICE_INPUT', action: 'ENGINE_START',
    detail: { transcript, screen: currentScreen, confidence, flowLocked: flowLock.isLocked(), activeFlow: flowLock.getActiveFlow() },
  });

  // ── Step 0: Garbage / script-mismatch filter ───────────────────────────
  if (isGarbageTranscript(transcript)) {
    debugLog({ type: 'ACTION', action: 'GARBAGE_TRANSCRIPT_REJECT', detail: { transcript } });
    return {
      intent: { type: 'UNKNOWN', confidence: 'low', raw: transcript, normalized: transcript },
      action: { actionType: 'LOCAL_RESPONSE', message: "I didn't catch that. Could you repeat?", forwardToBackend: false },
      handledLocally: true,
      forwardToBackend: false,
      userMessage: "I didn't catch that. Could you repeat?",
      lowConfidence: true,
    };
  }

  const scriptCheck = detectScriptMismatch(transcript, language || 'en', confidence);
  if (scriptCheck === 'low') {
    debugLog({ type: 'ACTION', action: 'SCRIPT_MISMATCH_REJECT', detail: { transcript, language, detectedConfidence: scriptCheck } });
    return {
      intent: { type: 'UNKNOWN', confidence: 'low', raw: transcript, normalized: transcript },
      action: { actionType: 'LOCAL_RESPONSE', message: "I couldn't understand that. Please try again.", forwardToBackend: false },
      handledLocally: true,
      forwardToBackend: false,
      userMessage: "I couldn't understand that. Please try again.",
      lowConfidence: true,
    };
  }

  // ── Step 1: Intent classification (screen-INDEPENDENT) ─────────────────
  // Classify BEFORE confidence filter so exact Layer-1 commands (yes/no/ok)
  // can bypass low-confidence rejection.
  const { intent, action } = processVoiceInput(transcript, currentScreen, confidence);

  // ── Step 2: Confidence filter ──────────────────────────────────────────
  // Exact-match Layer 1 commands are trusted even at low confidence
  if (intent.matchLayer !== 'exact') {
    const confidenceCheck = filterByConfidence(confidence);
    if (!confidenceCheck.pass) {
      return {
        intent: { type: 'UNKNOWN', confidence: confidence || 'low', raw: transcript, normalized: transcript },
        action: { actionType: 'LOCAL_RESPONSE', message: confidenceCheck.message, forwardToBackend: false },
        handledLocally: true,
        forwardToBackend: false,
        userMessage: confidenceCheck.message,
        lowConfidence: true,
      };
    }
  }

  // ── Step 3: FlowLock navigation guard ──────────────────────────────────
  // If a flow is active, block navigation UNLESS user explicitly wants to exit
  // or is navigating to the flow's own screen
  if (flowLock.isLocked() && action.actionType === 'NAVIGATE' && action.screen !== currentScreen) {
    // Allow navigation to the flow's own screen (e.g. REGISTRATION when flow='registration')
    const flowScreenKey = flowLock.getFlowScreen();
    const flowScreenMap: Record<string, ScreenName> = { REGISTRATION: ScreenName.REGISTRATION, COMPLAINT: ScreenName.COMPLAINT };
    const allowedScreen = flowScreenKey ? flowScreenMap[flowScreenKey] : null;
    const isFlowScreen = action.screen === allowedScreen;

    if (!isFlowScreen && !flowLock.shouldAllowNavigation(intent.type)) {
      debugLog({
        type: 'BLOCKED', action: 'FLOW_LOCK_NAV_BLOCKED',
        detail: { intentType: intent.type, blockedScreen: action.screen, activeFlow: flowLock.getActiveFlow(), currentStep: flowLock.getCurrentStep() },
      });
      // Instead of navigating, forward to backend for in-flow handling
      return {
        intent,
        action: { actionType: 'SEND_TO_BACKEND', forwardToBackend: true },
        handledLocally: false,
        forwardToBackend: true,
        userMessage: `You're currently in ${flowLock.getActiveFlow()}. Say "cancel" or "start over" to exit.`,
      };
    }
  }

  // ── Step 3: Session context enrichment ─────────────────────────────────
  enrichWithSessionContext(intent, action);

  // ── Step 4: Registration flow context ──────────────────────────────────
  const regResult = handleRegistrationContext(intent, action, regFlow);
  if (regResult) {
    clarificationGuard.recordSuccess();
    return regResult;
  }

  // ── Step 5: Build result ───────────────────────────────────────────────
  const result: VoiceCommandResult = {
    intent,
    action,
    handledLocally: !action.forwardToBackend,
    forwardToBackend: action.forwardToBackend ?? true,
    navigateTo: action.screen,
    userMessage: action.message,
  };

  // ── Step 6: Session context updates ────────────────────────────────────
  if (intent.type === 'LOOKUP_TOKEN' && intent.value) {
    sessionContext.setToken(intent.value);
  }
  if (intent.type === 'FIND_ROOM' && intent.value) {
    sessionContext.setDepartment(intent.value);
  }
  if (intent.type === 'START_REGISTRATION') {
    sessionContext.setFlow('registration');
  }
  if (intent.type === 'START_COMPLAINT') {
    sessionContext.setFlow('complaint');
  }
  if (intent.type === 'START_OVER') {
    sessionContext.setFlow(null);
  }

  // ── Step 7: Button auto-click handling ─────────────────────────────────
  if (action.actionType === 'DISPATCH_INTERACT' && intent.type === 'TRIGGER_BUTTON' && intent.value) {
    result.autoClickButton = intent.value;
  }

  // ── Step 8: Record success for non-clarification actions ───────────────
  if (intent.type !== 'UNKNOWN') {
    clarificationGuard.recordSuccess();
  }

  debugLog({
    type: 'VOICE_INPUT',
    action: 'ENGINE_RESULT',
    detail: {
      intent: intent.type,
      action: action.actionType,
      handledLocally: result.handledLocally,
      forwardToBackend: result.forwardToBackend,
      navigateTo: result.navigateTo,
      layer: intent.matchLayer,
      activeFlow: flowLock.getActiveFlow(),
      flowStep: flowLock.getCurrentStep(),
    },
  });

  return result;
}

/**
 * Handle a clarification message from the backend.
 * Returns whether the clarification should be shown to the user
 * (false = manual input mode activated instead).
 */
export function handleClarification(message: string): { show: boolean; manualInput: boolean; fallbackMessage?: string } {
  const shouldAsk = clarificationGuard.recordClarification(message);
  if (!shouldAsk) {
    return {
      show: false,
      manualInput: true,
      fallbackMessage: "I'm having trouble understanding. Please type your answer instead.",
    };
  }
  return { show: true, manualInput: false };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function enrichWithSessionContext(intent: ClassifiedIntent, action: IntentAction) {
  // If querying status and we have a stored token → inject it
  if (intent.type === 'QUERY_STATUS' && !intent.value) {
    const storedToken = sessionContext.getToken();
    if (storedToken) {
      intent.value = storedToken;
      action.value = storedToken;
      debugLog({ type: 'ACTION', action: 'SESSION_CTX_INJECT', detail: { field: 'token', value: storedToken } });
    }
  }

  // If finding a room and we don't have a department, use last department
  if (intent.type === 'FIND_ROOM' && !intent.value) {
    const storedDept = sessionContext.getDepartment();
    if (storedDept) {
      intent.value = storedDept;
      action.value = storedDept;
      debugLog({ type: 'ACTION', action: 'SESSION_CTX_INJECT', detail: { field: 'department', value: storedDept } });
    }
  }
}

/**
 * If the user is in a registration flow and says a simple value like "Lucky" or "18",
 * map it to the expected field based on the current registration step.
 */
function handleRegistrationContext(
  intent: ClassifiedIntent,
  action: IntentAction,
  regFlow?: RegistrationFlowState,
): VoiceCommandResult | null {
  if (!regFlow || regFlow.step === 'IDLE' || regFlow.step === 'CONFIRM' || regFlow.step === 'SUBMITTED') {
    return null;
  }

  // Map current registration step to the expected field
  const stepFieldMap: Record<string, keyof RegistrationFlowData> = {
    MOBILE: 'mobile',
    NAME: 'name',
    AGE: 'age',
    GENDER: 'gender',
    DEPARTMENT: 'department',
  };

  const expectedField = stepFieldMap[regFlow.step];
  if (!expectedField) return null;

  // If the intent is FILL_FIELD, great — it's explicit
  if (intent.type === 'FILL_FIELD' && intent.data?.field && intent.value) {
    return {
      intent,
      action,
      handledLocally: false,
      forwardToBackend: true,
      fillField: { field: intent.data.field, value: intent.value },
    };
  }

  // If the intent is UNKNOWN and we're in a registration flow,
  // treat the raw transcript as the value for the expected field.
  // This is the KEY fix for "Lucky" being misclassified as unknown.
  if (intent.type === 'UNKNOWN') {
    const rawValue = intent.normalized.trim();
    if (rawValue && rawValue.length > 0 && rawValue.length < 100) {
      debugLog({
        type: 'PARSED_COMMAND',
        action: 'REG_CONTEXT_MAP',
        detail: { rawValue, expectedField, step: regFlow.step },
      });

      return {
        intent: { ...intent, type: 'FILL_FIELD', value: rawValue, data: { field: expectedField } },
        action: { actionType: 'FILL_REG_FIELD', field: expectedField, value: rawValue, forwardToBackend: true },
        handledLocally: false,
        forwardToBackend: true,
        fillField: { field: expectedField, value: rawValue },
      };
    }
  }

  return null;
}
