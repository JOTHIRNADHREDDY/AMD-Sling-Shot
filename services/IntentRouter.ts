/**
 * ════════════════════════════════════════════════════════════════════════════════
 * Global Intent Router (Section 2 — Central Voice Intelligence)
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * Every voice transcript goes through this router BEFORE screen-specific logic.
 * Intent classification is screen-INDEPENDENT — the current screen only affects
 * execution, never classification.
 *
 * Layered Detection System:
 *   Layer 1: Exact command match (highest priority)
 *   Layer 2: Numeric / structural pattern recognition (10-digit mobile, token, age)
 *   Layer 3: Keyword map (registration, complaint, queue, etc.)
 *   Layer 4: Medical keyword / department synonym detection
 *   Layer 5: Fallback → UNKNOWN (forward to backend LLM)
 *
 * Navigation is ONLY triggered by explicit navigation commands:
 *   "open", "go to", "show", exact screen names
 *
 * Flow:  transcript → classifyIntent() → dispatchIntent() → action
 */

import { ScreenName } from '../types';
import { debugLog, resolveDepartment } from './AppBrain';
import {
  normalizeVoiceInput,
  extractToken,
  extractName,
  extractAge,
  extractGender,
  extractMobile,
  type ConfidenceLevel,
} from './VoiceNormalizer';

// ── Intent Types ──────────────────────────────────────────────────────────────

export type IntentType =
  | 'NAVIGATE_SCREEN'
  | 'TRIGGER_BUTTON'
  | 'FILL_FIELD'
  | 'QUERY_STATUS'
  | 'START_REGISTRATION'
  | 'START_COMPLAINT'
  | 'FIND_ROOM'
  | 'VIEW_RECEIPT'
  | 'VIEW_LAB_TESTS'
  | 'LOOKUP_TOKEN'
  | 'CONFIRM_YES'
  | 'CONFIRM_NO'
  | 'START_OVER'
  | 'HELP'
  | 'CHANGE_LANGUAGE'
  | 'UNKNOWN';

export interface ClassifiedIntent {
  type: IntentType;
  /** Extracted value (name, age, department, token, screen target, etc.) */
  value?: string;
  /** Additional extracted data */
  data?: Record<string, string>;
  /** Confidence in the classification */
  confidence: ConfidenceLevel;
  /** Original raw transcript */
  raw: string;
  /** Normalized transcript */
  normalized: string;
  /** Which detection layer matched */
  matchLayer?: 'exact' | 'pattern' | 'keyword' | 'medical' | 'fallback';
}

export interface IntentAction {
  /** What the UI should do */
  actionType: 'NAVIGATE' | 'DISPATCH_INTERACT' | 'FILL_REG_FIELD' | 'SEND_TO_BACKEND' | 'LOCAL_RESPONSE' | 'CONFIRM' | 'REJECT' | 'RESET';
  /** Target screen for navigation */
  screen?: ScreenName;
  /** Field name for registration fill */
  field?: string;
  /** Value for fill / token / department */
  value?: string;
  /** Additional data */
  data?: Record<string, string>;
  /** Message to speak/show */
  message?: string;
  /** Whether to also forward to the backend LLM */
  forwardToBackend?: boolean;
}

// ─── LAYER 1: Exact command phrases ──────────────────────────────────────────
// Short, unambiguous commands matched first.

const EXACT_COMMANDS: Array<[RegExp, IntentType, string?]> = [
  // Confirm / reject (short utterances only ≤ 4 words)
  [/^(yes|yeah|yep|correct|right|ok|okey|okay|ha|haan|sure|confirm|proceed|ho|avunu|sari)$/i, 'CONFIRM_YES'],
  [/^(no|nope|nahi|wrong|incorrect|ledu|illa|cancel)$/i, 'CONFIRM_NO'],
  // Reset
  [/^(start\s*over|reset|restart|clear|from\s*(?:the\s*)?beginning)$/i, 'START_OVER'],
  // Submit
  [/^(submit|done|finish|complete)$/i, 'CONFIRM_YES'],
  // Home
  [/^(home|go\s*home|main\s*menu|main\s*screen|start\s*screen)$/i, 'NAVIGATE_SCREEN', 'HOME'],
  // Registration (short phrases)
  [/^(register|registration|new\s*(?:op|patient)|op\s*registration)$/i, 'START_REGISTRATION'],
];

