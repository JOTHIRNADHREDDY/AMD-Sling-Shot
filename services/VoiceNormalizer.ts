/**
 * ════════════════════════════════════════════════════════════════════════════════
 * Voice Input Normalizer
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * Normalizes STT (Speech-To-Text) output before processing:
 *  - Converts spoken numbers to digits ("zero" → 0, "one" → 1, etc.)
 *  - Fixes common STT mishearings ("oh" → 0, "tree" → "three", etc.)
 *  - Extracts tokens using regex (/[A-Z]-\d{3}/)
 *  - Normalizes whitespace
 *  - Confidence threshold checking
 */

import { debugLog } from './AppBrain';

// ── Spoken number → digit map ─────────────────────────────────────────────────

const SPOKEN_NUMBERS: Record<string, string> = {
  'zero': '0',
  'oh': '0',
  'o': '0',
  'one': '1',
  'won': '1',
  'two': '2',
  'to': '2',
  'too': '2',
  'three': '3',
  'tree': '3',
  'free': '3',
  'four': '4',
  'for': '4',
  'fore': '4',
  'five': '5',
  'six': '6',
  'seven': '7',
  'eight': '8',
  'ate': '8',
  'nine': '9',
  'nein': '9',
  'ten': '10',
};

// ── Common STT mishearings ────────────────────────────────────────────────────

const MISHEARING_CORRECTIONS: [RegExp, string][] = [
  [/\bsee\s*[-–—]?\s*/gi, 'C-'],       // "see 001" → "C-001"
  [/\bsi\s*[-–—]?\s*/gi, 'C-'],          // "si 001" → "C-001"  
  [/\bc\s+(\d)/gi, 'C-$1'],              // "C 001" → "C-001"
  [/\bdash\b/gi, '-'],                     // "C dash 001" → "C-001"
  [/\bhyphen\b/gi, '-'],
  [/\bminus\b/gi, '-'],
];

// ── Normalizer ────────────────────────────────────────────────────────────────

/**
 * Full normalization pipeline for voice input.
 */
export function normalizeVoiceInput(raw: string): string {
  let text = raw.trim();

  debugLog({ type: 'VOICE_INPUT', action: 'RAW', detail: { raw: text } });

  // Step 1: Apply mishearing corrections
  for (const [pattern, replacement] of MISHEARING_CORRECTIONS) {
    text = text.replace(pattern, replacement);
  }

  // Step 2: Convert spoken numbers to digits
  text = replaceSpokenNumbers(text);

  // Step 3: Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Step 4: Remove extra spaces around hyphens in token-like patterns
  text = text.replace(/([A-Za-z])\s*-\s*(\d)/g, '$1-$2');

  debugLog({ type: 'VOICE_INPUT', action: 'NORMALIZED', detail: { normalized: text } });

  return text;
}

/**
 * Replace spoken number words with digits.
 * Handles context: "one two three" → "123" (when in a token context)
 * but "my age is twenty five" stays as-is or becomes "25".
 */
function replaceSpokenNumbers(text: string): string {
  const words = text.split(/\s+/);
  const result: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const lower = words[i].toLowerCase().replace(/[.,!?]/g, '');
    if (SPOKEN_NUMBERS[lower] !== undefined) {
      result.push(SPOKEN_NUMBERS[lower]);
    } else {
      result.push(words[i]);
    }
  }

  return result.join(' ');
}

// ── Token Extraction ──────────────────────────────────────────────────────────

const TOKEN_REGEX = /[A-Z]-\d{3}/i;

/**
 * Extract a queue token (e.g. C-001) from voice input.
 * Returns null if no valid token found.
 */
export function extractToken(input: string): string | null {
  const normalized = normalizeVoiceInput(input);

  // Try direct regex match
  const match = normalized.match(TOKEN_REGEX);
  if (match) {
    const token = match[0].toUpperCase();
    debugLog({ type: 'PARSED_COMMAND', action: 'TOKEN_EXTRACTED', detail: { input, token } });
    return token;
  }

  // Try collapsing consecutive digits after a letter prefix
  // e.g. "C 0 0 1" → "C-001"
  const letterDigits = normalized.match(/([A-Za-z])\s*[-]?\s*(\d)\s*(\d)\s*(\d)/);
  if (letterDigits) {
    const token = `${letterDigits[1].toUpperCase()}-${letterDigits[2]}${letterDigits[3]}${letterDigits[4]}`;
    debugLog({ type: 'PARSED_COMMAND', action: 'TOKEN_EXTRACTED_COLLAPSED', detail: { input, token } });
    return token;
  }

  debugLog({ type: 'ERROR', action: 'TOKEN_NOT_FOUND', detail: { input, normalized } });
  return null;
}

// ── Confidence Threshold ──────────────────────────────────────────────────────

export const CONFIDENCE_THRESHOLD = 0.6;

