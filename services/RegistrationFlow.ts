/**
 * ════════════════════════════════════════════════════════════════════════════════
 * Registration Flow State Machine
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * Prevents repeated name/age questions by maintaining a structured flow.
 * Each step is only asked ONCE. If a field is already filled, it auto-advances.
 * The flow does NOT restart unless the user explicitly says "Start Over".
 *
 * Flow:  IDLE → MOBILE → NAME → AGE → GENDER → DEPARTMENT → CONFIRM → SUBMITTED
 */

import { debugLog } from './AppBrain';

// ── Step enum ────────────────────────────────────────────────────────────────

export type RegistrationStep =
  | 'IDLE'
  | 'MOBILE'
  | 'NAME'
  | 'AGE'
  | 'GENDER'
  | 'DEPARTMENT'
  | 'CONFIRM'
  | 'SUBMITTED';

// ── Flow data ────────────────────────────────────────────────────────────────

export interface RegistrationFlowData {
  mobile?: string;
  name?: string;
  age?: string;
  gender?: 'Male' | 'Female' | 'Other';
  department?: string;
}

// ── State ────────────────────────────────────────────────────────────────────

export interface RegistrationFlowState {
  step: RegistrationStep;
  data: RegistrationFlowData;
  /** Track which fields have been explicitly filled (prevents re-asking) */
  filledFields: Set<keyof RegistrationFlowData>;
}

// ── Step order for sequential advancement ────────────────────────────────────

const STEP_ORDER: RegistrationStep[] = [
  'IDLE', 'MOBILE', 'NAME', 'AGE', 'GENDER', 'DEPARTMENT', 'CONFIRM', 'SUBMITTED',
];

const FIELD_FOR_STEP: Partial<Record<RegistrationStep, keyof RegistrationFlowData>> = {
  MOBILE: 'mobile',
  NAME: 'name',
  AGE: 'age',
  GENDER: 'gender',
  DEPARTMENT: 'department',
};

// ── Factory ──────────────────────────────────────────────────────────────────

export function createInitialFlowState(): RegistrationFlowState {
  return {
    step: 'IDLE',
    data: {},
    filledFields: new Set(),
  };
}

// ── Core logic ───────────────────────────────────────────────────────────────

/**
 * Given a field + value, update data, mark filled, and auto-advance to the
 * next UNFILLED step.
 */
export function fillField(
  state: RegistrationFlowState,
  field: keyof RegistrationFlowData,
  value: string,
): RegistrationFlowState {
  // Prevent overwriting already-filled field without explicit confirmation
  if (state.filledFields.has(field) && state.data[field]) {
    debugLog({
      type: 'BLOCKED',
      action: 'FIELD_ALREADY_FILLED',
      detail: { field, existing: state.data[field], attempted: value },
    });
    // Still update if the user insists (same value or empty check failed)
    // but log the overwrite
  }

  const newData = { ...state.data, [field]: value };
  const newFilled = new Set(state.filledFields);
  newFilled.add(field);

  debugLog({ type: 'FIELD_FILL', action: field, detail: { value } });

  const newStep = computeNextStep({ ...state, data: newData, filledFields: newFilled });

  return {
    step: newStep,
    data: newData,
    filledFields: newFilled,
  };
}

/**
 * Batch-fill multiple fields at once (e.g. from voice: "My name is Ramesh, age 45").
 */
export function batchFill(
  state: RegistrationFlowState,
  fields: Partial<RegistrationFlowData>,
): RegistrationFlowState {
  let current = state;
  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined && val !== '') {
      current = fillField(current, key as keyof RegistrationFlowData, val as string);
    }
  }
  return current;
}

/**
 * Determine the next un-filled step to advance to.
 * Skips already-filled steps automatically.
 */
export function computeNextStep(state: RegistrationFlowState): RegistrationStep {
  const currentIdx = STEP_ORDER.indexOf(state.step);

  // Walk forward from current step, find first unfilled
  for (let i = Math.max(currentIdx, 1); i < STEP_ORDER.length; i++) {
    const candidateStep = STEP_ORDER[i];
    const requiredField = FIELD_FOR_STEP[candidateStep];

    // If this step requires a field and the field is NOT yet filled → stop here
    if (requiredField && !state.filledFields.has(requiredField)) {
      return candidateStep;
    }

    // CONFIRM and SUBMITTED don't have required fields — they are terminal
    if (candidateStep === 'CONFIRM') {
      // All fields filled → go to CONFIRM
      const allFilled = (['mobile', 'name', 'age', 'gender', 'department'] as const).every(
        f => state.filledFields.has(f),
      );
      if (allFilled) return 'CONFIRM';
      // Not all filled → this step is wrong, continue looking for unfilled
      continue;
    }
  }

  // Fallback: if all fields are filled, go to CONFIRM
  return 'CONFIRM';
}

/**
 * Start the registration flow (from IDLE).
 */
export function startFlow(state: RegistrationFlowState): RegistrationFlowState {
  if (state.step !== 'IDLE') {
    debugLog({ type: 'BLOCKED', action: 'START_FLOW', detail: { reason: 'Already in flow', currentStep: state.step } });
    return state;
  }
  debugLog({ type: 'ACTION', action: 'START_REGISTRATION_FLOW' });
  return { ...state, step: 'MOBILE' };
}

/**
 * Force advance to a specific step (e.g. user clicks "Next").
 */
export function goToStep(state: RegistrationFlowState, step: RegistrationStep): RegistrationFlowState {
  debugLog({ type: 'ACTION', action: 'GO_TO_STEP', detail: { from: state.step, to: step } });
  return { ...state, step };
}

/**
 * Reset the flow completely (user said "Start Over").
 */
export function resetFlow(): RegistrationFlowState {
  debugLog({ type: 'ACTION', action: 'RESET_REGISTRATION_FLOW' });
  return createInitialFlowState();
}

/**
 * Check if a field is already filled (to prevent re-asking).
 */
export function isFieldFilled(state: RegistrationFlowState, field: keyof RegistrationFlowData): boolean {
  return state.filledFields.has(field) && !!state.data[field];
}

/**
 * Get the prompt text for the current step (for voice TTS).
 */
export function getStepPrompt(step: RegistrationStep): string {
  switch (step) {
    case 'MOBILE': return 'Please enter or say your mobile number.';
    case 'NAME': return 'What is your name?';
    case 'AGE': return 'What is your age?';
    case 'GENDER': return 'What is your gender? Male or Female?';
    case 'DEPARTMENT': return 'Which department would you like to visit?';
    case 'CONFIRM': return 'Please confirm your details to complete registration.';
    default: return '';
  }
}