// ─── LAYER 2: Numeric / structural patterns ─────────────────────────────────

/** 10-digit Indian mobile number (starts with 6-9) */
const MOBILE_10_DIGIT = /[6-9]\d{9}/;

/** Spoken mobile: "my mobile number is ..." or "my number is ..." or "phone ..." */
const MOBILE_PHRASE = /(?:my\s+)?(?:mobile|phone|number|contact)\s*(?:number\s+)?(?:is\s+)?(.+)/i;

/** Age pattern: "I am 45" / "age 30" / "45 years old" */
const AGE_PATTERNS = [
  /(?:i\s+am|i'm|age\s+is|age)\s*(\d{1,3})\s*(?:years?\s*old)?/i,
  /(\d{1,3})\s*(?:years?\s*old|yrs?\s*old)/i,
];

// ─── LAYER 3: Keyword patterns (screen-INDEPENDENT) ─────────────────────────

const REGISTRATION_PATTERNS = /\b(register|registration|new\s*(?:op|patient)|new\s*registration|op\s*registration|patient\s*registration|sign\s*up|enroll|admit|new\s*op\s*registration)\b/i;
const COMPLAINT_PATTERNS = /\b(complaint|complain|grievance|report\s*(?:problem|issue))\b/i;
const QUEUE_PATTERNS = /\b(queue|waiting|my\s*turn|check\s*(?:queue|status|token)|how\s*long|wait(?:ing)?\s*time|position|when\s*(?:is\s*)?my\s*turn)\b/i;
const RECEIPT_PATTERNS = /\b(receipt|bill|invoice|payment\s*receipt|print\s*receipt)\b/i;
const LAB_PATTERNS = /\b(lab\s*(?:test|report|result)|blood\s*test|x[\s-]*ray|laboratory|test\s*report)\b/i;
const HELP_PATTERNS = /\b(help|assist|don'?t\s*know|what\s*can|how\s*(?:do|to)\s*i)\b/i;

// ─── Strict Navigation triggers ─────────────────────────────────────────────
// Navigation ONLY fires when transcript strongly matches known navigation phrases.

const STRICT_NAV_PATTERN = /\b(open|go\s*to|show(?:\s*me)?|take\s*me\s*to|switch\s*to|navigate\s*to)\s+(.+)/i;
const HOME_NAV = /\b(go\s*(?:to\s*)?home|home\s*(?:screen|page)?|main\s*(?:screen|menu)|start\s*(?:screen|page))\b/i;
const LANGUAGE_NAV = /\b(change\s*language|select\s*language|language\s*(?:screen|settings?))\b/i;
const LANGUAGE_SELECT = /\b(telugu|hindi|tamil|english|kannada|malayalam)\b/i;

// ─── LAYER 4: Medical / Department detection ────────────────────────────────

/** Department synonym map: casual word → canonical department name */
const DEPARTMENT_SYNONYMS: Record<string, string> = {
  heart: 'Cardiology', 'heart issue': 'Cardiology', 'heart problem': 'Cardiology',
  'chest pain': 'Cardiology', cardiac: 'Cardiology', cardio: 'Cardiology', cardiology: 'Cardiology',
  fever: 'General Medicine', cold: 'General Medicine', cough: 'General Medicine',
  'general medicine': 'General Medicine', general: 'General Medicine',
  bone: 'Orthopedics', bones: 'Orthopedics', fracture: 'Orthopedics',
  orthopedics: 'Orthopedics', ortho: 'Orthopedics', joint: 'Orthopedics',
  child: 'Pediatrics', children: 'Pediatrics', pediatrics: 'Pediatrics',
  paediatrics: 'Pediatrics', baby: 'Pediatrics', kid: 'Pediatrics',
  eye: 'Ophthalmology', eyes: 'Ophthalmology', vision: 'Ophthalmology', ophthalmology: 'Ophthalmology',
  skin: 'Dermatology', 'skin problem': 'Dermatology', rash: 'Dermatology', dermatology: 'Dermatology',
  ear: 'ENT', nose: 'ENT', throat: 'ENT', ent: 'ENT', 'ear nose throat': 'ENT',
  brain: 'Neurology', neurology: 'Neurology', neuro: 'Neurology', headache: 'Neurology',
  women: 'Gynecology', gynecology: 'Gynecology', pregnancy: 'Gynecology',
  pharmacy: 'Pharmacy', radiology: 'Radiology', xray: 'Radiology', 'x-ray': 'Radiology', scan: 'Radiology', mri: 'Radiology',
};

const ALL_DEPT_KEYWORDS = Object.keys(DEPARTMENT_SYNONYMS);

const FIND_ROOM_PATTERNS = /\b(find\s*(?:a\s*)?room|where\s*is|how\s*(?:to\s*)?(?:get|reach|go)\s*to|room\s*(?:of|for)|locate|take\s*me\s*to|directions?\s*(?:to|for)?|which\s*(?:room|floor|building)|go\s*to\s*(?:the\s*)?(?:room|department))\b/i;

// ─── Confirm / Reject / Submit (longer phrases) ─────────────────────────────

const CONFIRM_YES_LOOSE = /\b(yes|yeah|yep|correct|right|ok|okay|ha|haan|sure|confirm|proceed|ho|avunu|sari)\b/i;
const CONFIRM_NO_LOOSE = /\b(no|nope|nahi|wrong|incorrect|change|ledu|illa)\b/i;
const START_OVER_LOOSE = /\b(start\s*over|reset|cancel|go\s*back|restart|clear|from\s*(?:the\s*)?beginning)\b/i;
const SUBMIT_PATTERNS = /\b(submit|done|finish|complete|register\s*now|confirm\s*(?:registration|details))\b/i;

// ══════════════════════════════════════════════════════════════════════════════
//  CLASSIFIER — Layered intent detection
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Classify transcript into an intent. This is SCREEN-INDEPENDENT.
 * Uses 5-layer detection: exact → pattern → keyword → medical → fallback.
 */
export function classifyIntent(transcript: string, confidence: ConfidenceLevel = 'medium'): ClassifiedIntent {
  const normalized = normalizeVoiceInput(transcript);
  const lower = normalized.toLowerCase().trim();
  const wordCount = lower.split(/\s+/).length;

  debugLog({ type: 'PARSED_COMMAND', action: 'INTENT_CLASSIFY_START', detail: { raw: transcript, normalized, wordCount } });

  // ════ LAYER 1: Exact short-command match ════════════════════════════════
  if (wordCount <= 4) {
    for (const [regex, intentType, value] of EXACT_COMMANDS) {
      if (regex.test(lower)) {
        debugLog({ type: 'PARSED_COMMAND', action: 'LAYER1_EXACT', detail: { matched: intentType } });
        return { type: intentType, value, confidence, raw: transcript, normalized, matchLayer: 'exact' };
      }
    }
  }

  // ════ LAYER 2: Numeric / structural pattern detection ══════════════════

  // 2a: Token lookup (C-001, etc.)
  const token = extractToken(normalized);
  if (token) {
    return { type: 'LOOKUP_TOKEN', value: token, confidence, raw: transcript, normalized, matchLayer: 'pattern' };
  }

  // 2b: Mobile number — "my mobile number is 9515096361"
  const mobilePhrase = lower.match(MOBILE_PHRASE);
  if (mobilePhrase) {
    const digitsFromPhrase = mobilePhrase[1].replace(/\D/g, '');
    if (digitsFromPhrase.length >= 10) {
      const mobile = digitsFromPhrase.slice(-10);
      debugLog({ type: 'PARSED_COMMAND', action: 'LAYER2_MOBILE_PHRASE', detail: { mobile } });
      return { type: 'FILL_FIELD', value: mobile, data: { field: 'mobile' }, confidence, raw: transcript, normalized, matchLayer: 'pattern' };
    }
  }
  // Direct 10-digit detection even without "my number is ..."
  const allDigits = normalized.replace(/\D/g, '');
  if (allDigits.length >= 10) {
    const last10 = allDigits.slice(-10);
    if (MOBILE_10_DIGIT.test(last10)) {
      debugLog({ type: 'PARSED_COMMAND', action: 'LAYER2_MOBILE_DIGITS', detail: { mobile: last10 } });
      return { type: 'FILL_FIELD', value: last10, data: { field: 'mobile' }, confidence, raw: transcript, normalized, matchLayer: 'pattern' };
    }
  }

  // 2c: Age pattern (with context like "years old" or "I am 45")
  for (const pat of AGE_PATTERNS) {
    const ageMatch = lower.match(pat);
    if (ageMatch) {
      const age = ageMatch[1];
      if (parseInt(age, 10) > 0 && parseInt(age, 10) < 150) {
        debugLog({ type: 'PARSED_COMMAND', action: 'LAYER2_AGE_PATTERN', detail: { age } });
        return { type: 'FILL_FIELD', value: age, data: { field: 'age' }, confidence, raw: transcript, normalized, matchLayer: 'pattern' };
      }
    }
  }

  // ════ LAYER 3: Keyword-based intent mapping ════════════════════════════

  // 3a: Start over / cancel
  if (START_OVER_LOOSE.test(lower)) {
    return { type: 'START_OVER', confidence, raw: transcript, normalized, matchLayer: 'keyword' };
  }

  // 3b: Registration
  if (REGISTRATION_PATTERNS.test(lower)) {
    return { type: 'START_REGISTRATION', confidence, raw: transcript, normalized, matchLayer: 'keyword' };
  }

  // 3c: Complaint
  if (COMPLAINT_PATTERNS.test(lower)) {
    return { type: 'START_COMPLAINT', confidence, raw: transcript, normalized, matchLayer: 'keyword' };
  }

  // 3d: Queue status
  if (QUEUE_PATTERNS.test(lower)) {
    return { type: 'QUERY_STATUS', confidence, raw: transcript, normalized, matchLayer: 'keyword' };
  }

  // 3e: Receipt / Lab
  if (RECEIPT_PATTERNS.test(lower)) {
    return { type: 'VIEW_RECEIPT', confidence, raw: transcript, normalized, matchLayer: 'keyword' };
  }
  if (LAB_PATTERNS.test(lower)) {
    return { type: 'VIEW_LAB_TESTS', confidence, raw: transcript, normalized, matchLayer: 'keyword' };
  }

  // 3f: Strict navigation — ONLY triggers on explicit navigation phrases
  if (HOME_NAV.test(lower)) {
    return { type: 'NAVIGATE_SCREEN', value: 'HOME', confidence, raw: transcript, normalized, matchLayer: 'keyword' };
  }
  if (LANGUAGE_NAV.test(lower) || LANGUAGE_SELECT.test(lower)) {
    return { type: 'CHANGE_LANGUAGE', confidence, raw: transcript, normalized, matchLayer: 'keyword' };
  }
  const strictNav = lower.match(STRICT_NAV_PATTERN);
  if (strictNav) {
    const target = strictNav[2].trim().toLowerCase();
    const screenTarget = resolveScreenTarget(target);
    if (screenTarget) {
      return { type: 'NAVIGATE_SCREEN', value: screenTarget, confidence, raw: transcript, normalized, matchLayer: 'keyword' };
    }
  }

  // 3g: Submit / confirm
  if (SUBMIT_PATTERNS.test(lower)) {
    return { type: 'CONFIRM_YES', confidence, raw: transcript, normalized, matchLayer: 'keyword' };
  }

  // 3h: Confirm / reject (multi-word)
  if (CONFIRM_YES_LOOSE.test(lower) && wordCount <= 5) {
    return { type: 'CONFIRM_YES', confidence, raw: transcript, normalized, matchLayer: 'keyword' };
  }
  if (CONFIRM_NO_LOOSE.test(lower) && wordCount <= 5) {
    return { type: 'CONFIRM_NO', confidence, raw: transcript, normalized, matchLayer: 'keyword' };
  }

  // 3i: Help
  if (HELP_PATTERNS.test(lower)) {
    return { type: 'HELP', confidence, raw: transcript, normalized, matchLayer: 'keyword' };
  }

  // ════ LAYER 4: Medical / department detection ══════════════════════════
  const hasFindRoomPhrase = FIND_ROOM_PATTERNS.test(lower);
  const detectedDept = extractDepartmentSynonym(lower);

  if (hasFindRoomPhrase && detectedDept) {
    return {
      type: 'FIND_ROOM', value: detectedDept, data: { department: detectedDept },
      confidence, raw: transcript, normalized, matchLayer: 'medical',
    };
  }
  if (hasFindRoomPhrase) {
    return { type: 'FIND_ROOM', confidence, raw: transcript, normalized, matchLayer: 'medical' };
  }
  // Department keyword + medical context (e.g. "heart issue", "I have fever")
  if (detectedDept && hasMedicalContext(lower)) {
    return {
      type: 'FIND_ROOM', value: detectedDept, data: { department: detectedDept },
      confidence, raw: transcript, normalized, matchLayer: 'medical',
    };
  }
  // Bare department keyword without directional phrase → treat as FILL_FIELD
  // Handles cases like user saying "Skin" during registration department step
  if (detectedDept && !hasFindRoomPhrase) {
    return {
      type: 'FILL_FIELD', value: detectedDept, data: { field: 'department' },
      confidence, raw: transcript, normalized, matchLayer: 'pattern',
    };
  }

  // ════ LAYER 3 continued: Field extraction ══════════════════════════════
  const name = extractName(normalized);
  if (name) {
    return { type: 'FILL_FIELD', value: name, data: { field: 'name' }, confidence, raw: transcript, normalized, matchLayer: 'pattern' };
  }
  const gender = extractGender(normalized);
  if (gender) {
    return { type: 'FILL_FIELD', value: gender, data: { field: 'gender' }, confidence, raw: transcript, normalized, matchLayer: 'pattern' };
  }
  const mobile = extractMobile(normalized);
  if (mobile) {
    return { type: 'FILL_FIELD', value: mobile, data: { field: 'mobile' }, confidence, raw: transcript, normalized, matchLayer: 'pattern' };
  }
  const age = extractAge(normalized);
  if (age) {
    return { type: 'FILL_FIELD', value: age, data: { field: 'age' }, confidence, raw: transcript, normalized, matchLayer: 'pattern' };
  }

  // ════ LAYER 5: Fallback → UNKNOWN ══════════════════════════════════════
  debugLog({ type: 'PARSED_COMMAND', action: 'LAYER5_FALLBACK', detail: { transcript: normalized } });
  return { type: 'UNKNOWN', confidence, raw: transcript, normalized, matchLayer: 'fallback' };
}

// ══════════════════════════════════════════════════════════════════════════════
//  DISPATCHER — Convert intent → action (screen-aware for EXECUTION only)
// ══════════════════════════════════════════════════════════════════════════════

export function dispatchIntent(intent: ClassifiedIntent, currentScreen: ScreenName): IntentAction {
  debugLog({ type: 'PARSED_COMMAND', action: 'INTENT_DISPATCH', detail: { intent: intent.type, screen: currentScreen, value: intent.value, layer: intent.matchLayer } });

  switch (intent.type) {
    case 'NAVIGATE_SCREEN': {
      const screenMap: Record<string, ScreenName> = {
        HOME: ScreenName.HOME, REGISTRATION: ScreenName.REGISTRATION, QUEUE: ScreenName.QUEUE,
        NAVIGATION: ScreenName.NAVIGATION, COMPLAINT: ScreenName.COMPLAINT, LANGUAGE: ScreenName.LANGUAGE,
        RECEIPT: ScreenName.RECEIPT, LAB_TESTS: ScreenName.LAB_TESTS,
      };
      const target = screenMap[(intent.value || '').toUpperCase()];
      return { actionType: 'NAVIGATE', screen: target || ScreenName.HOME, forwardToBackend: false };
    }

    case 'START_REGISTRATION':
      return { actionType: 'NAVIGATE', screen: ScreenName.REGISTRATION, forwardToBackend: true };

    case 'START_COMPLAINT':
      return { actionType: 'NAVIGATE', screen: ScreenName.COMPLAINT, forwardToBackend: true };

    case 'QUERY_STATUS':
      return { actionType: 'NAVIGATE', screen: ScreenName.QUEUE, forwardToBackend: true };

    case 'FIND_ROOM': {
      const dept = intent.value ? (resolveDepartment(intent.value) || intent.value) : null;
      return {
        actionType: 'NAVIGATE', screen: ScreenName.NAVIGATION,
        value: dept || intent.value || undefined,
        data: dept ? { department: dept } : undefined, forwardToBackend: true,
      };
    }

    case 'VIEW_RECEIPT':
      return { actionType: 'NAVIGATE', screen: ScreenName.RECEIPT, forwardToBackend: false };
    case 'VIEW_LAB_TESTS':
      return { actionType: 'NAVIGATE', screen: ScreenName.LAB_TESTS, forwardToBackend: false };
    case 'CHANGE_LANGUAGE':
      return { actionType: 'NAVIGATE', screen: ScreenName.LANGUAGE, forwardToBackend: false };
    case 'LOOKUP_TOKEN':
      return { actionType: 'NAVIGATE', screen: ScreenName.QUEUE, value: intent.value, forwardToBackend: true };

    case 'FILL_FIELD':
      return { actionType: 'FILL_REG_FIELD', field: intent.data?.field, value: intent.value, forwardToBackend: true };

    case 'CONFIRM_YES':
      return { actionType: 'CONFIRM', forwardToBackend: true };
    case 'CONFIRM_NO':
      return { actionType: 'REJECT', forwardToBackend: true };
    case 'START_OVER':
      return { actionType: 'RESET', forwardToBackend: true };

    case 'HELP':
      return { actionType: 'LOCAL_RESPONSE', message: 'You can: Register, Check Queue, Find Room, or Complain.', forwardToBackend: false };

    case 'UNKNOWN':
    default:
      return { actionType: 'SEND_TO_BACKEND', forwardToBackend: true };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/** Resolve a natural-language screen target to a ScreenName key. */
function resolveScreenTarget(target: string): string | null {
  const map: Record<string, string> = {
    home: 'HOME', 'home screen': 'HOME', 'main menu': 'HOME',
    registration: 'REGISTRATION', register: 'REGISTRATION', 'new registration': 'REGISTRATION',
    queue: 'QUEUE', 'queue status': 'QUEUE',
    navigation: 'NAVIGATION', map: 'NAVIGATION', 'find room': 'NAVIGATION',
    complaint: 'COMPLAINT', complaints: 'COMPLAINT',
    language: 'LANGUAGE', 'language screen': 'LANGUAGE',
    receipt: 'RECEIPT', receipts: 'RECEIPT',
    'lab tests': 'LAB_TESTS', lab: 'LAB_TESTS', 'lab results': 'LAB_TESTS',
  };
  return map[target] || null;
}

/** Extract a department using the synonym map. */
function extractDepartmentSynonym(lower: string): string | null {
  // Check multi-word keys first (longer match wins)
  const sorted = ALL_DEPT_KEYWORDS.sort((a, b) => b.length - a.length);
  for (const keyword of sorted) {
    if (lower.includes(keyword)) {
      return DEPARTMENT_SYNONYMS[keyword];
    }
  }
  return null;
}

/** Check if text has medical/health context. */
function hasMedicalContext(lower: string): boolean {
  return /\b(doctor|issue|problem|pain|ache|hurts?|sick|unwell|treatment|consult|appointment|check[\s-]?up|i\s+have|suffering|department|room|ward)\b/i.test(lower);
}

// ══════════════════════════════════════════════════════════════════════════════
//  PUBLIC ENTRY POINT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Process voice input through the full intent pipeline.
 * This is the single entry point for all voice transcripts.
 */
export function processVoiceInput(
  transcript: string,
  currentScreen: ScreenName,
  confidence: ConfidenceLevel = 'medium',
): { intent: ClassifiedIntent; action: IntentAction } {
  const intent = classifyIntent(transcript, confidence);
  const action = dispatchIntent(intent, currentScreen);

  debugLog({
    type: 'PARSED_COMMAND',
    action: 'VOICE_PROCESSED',
    detail: { intent: intent.type, action: action.actionType, screen: currentScreen, value: intent.value, layer: intent.matchLayer },
  });

  return { intent, action };
}
