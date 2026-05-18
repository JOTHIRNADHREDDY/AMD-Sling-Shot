import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import {
  ScreenName,
  Language,
  VoiceState,
  WorkflowState,
  SCREEN_CAPABILITIES,
  FIELD_WHITELIST,
  WORKFLOW_TRANSITIONS,
  type PatientDetails,
  type ChatMessage,
  type QueueStatus,
  type MapDirections,
  type RegistrationResult,
  type PatientLookup,
} from '../types';
import { voiceManager, type OrchestratorMessage } from '../services/VoiceManager';
import { fetchQueueStatus, fetchDirections, lookupPatient } from '../services/api';
import {
  type ReceiptUploadResult,
  type DocumentUploadResult,
  type UploadProgress,
} from '../services/firebaseStorage';
import {
  initCloudSync,
  saveRegistration,
  saveReceiptDataUrl,
  saveReceiptBlob,
  saveDocument,
  saveLabReport,
  getTotalPendingCount,
  type SaveLocation,
} from '../services/cloudSyncService';
import {
  debugLog,
  isDebouncedAction,
  highlightElement,
  animateAutoClick,
  voiceAutoClick,
  scrollToElement,
  resolveDepartment,
} from '../services/AppBrain';
import {
  type RegistrationFlowState as RegFlowState,
  type RegistrationFlowData,
  createInitialFlowState,
  fillField as flowFillField,
  batchFill as flowBatchFill,
  startFlow,
  goToStep,
  resetFlow,
  isFieldFilled,
  getStepPrompt,
  type RegistrationStep,
} from '../services/RegistrationFlow';
import {
  normalizeVoiceInput,
  extractToken,
  extractName,
  extractAge,
  extractGender,
  extractMobile,
  shouldConfirm,
  parseVoiceCommand,
  type ConfidenceLevel,
} from '../services/VoiceNormalizer';
import {
  processVoiceCommand,
  handleClarification,
} from '../services/VoiceCommandEngine';
import { clarificationGuard } from '../services/ClarificationGuard';
import { sessionContext, flowLock } from '../services/SessionContext';

// ── Context shape ─────────────────────────────────────────────────────────────

interface KioskContextType {
  currentScreen: ScreenName;
  language: Language;
  voiceState: VoiceState;
  transcript: string;
  chatHistory: ChatMessage[];
  patientDetails: PatientDetails;
  isDarkMode: boolean;
  error: string | null;
  isHelpOpen: boolean;
  hasSelectedLanguage: boolean;
  confidenceScore: 'high' | 'medium' | 'low' | null;
  suggestions: string[];
  // API-sourced state
  queueData: QueueStatus[];
  queueLoading: boolean;
  directions: MapDirections | null;
  directionsLoading: boolean;
  // Registration
  registrationResult: RegistrationResult | null;
  registrationLoading: boolean;
  lookupResult: PatientLookup | null;
  lookupLoading: boolean;
  // Smart Action Confirmation
  pendingAction: any | null;
  confirmAction: () => void;
  cancelAction: () => void;
  // Cloud Storage
  receiptUrl: string | null;
  uploadingReceipt: boolean;
  uploadProgress: number;          // 0 → 1
  // Offline sync status
  pendingCount: number;
  lastSaveLocation: SaveLocation | null;
  // V2 LLM orchestrator state
  isFallbackMode: boolean;
  lastOrchestratorAction: string | null;
  // Workflow State Machine (Section 9)
  workflowState: WorkflowState;
  // Registration Flow State Machine
  regFlow: RegFlowState;
  updateRegFlow: (field: keyof RegistrationFlowData, value: string) => void;
  startRegFlow: () => void;
  resetRegFlow: () => void;
  setRegStep: (step: RegistrationStep) => void;
  // Token confirmation
  pendingTokenConfirm: string | null;
  confirmToken: () => void;
  rejectToken: () => void;
  // Actions
  updatePatientDetails: (details: Partial<PatientDetails>) => void;
  navigate: (screen: ScreenName) => void;
  setLanguage: (lang: Language) => void;
  toggleVoice: () => void;
  sendVoiceText: (text: string) => void;
  resetKiosk: () => void;
  toggleDarkMode: () => void;
  toggleHelp: () => void;
  dismissError: () => void;
  refreshQueue: () => Promise<void>;
  loadDirections: (from: string, to: string) => Promise<void>;
  submitRegistration: () => Promise<void>;
  scanToken: (token: string) => Promise<void>;
  uploadReceiptImage: (dataUrl: string) => Promise<ReceiptUploadResult | null>;
  uploadFile: (file: File) => Promise<DocumentUploadResult | null>;
  uploadLabFile: (file: File, patientId: string) => Promise<DocumentUploadResult | null>;
  // Central Interaction Controller
  isLocked: boolean;
  dispatchInteract: (action: import('../types').InteractionAction) => void;
}

const KioskContext = createContext<KioskContextType | undefined>(undefined);

// ── Default values ────────────────────────────────────────────────────────────

const INITIAL_PATIENT: PatientDetails = {
  name: '',
  age: '',
  gender: 'Male',
  phone: '',
  department: '',
};

const INITIAL_CHAT: ChatMessage[] = [
  { sender: 'bot', text: 'Namaste! Please say your name and age to register.' },
];

const FALLBACK_QUEUE: QueueStatus[] = [
  { department: 'Cardiology', current_serving: 12, total_waiting: 5, estimated_wait_time_mins: 25 },
  { department: 'Pharmacy', current_serving: 45, total_waiting: 12, estimated_wait_time_mins: 10 },
];