export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * Determine if voice input should be auto-accepted or needs confirmation.
 */
export function shouldConfirm(confidence: ConfidenceLevel | null): boolean {
  if (!confidence) return true; // No confidence info → ask
  switch (confidence) {
    case 'high': return false;   // Accept directly
    case 'medium': return false; // Accept with visual indicator
    case 'low': return true;     // Ask confirmation
  }
}

// ── Script / Language Mismatch Detection ──────────────────────────────────────

/** Unicode script ranges for unexpected content detection. */
const SCRIPT_RANGES: Record<string, RegExp> = {
  japanese:  /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/,   // Hiragana, Katakana, CJK
  chinese:   /[\u4E00-\u9FFF\u3400-\u4DBF]/,                  // CJK Unified
  korean:    /[\uAC00-\uD7AF\u1100-\u11FF]/,                  // Hangul
  arabic:    /[\u0600-\u06FF\u0750-\u077F]/,                   // Arabic
  cyrillic:  /[\u0400-\u04FF]/,                                 // Cyrillic
  thai:      /[\u0E00-\u0E7F]/,                                 // Thai
};

/** Languages that expect Devanagari/Telugu/Tamil scripts. */
const EXPECTED_SCRIPTS: Record<string, RegExp[]> = {
  english:  [/[A-Za-z]/],
  hindi:    [/[A-Za-z]/, /[\u0900-\u097F]/],   // Latin or Devanagari
  telugu:   [/[A-Za-z]/, /[\u0C00-\u0C7F]/],   // Latin or Telugu
  tamil:    [/[A-Za-z]/, /[\u0B80-\u0BFF]/],   // Latin or Tamil
};

/**
 * Detect if the transcript contains script that is unexpected for the selected language.
 * Returns 'low' confidence if there's a script mismatch, otherwise returns the original.
 *
 * Example: language=English but transcript contains Japanese → 'low'
 */
export function detectScriptMismatch(
  transcript: string,
  language: string,
  originalConfidence: ConfidenceLevel = 'medium',
): ConfidenceLevel {
  if (!transcript || transcript.trim().length === 0) return originalConfidence;

  const langKey = language.toLowerCase().replace(/[^a-z]/g, '');

  // Check against all unexpected scripts
  for (const [scriptName, scriptRegex] of Object.entries(SCRIPT_RANGES)) {
    if (scriptRegex.test(transcript)) {
      // If the language expects this script, it's fine
      const expectedList = EXPECTED_SCRIPTS[langKey];
      if (expectedList) {
        const isExpected = expectedList.some(r => r.test(transcript));
        if (!isExpected) {
          debugLog({
            type: 'ACTION',
            action: 'SCRIPT_MISMATCH',
            detail: { language, script: scriptName, transcript: transcript.slice(0, 50) },
          });
          return 'low';
        }
      } else {
        // Unknown language — if we see CJK/Arabic/Cyrillic, treat as mismatch
        debugLog({
          type: 'ACTION',
          action: 'SCRIPT_MISMATCH',
          detail: { language, script: scriptName, transcript: transcript.slice(0, 50) },
        });
        return 'low';
      }
    }
  }

  return originalConfidence;
}

/**
 * Check if a transcript looks like garbage / non-speech noise.
 * Returns true for very short or entirely non-alpha content.
 */
export function isGarbageTranscript(transcript: string): boolean {
  const trimmed = transcript.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length <= 1) return true;
  // If mostly non-alphanumeric (symbols, punctuation)
  const alphaCount = (trimmed.match(/[a-zA-Z0-9\u0900-\u097F\u0C00-\u0C7F\u0B80-\u0BFF]/g) || []).length;
  return alphaCount / trimmed.length < 0.3;
}

// ── Name Extraction ───────────────────────────────────────────────────────────

/**
 * Extract a name from phrases like "My name is Ramesh" or "I am Kumar".
 */
export function extractName(input: string): string | null {
  const patterns = [
    /my\s+name\s+is\s+(.+)/i,
    /i\s+am\s+(.+)/i,
    /name\s+is\s+(.+)/i,
    /call\s+me\s+(.+)/i,
  ];

  for (const pat of patterns) {
    const match = input.match(pat);
    if (match) {
      const name = match[1].trim().replace(/[.,!?]+$/, '');
      debugLog({ type: 'PARSED_COMMAND', action: 'NAME_EXTRACTED', detail: { input, name } });
      return name;
    }
  }
  return null;
}

/**
 * Extract age from phrases like "I am 45 years old" or "age 30".
 */
