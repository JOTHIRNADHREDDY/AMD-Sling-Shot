export enum ScreenName {
  HOME = 'HOME',
  REGISTRATION = 'REGISTRATION',
  LAB_TESTS = 'LAB_TESTS',
  QUEUE = 'QUEUE',
  NAVIGATION = 'NAVIGATION',
  COMPLAINT = 'COMPLAINT',
  LANGUAGE = 'LANGUAGE',
  RECEIPT = 'RECEIPT'
}

export enum VoiceState {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  PROCESSING = 'PROCESSING',
  SPEAKING = 'SPEAKING',
  ERROR = 'ERROR'
}

export enum Language {
  TELUGU = 'Telugu',
  HINDI = 'Hindi',
  ENGLISH = 'English',
  TAMIL = 'Tamil',
  TELUGU_EN = 'Telugu_EN',
  HINDI_EN = 'Hindi_EN'
}

export interface PatientDetails {
  name: string;
  age: string;
  gender: 'Male' | 'Female' | 'Other';
  phone: string;
  department: string;
}

export interface LabTest {
  id: string;
  name: string;
  price: number;
  status: 'Pending' | 'Completed' | 'Report Ready';
}

export interface QueueToken {
  number: string;
  position: number;
  waitTimeMinutes: number;
}

export interface ChatMessage {
  sender: 'user' | 'bot';
  text: string;
}

// ── API-sourced types (mirrors backend schemas) ──────────────────────────────

export interface QueueStatus {
  department: string;
  current_serving: number;
  total_waiting: number;
  estimated_wait_time_mins: number;
}

export interface RouteStep {
  instruction: string;
  distance_meters: number;
  direction: string;
}

export interface MapDirections {
  from_node: string;
  to_node: string;
  total_distance_meters: number;
  estimated_time_mins: number;
  steps: RouteStep[];
}

// ── Registration result from backend ─────────────────────────────────────────

export interface RegistrationResult {
  registration_id: string;
  token_number: string;
  department: string;
  position: number;
  estimated_wait_time_mins: number;
  patient_name: string;
  patient_age: string;
  patient_gender: string;
  patient_phone: string;
  language: string;
  created_at: string;
}

export interface PatientLookup {
  registration_id: string;
  token_number: string;
  department: string;
  position: number;
  queue_status: string;
  estimated_wait_time_mins: number;
  patient_name: string;
  patient_age: string;
  patient_gender: string;
  patient_phone: string;
  language: string;
  created_at: string;
}

// ── Central Interaction Controller Types (Section 7 & 8 — Command Execution Engine) ──

export type InteractionActionType =
  | 'NAVIGATE'
  | 'BATCH_FORM_FILL'
  | 'CLICK_BUTTON'
  | 'SCROLL_TO'
  | 'SUBMIT_FORM'
  | 'TRIGGER_BUTTON'
  | 'START_WORKFLOW'
  | 'ADVANCE_WORKFLOW'
  | 'NAVIGATE_TO_DEPARTMENT'
  | 'FILL_FIELD'
  | 'START_REGISTRATION';

/**
 * Command Envelope — UI-safe command that wraps every dispatched interaction.
 * Raw LLM output NEVER reaches the UI; only validated Command Envelopes do.
 */
export interface InteractionAction {
  type: InteractionActionType;
  payload?: Record<string, unknown>;
  /** If true the user must confirm before execution (confirmation gating). */
  requires_confirmation?: boolean;
}

// ── Screen Capability Matrix (Section 11) ───────────────────────────────────

/** Maps each screen to the set of InteractionActionTypes it can handle. */
export const SCREEN_CAPABILITIES: Record<ScreenName, readonly InteractionActionType[]> = {
  [ScreenName.HOME]:         ['NAVIGATE', 'START_REGISTRATION'],
  [ScreenName.REGISTRATION]: ['NAVIGATE', 'BATCH_FORM_FILL', 'SUBMIT_FORM', 'SCROLL_TO', 'FILL_FIELD', 'CLICK_BUTTON', 'START_REGISTRATION'],
  [ScreenName.LAB_TESTS]:    ['NAVIGATE', 'SCROLL_TO', 'TRIGGER_BUTTON'],
  [ScreenName.QUEUE]:        ['NAVIGATE', 'SCROLL_TO'],
  [ScreenName.NAVIGATION]:   ['NAVIGATE', 'SCROLL_TO', 'NAVIGATE_TO_DEPARTMENT'],
  [ScreenName.COMPLAINT]:    ['NAVIGATE', 'BATCH_FORM_FILL', 'SUBMIT_FORM', 'START_WORKFLOW', 'ADVANCE_WORKFLOW'],
  [ScreenName.LANGUAGE]:     ['NAVIGATE', 'TRIGGER_BUTTON'],
  [ScreenName.RECEIPT]:      ['NAVIGATE', 'TRIGGER_BUTTON', 'SCROLL_TO'],
};

// ── Field-Level Edit Control (Section 11) ───────────────────────────────────

/** Whitelist of fields that can be batch-filled per screen / form target. */
export const FIELD_WHITELIST: Record<string, readonly string[]> = {
  RegistrationForm: ['name', 'age', 'gender', 'phone', 'department'],
  ComplaintForm: ['complaint_text', 'department'],
};

// ── Workflow State Machine (Section 9) ──────────────────────────────────────

export enum WorkflowState {
  IDLE = 'IDLE',
  COLLECTING_DETAILS = 'COLLECTING_DETAILS',
  CONFIRMATION = 'CONFIRMATION',
  SUBMITTED = 'SUBMITTED',
  COMPLETE = 'COMPLETE',
}

/** Legal state transitions per workflow state. */
export const WORKFLOW_TRANSITIONS: Record<WorkflowState, readonly WorkflowState[]> = {
  [WorkflowState.IDLE]:               [WorkflowState.COLLECTING_DETAILS],
  [WorkflowState.COLLECTING_DETAILS]: [WorkflowState.CONFIRMATION, WorkflowState.IDLE],
  [WorkflowState.CONFIRMATION]:       [WorkflowState.SUBMITTED, WorkflowState.COLLECTING_DETAILS, WorkflowState.IDLE],
  [WorkflowState.SUBMITTED]:          [WorkflowState.COMPLETE, WorkflowState.IDLE],
  [WorkflowState.COMPLETE]:           [WorkflowState.IDLE],
};