const QUEUE_POLL_MS = 30_000;

// ── Provider ──────────────────────────────────────────────────────────────────

export const KioskProvider = ({ children }: { children?: ReactNode }) => {
  const [currentScreen, setCurrentScreen] = useState<ScreenName>(ScreenName.HOME);
  const [language, setLanguageRaw] = useState<Language>(Language.TELUGU);
  const [voiceState, setVoiceState] = useState<VoiceState>(VoiceState.IDLE);
  const [transcript, setTranscript] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [hasSelectedLanguage, setHasSelectedLanguage] = useState(false);
  const [confidenceScore, setConfidenceScore] = useState<'high' | 'medium' | 'low' | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>(INITIAL_CHAT);
  const [patientDetails, setPatientDetails] = useState<PatientDetails>(INITIAL_PATIENT);

  // API-backed state
  const [queueData, setQueueData] = useState<QueueStatus[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [directions, setDirections] = useState<MapDirections | null>(null);
  const [directionsLoading, setDirectionsLoading] = useState(false);
  const [registrationResult, setRegistrationResult] = useState<RegistrationResult | null>(null);
  const [registrationLoading, setRegistrationLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<PatientLookup | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<any | null>(null);

  // Cloud Storage state
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Offline sync state
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSaveLocation, setLastSaveLocation] = useState<SaveLocation | null>(null);

  // V2 LLM orchestrator state
  const [isFallbackMode, setIsFallbackMode] = useState(false);
  const [lastOrchestratorAction, setLastOrchestratorAction] = useState<string | null>(null);

  // Workflow State Machine (Section 9)
  const [workflowState, setWorkflowState] = useState<WorkflowState>(WorkflowState.IDLE);

  // Central Interaction Controller Logic
  const [isLocked, setIsLocked] = useState(false);
  const isLockedRef = React.useRef(false); // Ref for immediate checking to avoid closure staleness

  // Refs for values needed inside stable-subscription closures (avoids stale captures)
  const currentScreenRef = useRef<ScreenName>(ScreenName.HOME);
  const dispatchInteractRef = useRef<(action: import('../types').InteractionAction) => void>(() => {});

  // Registration Flow State Machine
  const [regFlow, setRegFlow] = useState<RegFlowState>(createInitialFlowState());

  // Token confirmation (voice said C-001, confirm before processing)
  const [pendingTokenConfirm, setPendingTokenConfirm] = useState<string | null>(null);


  // ── Stable callbacks ────────────────────────────────────────────────────────

  const dismissError = useCallback(() => setError(null), []);

  const updatePatientDetails = useCallback(
    (details: Partial<PatientDetails>) =>
      setPatientDetails((prev) => ({ ...prev, ...details })),
    [],
  );

  const navigate = useCallback(
    (screen: ScreenName) => {
      // FlowLock guard — block navigation if a flow is active (unless going to same screen or flow's own screen)
      if (flowLock.isLocked() && screen !== currentScreenRef.current) {
        // Allow navigation to the flow's designated screen (e.g. REGISTRATION when flow='registration')
        const flowScreenKey = flowLock.getFlowScreen();
        const flowScreenMap: Record<string, ScreenName> = {
          REGISTRATION: ScreenName.REGISTRATION,
          COMPLAINT: ScreenName.COMPLAINT,
        };
        const allowedScreen = flowScreenKey ? flowScreenMap[flowScreenKey] : null;
        if (screen !== allowedScreen) {
          debugLog({ type: 'BLOCKED', action: 'FLOW_LOCK_NAV_BLOCKED_CTX', detail: { targetScreen: screen, activeFlow: flowLock.getActiveFlow(), currentStep: flowLock.getCurrentStep() } });
          return; // Silently block — the engine already sent a user message
        }
      }

      setCurrentScreen(screen);
      currentScreenRef.current = screen;
      setError(null);
      // V2: Sync screen context to VoiceManager for LLM (Section 4)
      voiceManager.setCurrentScreen(screen);
      // Reset clarification guard on screen change
      clarificationGuard.reset();
      debugLog({ type: 'NAVIGATION', action: 'NAVIGATE', detail: { screen } });
      // NOTE: Do NOT stop voice on navigation — voice should persist across all screens
    },
    [],
  );

  const setLanguage = useCallback((lang: Language) => {
    setLanguageRaw(lang);
    setHasSelectedLanguage(true);
    // V2: Sync language to VoiceManager for LLM context
    voiceManager.setLanguage(lang);
  }, []);

  const toggleVoice = useCallback(() => {
    if (voiceState === VoiceState.IDLE || voiceState === VoiceState.ERROR) {
      voiceManager.startListening();
    } else if (voiceState === VoiceState.LISTENING) {
      voiceManager.finishListening();
    } else {
      voiceManager.stopListening();
    }
  }, [voiceState]);

  /**
   * V2: Send a text command directly to the LLM orchestrator (skip STT).
   * Used for typed input or pre-transcribed text.
   */
  const sendVoiceText = useCallback((text: string) => {
    voiceManager.sendTextCommand(text);
  }, []);

  const toggleDarkMode = useCallback(() => setIsDarkMode((p) => !p), []);
  const toggleHelp = useCallback(() => setIsHelpOpen((p) => !p), []);

  const resetKiosk = useCallback(() => {
    setCurrentScreen(ScreenName.HOME);
    setPatientDetails(INITIAL_PATIENT);
    setTranscript('');
    setError(null);
    setIsHelpOpen(false);
    setChatHistory(INITIAL_CHAT);
    setRegistrationResult(null);
    setLookupResult(null);
    setReceiptUrl(null);
    setUploadProgress(0);
    setRegFlow(createInitialFlowState());
    setPendingTokenConfirm(null);
    voiceManager.stopListening();
    clarificationGuard.reset();
    sessionContext.clear();
    flowLock.release();
    debugLog({ type: 'ACTION', action: 'RESET_KIOSK' });
  }, []);

  // ── Registration Flow State Machine callbacks ───────────────────────────────
  const updateRegFlow = useCallback((field: keyof RegistrationFlowData, value: string) => {
    setRegFlow(prev => {
      const next = flowFillField(prev, field, value);
      // Sync filled data to patientDetails for backwards compat
      setPatientDetails(pd => ({ ...pd, [field]: value }));
      // Highlight the field in the UI
      highlightElement(`field-${field}`);
      debugLog({ type: 'FIELD_FILL', action: field, detail: { value, newStep: next.step } });
      return next;
    });
  }, []);

  const startRegFlow = useCallback(() => {
    setRegFlow(prev => {
      if (prev.step !== 'IDLE') {
        // Already in flow — don't restart, just navigate to reg screen
        debugLog({ type: 'BLOCKED', action: 'START_REG_FLOW', detail: { reason: 'Already in flow', step: prev.step } });
        return prev;
      }
      return startFlow(prev);
    });
    // Activate FlowLock to prevent navigation during registration
    flowLock.activate('registration', 'MOBILE');
    navigate(ScreenName.REGISTRATION);
  }, [navigate]);

  // Keep startRegFlowRef in sync
  useEffect(() => { startRegFlowRef.current = startRegFlow; }, [startRegFlow]);

  // ── Sync regFlow.step to VoiceManager so backend knows the current registration field ──
  useEffect(() => {
    voiceManager.setRegistrationStep(regFlow.step);
    // Also sync to FlowLock
    if (regFlow.step !== 'IDLE' && regFlow.step !== 'SUBMITTED') {
      flowLock.setStep(regFlow.step);
    }
    if (regFlow.step === 'SUBMITTED') {
      // Registration complete — release the lock
      flowLock.release();
    }
    debugLog({ type: 'ACTION', action: 'REG_STEP_SYNC', detail: { step: regFlow.step, filledFields: Array.from(regFlow.filledFields), flowLocked: flowLock.isLocked() } });
  }, [regFlow.step]);

  const resetRegFlow = useCallback(() => {
    setRegFlow(resetFlow());
    setPatientDetails(INITIAL_PATIENT);
    flowLock.release();
    debugLog({ type: 'ACTION', action: 'RESET_REG_FLOW' });
  }, []);

  const setRegStep = useCallback((step: RegistrationStep) => {
    setRegFlow(prev => goToStep(prev, step));
  }, []);

  // ── Token Confirmation — uses scanToken, will be defined below ──────────────
  const scanTokenRef = useRef<(token: string) => Promise<void>>();
  const startRegFlowRef = useRef<() => void>();

  const confirmToken = useCallback(() => {
    if (pendingTokenConfirm) {
      debugLog({ type: 'CONFIRMED', action: 'TOKEN_CONFIRMED', detail: { token: pendingTokenConfirm } });
      scanTokenRef.current?.(pendingTokenConfirm);
      setPendingTokenConfirm(null);
    }
  }, [pendingTokenConfirm]);

  const rejectToken = useCallback(() => {
    debugLog({ type: 'ACTION', action: 'TOKEN_REJECTED', detail: { token: pendingTokenConfirm } });
    setPendingTokenConfirm(null);
  }, [pendingTokenConfirm]);

  // ── Central Interaction Controller Dispatch (Section 8) ───────────────────
  const dispatchInteract = useCallback((action: import('../types').InteractionAction) => {
    if (isLockedRef.current) {
      debugLog({ type: 'BLOCKED', action: 'LOCKED', detail: { attempted: action.type } });
      return;
    }

    // ── Debounce check ────────────────────────────────────────────────
    const targetKey = action.payload?.route as string || action.payload?.target as string || '';
    if (isDebouncedAction(action.type, targetKey)) {
      return;
    }

    // ── Screen capability validation (Section 11) ──────────────────────
    const allowed = SCREEN_CAPABILITIES[currentScreen];
    if (allowed && !allowed.includes(action.type)) {
      debugLog({ type: 'BLOCKED', action: 'CAPABILITY', detail: { action: action.type, screen: currentScreen } });
      console.warn(`[App Brain] Action ${action.type} not allowed on screen ${currentScreen}`);
      return;
    }

    // ── Confirmation gating (Section 11) ──────────────────────────────
    if (action.requires_confirmation) {
      setPendingAction({
        type: action.type,
        data: action.payload,
        message: 'Please confirm this action.',
      });
      debugLog({ type: 'ACTION', action: 'CONFIRMATION_GATED', detail: action });
      return;
    }

    // Lock the UI briefly (400ms interaction lock — Section 8)
    setIsLocked(true);
    isLockedRef.current = true;

    setTimeout(() => {
      setIsLocked(false);
      isLockedRef.current = false;
    }, 400);

    debugLog({ type: 'ACTION', action: action.type, detail: action.payload });

    switch (action.type) {
      case 'NAVIGATE':
        if (action.payload?.route) {
          navigate(action.payload.route as ScreenName);
        }
        break;

      case 'BATCH_FORM_FILL': {
        // Field whitelist validation (Section 11)
        const target = (action.payload?.target as string) || '';
        const fields = (action.payload?.fields as Record<string, unknown>) || {};
        const whitelist = FIELD_WHITELIST[target];
        if (whitelist) {
          const safeFields: Record<string, unknown> = {};
          for (const key of Object.keys(fields)) {
            if (whitelist.includes(key)) {
              safeFields[key] = fields[key];

              // Highlight the field being auto-filled
              highlightElement(`field-${key}`);

              // Also update Registration Flow State Machine
              if (target === 'RegistrationForm') {
                setRegFlow(prev => flowFillField(prev, key as keyof RegistrationFlowData, String(fields[key])));
              }
            } else {
              console.warn(`[App Brain] Field '${key}' not in whitelist for ${target}`);
            }
          }
          // Apply to patient details if targeting RegistrationForm
          if (target === 'RegistrationForm') {
            updatePatientDetails(safeFields as Partial<PatientDetails>);
          }
          // Broadcast for other components
          window.dispatchEvent(new CustomEvent('app-interaction', {
            detail: { ...action, payload: { ...action.payload, fields: safeFields } },
          }));
        } else {
          window.dispatchEvent(new CustomEvent('app-interaction', { detail: action }));
        }
        break;
      }

      case 'START_WORKFLOW': {
        // Workflow state machine (Section 9)
        const targetState = WorkflowState.COLLECTING_DETAILS;
        if (WORKFLOW_TRANSITIONS[workflowState]?.includes(targetState)) {
          setWorkflowState(targetState);
          voiceManager.setWorkflowState(targetState);
        } else {
          console.warn(`[App Brain] Illegal workflow transition: ${workflowState} → ${targetState}`);
        }
        break;
      }

      case 'ADVANCE_WORKFLOW': {
        const nextState = action.payload?.target_state as WorkflowState;
        if (nextState && WORKFLOW_TRANSITIONS[workflowState]?.includes(nextState)) {
          setWorkflowState(nextState);
          voiceManager.setWorkflowState(nextState);
        } else {
          console.warn(`[App Brain] Illegal workflow transition: ${workflowState} → ${nextState}`);
        }
        break;
      }

      case 'SCROLL_TO': {
        const elementId = action.payload?.elementId as string;
        if (elementId) scrollToElement(elementId);
        break;
      }

      case 'TRIGGER_BUTTON':
      case 'CLICK_BUTTON': {
        const btnId = (action.payload?.id as string) || (action.payload?.button_id as string);
        if (btnId) {
          animateAutoClick(btnId);
          const el = document.getElementById(btnId);
          if (el) {
            debugLog({ type: 'ACTION', action: 'AUTO_CLICK', detail: { btnId } });
            el.click();
          } else {
            debugLog({ type: 'ERROR', action: 'CLICK_BUTTON', detail: { btnId, error: 'Element not found' } });
          }
        }
        window.dispatchEvent(new CustomEvent('app-interaction', { detail: action }));
        break;
      }

      case 'SUBMIT_FORM':
        window.dispatchEvent(new CustomEvent('app-interaction', { detail: action }));
        break;

      default:
        debugLog({ type: 'ERROR', action: 'UNKNOWN_ACTION', detail: action });
        console.warn('[App Brain] Unknown interaction action dispatched:', action.type);
        break;
    }
  }, [navigate, currentScreen, workflowState, updatePatientDetails]);

  // Keep refs in sync for use inside stable-subscription closures
  useEffect(() => { currentScreenRef.current = currentScreen; }, [currentScreen]);
  useEffect(() => { dispatchInteractRef.current = dispatchInteract; }, [dispatchInteract]);

  // ── API helpers ─────────────────────────────────────────────────────────────

  const refreshQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      const data = await fetchQueueStatus();
      setQueueData(data);
    } catch (err) {
      console.warn('Queue fetch failed, using fallback:', err);
      setQueueData(FALLBACK_QUEUE);
    } finally {
      setQueueLoading(false);
    }
  }, []);

  const loadDirections = useCallback(async (from: string, to: string) => {
    setDirectionsLoading(true);
    try {
      const data = await fetchDirections(from, to);
      setDirections(data);
    } catch (err) {
      console.warn('Directions fetch failed:', err);
      setDirections(null);
    } finally {
      setDirectionsLoading(false);
    }
  }, []);

  /** Refresh the pending-items badge count. */
  const refreshPendingCount = useCallback(async () => {
    try {
      const count = await getTotalPendingCount();
      setPendingCount(count);
    } catch { /* ignore */ }
  }, []);

  const submitRegistration = useCallback(async () => {
    setRegistrationLoading(true);
    try {
      const saveResult = await saveRegistration({
        name: patientDetails.name,
        age: patientDetails.age,
        gender: patientDetails.gender,
        phone: patientDetails.phone,
        department: patientDetails.department,
        language: language,
      });
      setLastSaveLocation(saveResult.location);
      if (saveResult.data) {
        setRegistrationResult(saveResult.data);
        refreshQueue();
        setCurrentScreen(ScreenName.RECEIPT);
      } else {
        setError('Registration failed. Please try again.');
      }
      refreshPendingCount();
    } catch (err) {
      console.error('Registration failed:', err);
      setError('Registration failed. Please try again.');
    } finally {
      setRegistrationLoading(false);
    }
  }, [patientDetails, language, refreshQueue, refreshPendingCount]);

  const scanToken = useCallback(async (token: string) => {
    setLookupLoading(true);
    setError(null);
    try {
      const data = await lookupPatient(token);
      setLookupResult(data);
    } catch (err) {
      console.error('Token lookup failed:', err);
      setError('Token not found. Please check the number and try again.');
      setLookupResult(null);
    } finally {
      setLookupLoading(false);
    }
  }, []);

  // Keep scanTokenRef in sync for confirmToken
  useEffect(() => { scanTokenRef.current = scanToken; }, [scanToken]);

  // ── Cloud Storage callbacks ─────────────────────────────────────────────────

  const uploadReceiptImage = useCallback(
    async (dataUrl: string): Promise<ReceiptUploadResult | null> => {
      if (!registrationResult) return null;
      setUploadingReceipt(true);
      setUploadProgress(0);
      try {
        const result = await saveReceiptDataUrl(registrationResult.registration_id, dataUrl);
        setLastSaveLocation(result.location);
        if (result.data) {
          setReceiptUrl(result.data.downloadUrl);
          setUploadProgress(1);
          return result.data;
        }
        // Saved offline — no download URL yet
        setUploadProgress(1);
        refreshPendingCount();
        return null;
      } catch (err) {
        console.error('Receipt upload failed:', err);
        setError('Failed to save receipt to cloud. You can still use the local copy.');
        return null;
      } finally {
        setUploadingReceipt(false);
      }
    },
    [registrationResult, refreshPendingCount],
  );

  const uploadReceiptFile = useCallback(
    async (blob: Blob): Promise<ReceiptUploadResult | null> => {
      if (!registrationResult) return null;
      setUploadingReceipt(true);
      setUploadProgress(0);
      try {
        const result = await saveReceiptBlob(
          registrationResult.registration_id,
          blob,
          { compress: true, onProgress: (p) => setUploadProgress(p.progress) },
        );
        setLastSaveLocation(result.location);
        if (result.data) {
          setReceiptUrl(result.data.downloadUrl);
          setUploadProgress(1);
          return result.data;
        }
        setUploadProgress(1);
        refreshPendingCount();
        return null;
      } catch (err) {
        console.error('Receipt upload failed:', err);
        setError('Failed to save receipt to cloud. You can still use the local copy.');
        return null;
      } finally {
        setUploadingReceipt(false);
      }
    },
    [registrationResult, refreshPendingCount],
  );

  const uploadFile = useCallback(
    async (file: File): Promise<DocumentUploadResult | null> => {
      try {
        const result = await saveDocument(file, { compress: true });
        setLastSaveLocation(result.location);
        refreshPendingCount();
        return result.data ?? null;
      } catch (err) {
        console.error('Document upload failed:', err);
        setError('Failed to upload document.');
        return null;
      }
    },
    [refreshPendingCount],
  );

  const uploadLabFile = useCallback(
    async (file: File, patientId: string): Promise<DocumentUploadResult | null> => {
      try {
        const result = await saveLabReport(file, patientId, { compress: true });
        setLastSaveLocation(result.location);
        refreshPendingCount();
        return result.data ?? null;
      } catch (err) {
        console.error('Lab report upload failed:', err);
        setError('Failed to upload lab report.');
        return null;
      }
    },
    [refreshPendingCount],
  );

  // ── Side-effects ────────────────────────────────────────────────────────────

  // Queue polling
  useEffect(() => {
    refreshQueue();
    const id = setInterval(refreshQueue, QUEUE_POLL_MS);
    return () => clearInterval(id);
  }, [refreshQueue]);

  // Dark mode class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  // Unified cloud sync — auto-sync ALL pending offline data on startup / reconnect
  useEffect(() => {
    const cleanup = initCloudSync();
    // Refresh badge after initial sync
    const timer = setTimeout(() => refreshPendingCount(), 3000);
    return () => { cleanup(); clearTimeout(timer); };
  }, [refreshPendingCount]);

  // Voice subscription (stable — no deps needed beyond mount)
  useEffect(() => {
    const unsubscribe = voiceManager.subscribe((state, text, confidence, suggs) => {
      setVoiceState(state);

      if (state === VoiceState.ERROR && text) {
        setError(text);
      }

      if (confidence !== undefined) {
        setConfidenceScore(confidence);
      }

      if (suggs !== undefined) {
        setSuggestions(suggs);
      }

      if (text && state !== VoiceState.ERROR) {
        // ── Normalize voice input before processing ──────────────
        const normalizedText = normalizeVoiceInput(text);
        setTranscript(normalizedText);

        debugLog({ type: 'VOICE_INPUT', action: state, detail: { raw: text, normalized: normalizedText, confidence } });

        if (state === VoiceState.PROCESSING) {
          setChatHistory((prev) => [...prev, { sender: 'user', text: normalizedText }]);

          // ── VoiceCommandEngine — central intent processing ─────
          // Get current regFlow from latest state (via functional setState)
          setRegFlow(currentRegFlow => {
            const engineResult = processVoiceCommand(
              normalizedText,
              currentScreenRef.current,
              (confidence as ConfidenceLevel) || 'medium',
              currentRegFlow,
              language, // Pass current language for script mismatch detection
            );

            debugLog({
              type: 'PARSED_COMMAND',
              action: 'ENGINE_RESULT',
              detail: {
                intent: engineResult.intent.type,
                action: engineResult.action.actionType,
                handledLocally: engineResult.handledLocally,
                forwardToBackend: engineResult.forwardToBackend,
                layer: (engineResult.intent as any).matchLayer,
                flowLocked: flowLock.isLocked(),
              },
            });

            // Handle local navigation from intent router (cross-screen commands)
            if (engineResult.navigateTo && engineResult.navigateTo !== currentScreenRef.current) {
              // For flow starts, use dedicated starters that properly init regFlow + FlowLock
              if (engineResult.intent.type === 'START_REGISTRATION') {
                setTimeout(() => startRegFlowRef.current?.(), 0);
              } else if (engineResult.intent.type === 'START_COMPLAINT') {
                // Navigate to complaint without FlowLock — complaint is a simple
                // form that doesn't need navigational protection like registration
                setTimeout(() => {
                  navigate(ScreenName.COMPLAINT);
                }, 0);
              } else if (!flowLock.isLocked() || flowLock.shouldAllowNavigation(engineResult.intent.type)) {
                // Use setTimeout to avoid setState-in-setState
                setTimeout(() => {
                  // If navigating away due to START_OVER, release the lock first
                  if (engineResult.intent.type === 'START_OVER') {
                    flowLock.release();
                  }
                  navigate(engineResult.navigateTo!);
                  // After navigation, if there's department data for FIND_ROOM, dispatch it
                  if (engineResult.intent.type === 'FIND_ROOM' && engineResult.action.data?.department) {
                    setTimeout(() => {
                      window.dispatchEvent(new CustomEvent('app-interaction', {
                        detail: {
                          type: 'SELECT_DEPARTMENT',
                          payload: { department: engineResult.action.data!.department },
                        },
                      }));
                    }, 500);
                  }
                }, 0);
              } else {
                debugLog({ type: 'BLOCKED', action: 'ENGINE_NAV_FLOW_LOCKED', detail: { targetScreen: engineResult.navigateTo, activeFlow: flowLock.getActiveFlow() } });
              }
            }

            // If already on flow's screen but regFlow not started (e.g. backend triggered), activate
            if (engineResult.intent.type === 'START_REGISTRATION' && !engineResult.navigateTo) {
              setTimeout(() => startRegFlowRef.current?.(), 0);
            }

            // Handle registration field fill from engine
            if (engineResult.fillField) {
              const { field, value } = engineResult.fillField;
              setTimeout(() => {
                updateRegFlow(field as keyof RegistrationFlowData, value);
              }, 0);
            }

            // Handle button auto-click
            if (engineResult.autoClickButton) {
              voiceAutoClick(engineResult.autoClickButton);
            }

            // Token extraction with confirmation
            if (engineResult.intent.type === 'LOOKUP_TOKEN' && engineResult.intent.value) {
              setTimeout(() => {
                setPendingTokenConfirm(engineResult.intent.value!);
                debugLog({ type: 'ACTION', action: 'TOKEN_PENDING_CONFIRM', detail: { token: engineResult.intent.value } });
              }, 0);
            }

            // Handle kiosk reset
            if (engineResult.intent.type === 'START_OVER') {
              setTimeout(() => {
                resetRegFlow();
                clarificationGuard.reset();
                sessionContext.setFlow(null);
                flowLock.release();
              }, 0);
            }

            // Low confidence local response
            if (engineResult.lowConfidence) {
              setTimeout(() => {
                setSuggestions(['Yes, correct', 'No, try again']);
                debugLog({ type: 'ACTION', action: 'LOW_CONFIDENCE_PROMPT', detail: { confidence, text: normalizedText } });
              }, 0);
            }

            // Return unchanged regFlow (we handle fills via setTimeout above)
            return currentRegFlow;
          });

        } else if (state === VoiceState.SPEAKING) {
          setChatHistory((prev) => [...prev, { sender: 'bot', text: normalizedText }]);
        }
      }
    });

    // V2: Subscribe to structured LLM orchestrator messages
    const unsubOrchestrator = voiceManager.subscribeOrchestrator((msg: OrchestratorMessage) => {
      // Track fallback mode
      if (msg.is_fallback !== undefined) {
        setIsFallbackMode(msg.is_fallback);
      }

      // Track last action
      if (msg.action) {
        setLastOrchestratorAction(msg.action);
      }

      // Track clarification question so the backend knows what we last asked
      if (msg.action === 'clarify' && msg.message) {
        // ── ClarificationGuard — prevent infinite loops ────────
        const guardResult = handleClarification(msg.message);
        if (guardResult.manualInput) {
          // Clarification limit hit → switch to manual input
          debugLog({ type: 'ACTION', action: 'CLARIFY_LOOP_BREAK', detail: { message: msg.message, fallback: guardResult.fallbackMessage } });
          voiceManager.setPendingQuestion('');
          setError(guardResult.fallbackMessage || "Please type your answer instead.");
          setSuggestions([]);
          // Don't forward the repeated clarification to the user
        } else {
          voiceManager.setPendingQuestion(msg.message);
        }
        // CRITICAL: Clarification messages NEVER trigger navigation — return early
        return;
      } else if (msg.status === 'action_complete') {
        // Clear pending question and reset clarification guard
        voiceManager.setPendingQuestion('');
        clarificationGuard.recordSuccess();
      }

      // ── Process Command Envelope (Section 7 — Command Execution Engine) ──
      if (msg.command) {
        const cmd = msg.command;
        debugLog({ type: 'ACTION', action: 'COMMAND_ENVELOPE', detail: cmd });

        switch (cmd.command_type) {
          case 'NAVIGATE_SCREEN': {
            const navTarget = cmd.navigate_to;
            // FlowLock guard — block orchestrator navigation during active flow
            // BUT allow navigation to the flow's own screen
            if (flowLock.isLocked()) {
              const flowScreenKey = flowLock.getFlowScreen();
              const targetKey = navTarget?.toUpperCase();
              if (targetKey !== flowScreenKey) {
                debugLog({ type: 'BLOCKED', action: 'ORCH_NAV_FLOW_LOCKED', detail: { navTarget, flowScreen: flowScreenKey, activeFlow: flowLock.getActiveFlow(), step: flowLock.getCurrentStep() } });
                break; // Don't navigate — flow is active and target is not the flow's screen
              }
            }
            if (navTarget) {
              const screenMap: Record<string, ScreenName> = {
                HOME: ScreenName.HOME,
                REGISTRATION: ScreenName.REGISTRATION,
                QUEUE: ScreenName.QUEUE,
                NAVIGATION: ScreenName.NAVIGATION,
                COMPLAINT: ScreenName.COMPLAINT,
                LANGUAGE: ScreenName.LANGUAGE,
                RECEIPT: ScreenName.RECEIPT,
                LAB_TESTS: ScreenName.LAB_TESTS,
              };
              const screen = screenMap[navTarget.toUpperCase()];
              if (screen) {
                dispatchInteractRef.current({ type: 'NAVIGATE', payload: { route: screen } });
              }
            }
            // Find Room voice command: resolve department and navigate (only when dept data present)
            const deptInput = (cmd.target || cmd.data?.department || '') as string;
            if (deptInput) {
              const resolvedDept = resolveDepartment(deptInput);
              if (resolvedDept) {
                debugLog({ type: 'NAVIGATION', action: 'DEPARTMENT_FOUND', detail: { input: deptInput, resolved: resolvedDept } });
                dispatchInteractRef.current({ type: 'NAVIGATE', payload: { route: ScreenName.NAVIGATION } });
                // Dispatch department selection event for NavigationScreen to pick up
                setTimeout(() => {
                  window.dispatchEvent(new CustomEvent('app-interaction', {
                    detail: {
                      type: 'SELECT_DEPARTMENT',
                      payload: { department: resolvedDept },
                    },
                  }));
                }, 500);
              } else {
                debugLog({ type: 'ERROR', action: 'DEPARTMENT_NOT_FOUND', detail: { input: deptInput } });
                setError(`Department "${deptInput}" not found. Please try again.`);
                setSuggestions(['Cardiology', 'General Medicine', 'Pediatrics', 'Orthopedics']);
              }
            }
            break;
          }
          case 'BATCH_FORM_FILL':
            dispatchInteractRef.current({
              type: 'BATCH_FORM_FILL',
              payload: { target: cmd.target, fields: cmd.fields },
              requires_confirmation: cmd.requires_confirmation,
            });
            break;
          case 'CLICK_BUTTON':
            dispatchInteractRef.current({
              type: 'CLICK_BUTTON',
              payload: { button_id: cmd.target },
            });
            break;
          case 'SUBMIT_FORM':
            dispatchInteractRef.current({
              type: 'SUBMIT_FORM',
              payload: { target: cmd.target },
              requires_confirmation: cmd.requires_confirmation,
            });
            break;
          case 'START_REGISTRATION': {
            // Voice said "Register new patient" — start the flow
            startRegFlowRef.current?.();
            break;
          }
          default:
            debugLog({ type: 'ERROR', action: 'UNKNOWN_COMMAND', detail: cmd });
            break;
        }
      } else {
        // Legacy path: handle navigation from raw navigate_to field
        const navigateTo = msg.navigate_to || msg.result?.navigate_to;
        if (navigateTo) {
          // FlowLock guard — allow flow's own screen, block others
          const flowScreenKey = flowLock.getFlowScreen();
          if (flowLock.isLocked() && navigateTo.toUpperCase() !== flowScreenKey) {
            debugLog({ type: 'BLOCKED', action: 'LEGACY_NAV_FLOW_LOCKED', detail: { navigateTo, flowScreen: flowScreenKey, activeFlow: flowLock.getActiveFlow() } });
          } else {
            const screenMap: Record<string, ScreenName> = {
              HOME: ScreenName.HOME,
              REGISTRATION: ScreenName.REGISTRATION,
              QUEUE: ScreenName.QUEUE,
              NAVIGATION: ScreenName.NAVIGATION,
              COMPLAINT: ScreenName.COMPLAINT,
              LANGUAGE: ScreenName.LANGUAGE,
              RECEIPT: ScreenName.RECEIPT,
              LAB_TESTS: ScreenName.LAB_TESTS,
            };
            const screen = screenMap[navigateTo.toUpperCase()];
            if (screen) {
              dispatchInteractRef.current({ type: 'NAVIGATE', payload: { route: screen } });
            }
          }
        }
      }

      // Handle specific tool results
      if (msg.status === 'action_complete' && msg.result?.success) {
        const data = msg.result.data;

        switch (msg.action) {
          case 'register_patient':
            // Registration completed on backend — release FlowLock immediately
            // so user can freely navigate to Receipt, Queue, etc.
            if (flowLock.getActiveFlow() === 'registration') {
              flowLock.release();
              debugLog({ type: 'ACTION', action: 'FLOW_LOCK_REG_COMPLETE', detail: { token: data.token_number } });
            }
            // Reset regFlow to IDLE since registration is done
            setRegFlow(createInitialFlowState());

            if (data.registration_id) {
              // Auto-commit the registration result (backend already confirmed)
              setRegistrationResult({
                registration_id: data.registration_id as string,
                token_number: data.token_number as string,
                department: data.department as string,
                position: data.position as number,
                estimated_wait_time_mins: data.estimated_wait_time_mins as number,
                patient_name: data.patient_name as string,
                patient_age: data.patient_age as string,
                patient_gender: data.patient_gender as string,
                patient_phone: data.patient_phone as string,
                language: data.language as string,
                created_at: data.created_at as string,
              });
              // Auto-navigate to Receipt after successful registration
              dispatchInteractRef.current({ type: 'NAVIGATE', payload: { route: ScreenName.RECEIPT } });
            }
            break;

          case 'get_queue_status':
            // Update queue data from LLM tool
            if (data.queue && Array.isArray(data.queue)) {
              setQueueData(data.queue as QueueStatus[]);
            }
            break;

          case 'get_directions':
            // Update directions from LLM tool
            if (data.directions) {
              setDirections(data.directions as MapDirections);
            }
            break;

          case 'lookup_token':
            // Update lookup result from LLM tool
            if (data.registration_id) {
              setLookupResult({
                registration_id: data.registration_id as string,
                token_number: data.token_number as string,
                department: data.department as string,
                position: data.position as number,
                queue_status: data.queue_status as string,
                estimated_wait_time_mins: data.estimated_wait_time_mins as number,
                patient_name: data.patient_name as string,
                patient_age: data.patient_age as string,
                patient_gender: data.patient_gender as string,
                patient_phone: data.patient_phone as string,
                language: data.language as string,
                created_at: data.created_at as string,
              });
            }
            break;

          default:
            break;
        }
      }

      // Handle errors from orchestrator
      if (msg.status === 'error' && msg.error) {
        setError(msg.error);
      }
    });

    return () => {
      unsubscribe();
      unsubOrchestrator();
    };
  }, []);

  // ── Smart Action Confirmation handlers ──────────────────────────────────────
  const confirmAction = useCallback(() => {
    if (!pendingAction) return;

    if (pendingAction.type === 'register_patient' && pendingAction.data.registration_id) {
      const data = pendingAction.data;
      setRegistrationResult({
        registration_id: data.registration_id as string,
        token_number: data.token_number as string,
        department: data.department as string,
        position: data.position as number,
        estimated_wait_time_mins: data.estimated_wait_time_mins as number,
        patient_name: data.patient_name as string,
        patient_age: data.patient_age as string,
        patient_gender: data.patient_gender as string,
        patient_phone: data.patient_phone as string,
        language: data.language as string,
        created_at: data.created_at as string,
      });
      setCurrentScreen(ScreenName.RECEIPT);
    }
    setPendingAction(null);
  }, [pendingAction]);

  const cancelAction = useCallback(() => {
    setPendingAction(null);
    setVoiceState(VoiceState.IDLE);
    setTranscript('');
  }, []);

  // ── Memoised context value (prevents children re-rendering on unrelated state) ──

  const value = useMemo<KioskContextType>(
    () => ({
      currentScreen,
      language,
      voiceState,
      transcript,
      chatHistory,
      patientDetails,
      isDarkMode,
      error,
      isHelpOpen,
      hasSelectedLanguage,
      queueData,
      queueLoading,
      directions,
      directionsLoading,
      registrationResult,
      registrationLoading,
      lookupResult,
      lookupLoading,
      pendingAction,
      confirmAction,
      cancelAction,
      receiptUrl,
      uploadingReceipt,
      uploadProgress,
      pendingCount,
      lastSaveLocation,
      isFallbackMode,
      lastOrchestratorAction,
      workflowState,
      confidenceScore,
      suggestions,
      // Registration Flow
      regFlow,
      updateRegFlow,
      startRegFlow,
      resetRegFlow,
      setRegStep,
      // Token confirmation
      pendingTokenConfirm,
      confirmToken,
      rejectToken,
      // Actions
      sendVoiceText,
      updatePatientDetails,
      navigate,
      setLanguage,
      toggleVoice,
      resetKiosk,
      toggleDarkMode,
      toggleHelp,
      dismissError,
      refreshQueue,
      loadDirections,
      submitRegistration,
      scanToken,
      uploadReceiptImage,
      uploadReceiptFile,
      uploadFile,
      uploadLabFile,
      isLocked,
      dispatchInteract,
    }),
    [
      currentScreen,
      language,
      voiceState,
      transcript,
      chatHistory,
      patientDetails,
      isDarkMode,
      error,
      isHelpOpen,
      hasSelectedLanguage,
      confidenceScore,
      suggestions,
      queueData,
      queueLoading,
      directions,
      directionsLoading,
      registrationResult,
      registrationLoading,
      lookupResult,
      lookupLoading,
      pendingAction,
      confirmAction,
      cancelAction,
      receiptUrl,
      uploadingReceipt,
      uploadProgress,
      pendingCount,
      lastSaveLocation,
      isFallbackMode,
      lastOrchestratorAction,
      workflowState,
      regFlow,
      updateRegFlow,
      startRegFlow,
      resetRegFlow,
      setRegStep,
      pendingTokenConfirm,
      confirmToken,
      rejectToken,
      sendVoiceText,
      updatePatientDetails,
      navigate,
      setLanguage,
      toggleVoice,
      resetKiosk,
      toggleDarkMode,
      toggleHelp,
      dismissError,
      refreshQueue,
      loadDirections,
      submitRegistration,
      scanToken,
      uploadReceiptFile,
      uploadFile,
      uploadLabFile,
      isLocked,
      dispatchInteract,
    ],
  );

  return <KioskContext.Provider value={value}>{children}</KioskContext.Provider>;
};

export const useKiosk = () => {
  const ctx = useContext(KioskContext);
  if (!ctx) throw new Error('useKiosk must be used within KioskProvider');
  return ctx;
};