export function extractAge(input: string): string | null {
  const patterns = [
    /(?:i\s+am|i'm|age\s+is|age)\s*(\d{1,3})\s*(?:years?\s*old)?/i,
    /(\d{1,3})\s*(?:years?\s*old|yrs?\s*old)/i,
    /^(\d{1,3})$/,
  ];

  for (const pat of patterns) {
    const match = input.match(pat);
    if (match) {
      const age = match[1];
      if (parseInt(age, 10) > 0 && parseInt(age, 10) < 150) {
        debugLog({ type: 'PARSED_COMMAND', action: 'AGE_EXTRACTED', detail: { input, age } });
        return age;
      }
    }
  }
  return null;
}

/**
 * Extract gender from voice input.
 */
export function extractGender(input: string): 'Male' | 'Female' | 'Other' | null {
  const lower = input.toLowerCase();
  if (/\b(male|man|boy|gent|gentleman|sir)\b/.test(lower)) return 'Male';
  if (/\b(female|woman|girl|lady|madam|ma'?am)\b/.test(lower)) return 'Female';
  if (/\b(other|non.?binary|prefer not)\b/.test(lower)) return 'Other';
  return null;
}

/**
 * Extract mobile number from voice input.
 */
export function extractMobile(input: string): string | null {
  const normalized = normalizeVoiceInput(input);
  // Remove all non-digit characters and check for 10-digit Indian mobile
  const digits = normalized.replace(/\D/g, '');
  if (digits.length >= 10) {
    const mobile = digits.slice(-10); // Take last 10 digits
    debugLog({ type: 'PARSED_COMMAND', action: 'MOBILE_EXTRACTED', detail: { input, mobile } });
    return mobile;
  }
  return null;
}

// ── Voice Command Parser ──────────────────────────────────────────────────────

export type VoiceCommandType =
  | 'REGISTER_NEW'
  | 'FILL_NAME'
  | 'FILL_AGE'
  | 'FILL_GENDER'
  | 'FILL_MOBILE'
  | 'FILL_DEPARTMENT'
  | 'SUBMIT'
  | 'GO_HOME'
  | 'CHECK_QUEUE'
  | 'FIND_ROOM'
  | 'START_OVER'
  | 'CONFIRM_YES'
  | 'CONFIRM_NO'
  | 'UNKNOWN';

export interface ParsedVoiceCommand {
  type: VoiceCommandType;
  value?: string;
  confidence: ConfidenceLevel;
  raw: string;
}

/**
 * Parse normalized voice input into a structured command.
 */
export function parseVoiceCommand(raw: string, confidence: ConfidenceLevel = 'medium'): ParsedVoiceCommand {
  const input = normalizeVoiceInput(raw);
  const lower = input.toLowerCase();

  debugLog({ type: 'PARSED_COMMAND', action: 'PARSING', detail: { raw, normalized: input } });

  // Registration trigger
  if (/\b(register|registration|new\s*(?:op|patient)|new\s*registration)\b/i.test(lower)) {
    return { type: 'REGISTER_NEW', confidence, raw };
  }

  // Submit / confirm
  if (/\b(submit|confirm|done|finish|complete|register\s*(?:now|this))\b/i.test(lower)) {
    return { type: 'SUBMIT', confidence, raw };
  }

  // Start over
  if (/\b(start\s*over|reset|cancel|go\s*back|restart)\b/i.test(lower)) {
    return { type: 'START_OVER', confidence, raw };
  }

  // Confirmation
  if (/\b(yes|yeah|yep|correct|right|ok|okay|ha|haan|sure|confirm)\b/i.test(lower)) {
    return { type: 'CONFIRM_YES', confidence, raw };
  }
  if (/\b(no|nope|nahi|wrong|incorrect|change)\b/i.test(lower)) {
    return { type: 'CONFIRM_NO', confidence, raw };
  }

  // Navigate
  if (/\b(home|main\s*(?:screen|menu)|go\s*(?:home|back\s*to\s*home))\b/i.test(lower)) {
    return { type: 'GO_HOME', confidence, raw };
  }
  if (/\b(queue|token|waiting|my\s*turn|check\s*(?:queue|status))\b/i.test(lower)) {
    return { type: 'CHECK_QUEUE', confidence, raw };
  }
  if (/\b(find\s*room|navigate|directions?|where\s*is|find)\b/i.test(lower)) {
    return { type: 'FIND_ROOM', value: input, confidence, raw };
  }

  // Name extraction
  const name = extractName(input);
  if (name) {
    return { type: 'FILL_NAME', value: name, confidence, raw };
  }

  // Age extraction
  const age = extractAge(input);
  if (age) {
    return { type: 'FILL_AGE', value: age, confidence, raw };
  }

  // Gender extraction
  const gender = extractGender(input);
  if (gender) {
    return { type: 'FILL_GENDER', value: gender, confidence, raw };
  }

  // Mobile extraction
  const mobile = extractMobile(input);
  if (mobile) {
    return { type: 'FILL_MOBILE', value: mobile, confidence, raw };
  }

  return { type: 'UNKNOWN', confidence, raw };
}
