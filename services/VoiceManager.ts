import { VoiceState } from '../types';
import { openVoiceStream, sendVoiceIntent } from './api';
import { debugLog } from './AppBrain';
import { VoiceLogger } from './VoiceLogger';

/**
 * V2 LLM Orchestrator response types.
 * These match the backend OrchestratorResult.to_ws_message() format.
 */
export interface OrchestratorMessage {
  type: 'orchestrator_result' | 'tts_audio' | 'status' | 'config_ack' | 'error' | 'pong';
  status?: 'action_complete' | 'clarification' | 'error' | 'listening' | 'processing' | 'speaking' | 'idle';
  transcript?: string;
  action?: string;
  message?: string;
  error?: string;
  result?: {
    success: boolean;
    message: string;
    data: Record<string, unknown>;
    navigate_to?: string;
  };
  navigate_to?: string;
  is_fallback?: boolean;
  audio_base64?: string;
  session_id?: string;
  language?: string;
  confidence?: 'high' | 'medium' | 'low';
  suggestions?: string[];
  /** Command Envelope from the Command Execution Engine (Section 7). */
  command?: {
    command_type: string;
    target?: string;
    fields?: Record<string, unknown>;
    requires_confirmation?: boolean;
    navigate_to?: string;
    message?: string;
    data?: Record<string, unknown>;
  };
}

type VoiceCallback = (state: VoiceState, transcript?: string, confidence?: 'high' | 'medium' | 'low', suggestions?: string[]) => void;
type OrchestratorCallback = (message: OrchestratorMessage) => void;

class VoiceManager {
  private currentState: VoiceState = VoiceState.IDLE;
  private subscribers: VoiceCallback[] = [];
  private orchestratorSubscribers: OrchestratorCallback[] = [];

  // Keep track of all active timeouts to prevent ghost state updates
  private activeTimeouts: Set<ReturnType<typeof setTimeout>> = new Set();

  // WebSocket for streaming voice
  private ws: WebSocket | null = null;

  // Flag: true when the backend is reachable
  private backendAvailable: boolean | null = null;

  // Session ID for conversation memory
  private sessionId: string | null = null;

  // Current language for LLM context
  private language: string = 'English';

  // Current screen for LLM context (Section 4 — screen-aware prompts)
  private currentScreen: string = 'HOME';

  // Current workflow state
  private workflowState: string = 'IDLE';

  // Current registration step (e.g. NAME, AGE, GENDER) — sent to backend for LLM context
  private registrationStep: string = 'IDLE';

  // The last question the system asked (clarification context) — sent to backend
  private pendingQuestion: string = '';

  // Media recorder for capturing audio
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];

  // VAD (Voice Activity Detection)
  private audioContext: AudioContext | null = null;
  private vadAnimationFrame: number | null = null;

  // Active TTS Audio for interruption
  private currentAudio: HTMLAudioElement | null = null;

  // Audio playback queue (Step 4 — prevent overlapping audio)
  private audioQueue: Blob[] = [];
  private isPlayingAudio: boolean = false;

  // Audio unlock flag (Step 3 — browser autoplay policy)
  private audioUnlocked: boolean = false;

  subscribe(callback: VoiceCallback) {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter(cb => cb !== callback);
    };
  }

  /**
   * Subscribe to structured LLM orchestrator messages.
   * This is the V2 way to receive tool results, navigation commands, etc.
   */
  subscribeOrchestrator(callback: OrchestratorCallback) {
    this.orchestratorSubscribers.push(callback);
    return () => {
      this.orchestratorSubscribers = this.orchestratorSubscribers.filter(cb => cb !== callback);
    };
  }

  private notify(state: VoiceState, transcript?: string, confidence?: 'high' | 'medium' | 'low', suggestions?: string[]) {
    this.currentState = state;
    this.subscribers.forEach(cb => cb(state, transcript, confidence, suggestions));
    // NOTE: TTS is now handled via binary WebSocket frames, not HTTP proxy.
    // The backend sends audio bytes directly, queued and played by playAudioQueue().
  }

  private notifyOrchestrator(message: OrchestratorMessage) {
    this.orchestratorSubscribers.forEach(cb => cb(message));
  }

  private safeTimeout(callback: () => void, ms: number) {
    const timeoutId = setTimeout(() => {
      this.activeTimeouts.delete(timeoutId);
      callback();
    }, ms);
    this.activeTimeouts.add(timeoutId);
    return timeoutId;
  }

  private clearAllTimeouts() {
    this.activeTimeouts.forEach(id => clearTimeout(id));
    this.activeTimeouts.clear();
  }

  // ── Language setter ─────────────────────────────────────────────────────
  setLanguage(language: string) {
    this.language = language;
    // If WebSocket is open, send config update
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'config',
        language: this.language,
        session_id: this.sessionId,
        current_screen: this.currentScreen,
      }));
    }
  }

  // ── Screen context setter (Section 4) ──────────────────────────────────
  setCurrentScreen(screen: string) {
    this.currentScreen = screen;
    // Send lightweight screen_update to backend so it stays in sync
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'screen_update',
        current_screen: this.currentScreen,
        workflow_state: this.workflowState,
        registration_step: this.registrationStep,
        pending_question: this.pendingQuestion,
      }));
    }
  }

  // ── Workflow state setter (Section 9) ──────────────────────────────────
  setWorkflowState(state: string) {
    this.workflowState = state;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'screen_update',
        current_screen: this.currentScreen,
        workflow_state: this.workflowState,
        registration_step: this.registrationStep,
        pending_question: this.pendingQuestion,
      }));
    }
  }

  // ── Registration step setter — keeps backend in sync ───────────────────
  setRegistrationStep(step: string) {
    this.registrationStep = step;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'screen_update',
        current_screen: this.currentScreen,
        workflow_state: this.workflowState,
        registration_step: this.registrationStep,
        pending_question: this.pendingQuestion,
      }));
    }
  }

  // ── Pending question setter (last TTS clarification the system asked) ──
  setPendingQuestion(question: string) {
    this.pendingQuestion = question;
  }

  // ── Detect backend at first use ─────────────────────────────────────────
  private async checkBackend(): Promise<boolean> {
    // Only cache successful results; always retry on failure
    if (this.backendAvailable === true) return true;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch('/v1/queue/status', { method: 'GET', signal: controller.signal });
      clearTimeout(timer);
      this.backendAvailable = res.ok;
    } catch {
      this.backendAvailable = false;
    }
    return this.backendAvailable;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  async startListening() {
    if (this.currentState === VoiceState.LISTENING) return;
    this.clearAllTimeouts();
    this.stopTTS(); // Immediately interrupt any playing TTS
    this.notify(VoiceState.LISTENING);

    debugLog({ type: 'STT', action: 'MIC_OPEN', detail: { language: this.language, screen: this.currentScreen } });
    VoiceLogger.logSTT({ phase: 'MIC_OPEN', screen: this.currentScreen, language: this.language });

    // Unlock audio on first user-initiated interaction (Step 3)
    this.unlockAudio();

    // Provide instant audio feedback the moment mic is queued
    this.playBeep();

    const hasBackend = await this.checkBackend();
    if (hasBackend) {
      debugLog({ type: 'STT', action: 'BACKEND_CONNECTED', detail: { streaming: true } });
      this.startWebSocketStream();
      this.startRecording();
    } else {
      debugLog({ type: 'STT', action: 'BACKEND_OFFLINE', detail: { fallback: 'browser_tts' } });
      // Offline Voice Fallback
      this.notify(VoiceState.SPEAKING, "Network issue. Please use touch.");
      try {
        const fallbackText = "Network issue. Please try again or use the screen.";
        debugLog({ type: 'TTS', action: 'BROWSER_SYNTH_START', detail: { text: fallbackText } });
        VoiceLogger.logTTS({ phase: 'BROWSER_SYNTH', text: fallbackText, source: 'browser_synth', screen: this.currentScreen, language: this.language });
        const utterance = new SpeechSynthesisUtterance(fallbackText);
        utterance.onend = () => {
          debugLog({ type: 'TTS', action: 'BROWSER_SYNTH_END', detail: { text: fallbackText } });
          this.notify(VoiceState.IDLE);
        };
        window.speechSynthesis.speak(utterance);
      } catch (e) {
        debugLog({ type: 'TTS', action: 'BROWSER_SYNTH_ERROR', detail: { error: String(e) } });
        this.notify(VoiceState.IDLE);
      }
    }
  }

  stopListening() {
    debugLog({ type: 'STT', action: 'MIC_CLOSE', detail: { reason: 'user_stop' } });
    this.clearAllTimeouts();
    this.stopTTS();
    this.stopRecording();
    this.closeWebSocket();
    if (this.currentState !== VoiceState.IDLE) {
      this.notify(VoiceState.IDLE);
    }
  }

  /** Gracefully stop recording and wait for backend processing without closing the websocket */
  finishListening() {
    if (this.currentState !== VoiceState.LISTENING) return;
    debugLog({ type: 'STT', action: 'MIC_FINISH', detail: { reason: 'vad_silence_or_user' } });
    this.clearAllTimeouts();
    this.stopRecording();
    this.playBeep(400); // lower tone for closing
    this.notify(VoiceState.PROCESSING);
  }

  /**
   * Send a text command directly to the LLM orchestrator (skip STT).
   * This is the preferred V2 way to send typed/pre-transcribed input.
   */
  sendTextCommand(text: string) {
    debugLog({ type: 'STT', action: 'TEXT_COMMAND', detail: { text, screen: this.currentScreen } });
    VoiceLogger.logSTT({ phase: 'TEXT_COMMAND', transcript: text, screen: this.currentScreen, language: this.language });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'text',
        text: text,
        current_screen: this.currentScreen,
        registration_step: this.registrationStep,
        pending_question: this.pendingQuestion,
      }));
      this.notify(VoiceState.PROCESSING, text);
    } else {
      // Fallback: try to open WebSocket first, then send
      this.startWebSocketStream();
      this.safeTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'text',
            text: text,
            current_screen: this.currentScreen,
            registration_step: this.registrationStep,
            pending_question: this.pendingQuestion,
          }));
          this.notify(VoiceState.PROCESSING, text);
        }
      }, 1000);
    }
  }

  /** Send a single audio clip via REST (one-shot intent). */
  async sendAudioClip(audioBase64: string, language = 'en-IN') {
    debugLog({ type: 'STT', action: 'AUDIO_CLIP_SEND', detail: { language, base64Length: audioBase64.length } });
    VoiceLogger.logSTT({ phase: 'AUDIO_SENT', language, audioMeta: { sizeBytes: audioBase64.length }, screen: this.currentScreen });
    this.notify(VoiceState.PROCESSING);
    try {
      const result = await sendVoiceIntent(audioBase64, language);
      debugLog({ type: 'STT', action: 'AUDIO_CLIP_RESULT', detail: { transcript: result.transcript, intent: result.intent, entities: result.extracted_entities } });
      VoiceLogger.logSTT({ phase: 'FINAL_TRANSCRIPT', transcript: result.transcript, confidence: 'high', screen: this.currentScreen, language, detail: `Intent: ${result.intent}` });
      this.notify(VoiceState.PROCESSING, result.transcript);

      // Synthesise a reply message using the extracted data
      const entitySummary = Object.entries(result.extracted_entities)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      const reply = `Got it — ${result.intent} (${entitySummary})`;
      this.notify(VoiceState.SPEAKING, reply);

      this.safeTimeout(() => this.notify(VoiceState.IDLE), 2000);
    } catch (err) {
      console.error('Voice intent error:', err);
      this.notify(VoiceState.ERROR, 'Failed to process voice. Falling back to mock mode.');
    }
  }

  // ── WebSocket streaming (V2 LLM Orchestrator) ──────────────────────────

  private startWebSocketStream() {
    try {
      this.ws = openVoiceStream();

      this.ws.onopen = () => {
        debugLog({ type: 'STT', action: 'WS_OPEN', detail: { language: this.language, screen: this.currentScreen } });
        // Send initial config with language and screen context
        this.ws?.send(JSON.stringify({
          type: 'config',
          language: this.language,
          current_screen: this.currentScreen,
          workflow_state: this.workflowState,
          registration_step: this.registrationStep,
          pending_question: this.pendingQuestion,
        }));
      };

      this.ws.onmessage = (event) => {
        // Step 5 — Differentiate JSON text vs binary audio
        if (event.data instanceof Blob) {
          // Binary frame = TTS audio from backend (Step 1/2)
          debugLog({ type: 'TTS', action: 'WS_AUDIO_RECEIVED', detail: { blobSize: event.data.size, mimeType: event.data.type || 'audio/wav' } });
          VoiceLogger.logTTS({ phase: 'AUDIO_RECEIVED', source: 'websocket', audioMeta: { sizeBytes: event.data.size, mimeType: event.data.type || 'audio/wav' }, screen: this.currentScreen, language: this.language });
          this.enqueueAudio(event.data);
          return;
        }

        try {
          const data = JSON.parse(event.data) as OrchestratorMessage;

          // ── Handle V2 orchestrator messages ────────────────────
          if (data.type === 'orchestrator_result') {
            debugLog({ type: 'STT', action: 'ORCHESTRATOR_RESULT', detail: { status: data.status, action: data.action, transcript: data.transcript, confidence: data.confidence, command: data.command?.command_type } });
            if (data.transcript) {
              VoiceLogger.logSTT({ phase: 'FINAL_TRANSCRIPT', transcript: data.transcript, confidence: data.confidence, screen: this.currentScreen, language: this.language, detail: `Action: ${data.action || 'none'}, Command: ${data.command?.command_type || 'none'}` });
            }
            this.notifyOrchestrator(data);

            if (data.status === 'error') {
              debugLog({ type: 'ERROR', action: 'ORCHESTRATOR_ERROR', detail: { error: data.error } });
              this.notify(VoiceState.ERROR, data.error || 'An error occurred');
              return;
            }

            if (data.status === 'clarification') {
              debugLog({ type: 'TTS', action: 'CLARIFICATION', detail: { message: data.message, suggestions: data.suggestions } });
              VoiceLogger.logTTS({ phase: 'CLARIFICATION', text: data.message, source: 'websocket', screen: this.currentScreen, language: this.language, detail: `Suggestions: ${(data.suggestions || []).join(', ')}` });
              this.notify(VoiceState.SPEAKING, data.message, data.confidence, data.suggestions);
              // TTS will be handled by the subsequent 'status: speaking' message
              // or by binary audio frames — do NOT trigger HTTP fallback here
              // to avoid double-play.
              return;
            }

            if (data.status === 'action_complete') {
              const msg = data.result?.message || data.message || 'Done';
              debugLog({ type: 'TTS', action: 'ACTION_COMPLETE_SPEAK', detail: { message: msg, originalAction: data.action } });
              VoiceLogger.logTTS({ phase: 'TEXT_QUEUED', text: msg, source: 'websocket', screen: this.currentScreen, language: this.language, detail: `Action: ${data.action}` });
              this.notify(VoiceState.SPEAKING, msg, data.confidence, data.suggestions);
              // TTS will be handled by the subsequent 'status: speaking' message
              // or by binary audio frames — do NOT trigger HTTP fallback here
              // to avoid double-play.
              return;
            }
          }

          // ── Config acknowledgment ──────────────────────────────
          if (data.type === 'config_ack') {
            this.sessionId = data.session_id || null;
            return;
          }

          // ── Status updates (V2 compatible) ─────────────────────
          if (data.type === 'status') {
            debugLog({ type: data.status === 'speaking' ? 'TTS' : 'STT', action: `STATUS_${(data.status || '').toUpperCase()}`, detail: { transcript: data.transcript, confidence: data.confidence } });
            if (data.status === 'listening') {
              this.notify(VoiceState.LISTENING, data.transcript, data.confidence, data.suggestions);
            } else if (data.status === 'processing') {
              debugLog({ type: 'STT', action: 'TRANSCRIPT_RECEIVED', detail: { transcript: data.transcript, confidence: data.confidence } });
              if (data.transcript) {
                VoiceLogger.logSTT({ phase: 'TRANSCRIPT', transcript: data.transcript, confidence: data.confidence, screen: this.currentScreen, language: this.language });
              }
              this.notify(VoiceState.PROCESSING, data.transcript, data.confidence, data.suggestions);
            } else if (data.status === 'speaking') {
              debugLog({ type: 'TTS', action: 'SPEAKING_STATUS', detail: { text: data.transcript, hasQueuedAudio: this.audioQueue.length > 0, isPlaying: this.isPlayingAudio } });
              this.notify(VoiceState.SPEAKING, data.transcript, data.confidence, data.suggestions);
              // Fallback: if backend sends speaking status but no binary audio follows,
              // use HTTP /tts proxy after a longer delay to allow binary audio to arrive first.
              // 1200ms is enough for the binary frame to be received and enqueued.
              if (data.transcript && !this.isPlayingAudio && this.audioQueue.length === 0) {
                this.safeTimeout(() => {
                  if (!this.isPlayingAudio && this.audioQueue.length === 0 && data.transcript) {
                    this.playSarvamTTSFallback(data.transcript);
                  }
                }, 1200);
              }
              // Safety net: if still SPEAKING after 15s (TTS stalled / audio never finished),
              // force-recover to IDLE so the UI isn't stuck with a spinning orb.
              this.safeTimeout(() => {
                if (this.currentState === VoiceState.SPEAKING && !this.isPlayingAudio) {
                  console.warn('[VoiceManager] SPEAKING safety timeout — forcing IDLE');
                  this.notify(VoiceState.IDLE);
                }
              }, 15_000);
            } else if (data.status === 'idle') {
              // Only go to idle if we're not currently playing audio
              if (!this.isPlayingAudio) {
                this.notify(VoiceState.IDLE);
              }
            }
            return;
          }

          // ── Legacy V1 message format (backward compatible) ─────
          const legacyData = data as unknown as {
            transcript?: string;
            status?: string;
            next_prompt?: string;
          };
          if (legacyData.status === 'listening') {
            this.notify(VoiceState.LISTENING, legacyData.transcript);
          } else if (legacyData.status === 'processing') {
            this.notify(VoiceState.PROCESSING, legacyData.transcript);
          } else if (legacyData.status === 'speaking') {
            this.notify(VoiceState.SPEAKING, legacyData.transcript);
          }
          if (legacyData.next_prompt) {
            this.notify(VoiceState.SPEAKING, legacyData.next_prompt);
          }
        } catch {
          // non-JSON frame — ignore
        }
      };

      this.ws.onerror = () => {
        debugLog({ type: 'ERROR', action: 'WS_ERROR', detail: { fallback: 'mock_mode' } });
        console.warn('Voice WebSocket error – falling back to mock');
        this.closeWebSocket();
        this.startMockListening();
      };

      this.ws.onclose = () => {
        debugLog({ type: 'STT', action: 'WS_CLOSE', detail: { hadSession: !!this.sessionId } });
        this.ws = null;
        this.sessionId = null;
      };
    } catch {
      this.startMockListening();
    }
  }

  /** Send raw audio bytes over the open WebSocket. */
  sendAudioChunk(data: ArrayBuffer) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      debugLog({ type: 'STT', action: 'AUDIO_CHUNK_SENT', detail: { sizeBytes: data.byteLength } });
      this.ws.send(data);
    }
  }

  /** Start recording audio from microphone and send via WebSocket. */
  async startRecording() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Secure Context required: This browser disables microphone access on insecure connections. Please use http://localhost:3000 instead of an IP address.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      this.audioChunks = [];

      debugLog({ type: 'STT', action: 'RECORDING_START', detail: { mimeType: 'audio/webm', echoCancellation: true, noiseSuppression: true } });
      VoiceLogger.logSTT({ phase: 'RECORDING_START', screen: this.currentScreen, language: this.language, audioMeta: { mimeType: 'audio/webm' } });

      // --- VAD Setup ---
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyzer = this.audioContext.createAnalyser();
      const source = this.audioContext.createMediaStreamSource(stream);
      source.connect(analyzer);
      analyzer.minDecibels = -70; // Adjust sensitivity
      analyzer.fftSize = 512;

      const bufferLength = analyzer.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let lastSpeakTime = Date.now();
      let hasSpoken = false;

      const checkSilence = () => {
        if (this.currentState !== VoiceState.LISTENING) return;

        analyzer.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((acc, val) => acc + val, 0);
        const average = sum / bufferLength;

        if (average > 10) { // Threshold for speech (lowered to catch softer voices)
          lastSpeakTime = Date.now();
          hasSpoken = true;
        } else if (hasSpoken && Date.now() - lastSpeakTime > 2500) {
          // 2.5 seconds of silence after speaking -> auto cut
          debugLog({ type: 'STT', action: 'VAD_SILENCE_CUT', detail: { silenceMs: 2500, hasSpoken: true } });
          VoiceLogger.logSTT({ phase: 'VAD_SILENCE', screen: this.currentScreen, language: this.language, detail: 'Auto-cut after 2.5s silence' });
          this.finishListening();
          return; // Stop animation frame
        }

        this.vadAnimationFrame = requestAnimationFrame(checkSilence);
      };

      this.vadAnimationFrame = requestAnimationFrame(checkSilence);
      // --- End VAD Setup ---

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        debugLog({ type: 'STT', action: 'AUDIO_BLOB_READY', detail: { sizeBytes: audioBlob.size, chunks: this.audioChunks.length, mimeType: 'audio/webm' } });
        const arrayBuffer = await audioBlob.arrayBuffer();
        this.sendAudioChunk(arrayBuffer);
        debugLog({ type: 'STT', action: 'AUDIO_SENT_TO_BACKEND', detail: { sizeBytes: arrayBuffer.byteLength } });
        VoiceLogger.logSTT({ phase: 'AUDIO_SENT', screen: this.currentScreen, language: this.language, audioMeta: { sizeBytes: arrayBuffer.byteLength, chunks: this.audioChunks.length, mimeType: 'audio/webm' } });

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      this.mediaRecorder.start();
    } catch (err: any) {
      debugLog({ type: 'ERROR', action: 'RECORDING_FAILED', detail: { errorName: err.name, errorMessage: err.message } });
      VoiceLogger.logSTT({ phase: 'ERROR', screen: this.currentScreen, language: this.language, detail: `${err.name}: ${err.message}` });
      console.error('Failed to start recording:', err);
      if (err.name === 'NotAllowedError') {
        this.notify(VoiceState.ERROR, 'Microphone access denied. Click the lock/tune icon in the browser address bar to reset permissions.');
      } else if (err.name === 'NotFoundError') {
        this.notify(VoiceState.ERROR, 'No microphone found. Please connect a device.');
      } else {
        this.notify(VoiceState.ERROR, 'Microphone unavailable: ' + (err.message || 'Unknown error'));
      }
    }
  }

  /** Stop recording and send the captured audio. */
  stopRecording() {
    if (this.vadAnimationFrame) {
      cancelAnimationFrame(this.vadAnimationFrame);
      this.vadAnimationFrame = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => { });
      this.audioContext = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      this.mediaRecorder = null;
    }
  }

  // ── Audio Queue System (Step 4 — Prevent overlapping audio) ───────────

  /**
   * Enqueue a binary audio Blob for sequential playback.
   * Called when a binary WebSocket frame arrives from the backend.
   */
  private enqueueAudio(blob: Blob) {
    // Ensure correct MIME type (Step 6)
    const typedBlob = blob.type ? blob : new Blob([blob], { type: 'audio/wav' });
    this.audioQueue.push(typedBlob);
    debugLog({ type: 'TTS', action: 'AUDIO_ENQUEUED', detail: { blobSize: typedBlob.size, queueLength: this.audioQueue.length, isPlaying: this.isPlayingAudio } });
    if (!this.isPlayingAudio) {
      this.playAudioQueue();
    }
  }

  /**
   * Play queued audio blobs one at a time.
   * Waits for each to finish (onended) before playing next.
   */
  private async playAudioQueue() {
    if (this.audioQueue.length === 0) {
      this.isPlayingAudio = false;
      this.currentAudio = null;
      // After all audio finishes, return to IDLE
      this.notify(VoiceState.IDLE);
      return;
    }

    this.isPlayingAudio = true;
    const blob = this.audioQueue.shift()!;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.currentAudio = audio;

    debugLog({ type: 'TTS', action: 'PLAYBACK_START', detail: { blobSize: blob.size, remainingQueue: this.audioQueue.length } });
    VoiceLogger.logTTS({ phase: 'PLAYBACK_START', source: 'websocket', screen: this.currentScreen, language: this.language, audioMeta: { sizeBytes: blob.size, queueLength: this.audioQueue.length } });

    audio.onended = () => {
      debugLog({ type: 'TTS', action: 'PLAYBACK_ENDED', detail: { duration: audio.duration, remainingQueue: this.audioQueue.length } });
      VoiceLogger.logTTS({ phase: 'PLAYBACK_END', source: 'websocket', screen: this.currentScreen, language: this.language, audioMeta: { durationSec: audio.duration, queueLength: this.audioQueue.length } });
      URL.revokeObjectURL(url);
      if (this.currentAudio === audio) {
        this.currentAudio = null;
      }
      // Play next in queue
      this.playAudioQueue();
    };

    audio.onerror = (e) => {
      debugLog({ type: 'TTS', action: 'PLAYBACK_ERROR', detail: { error: String(e) } });
      VoiceLogger.logTTS({ phase: 'PLAYBACK_ERROR', source: 'websocket', screen: this.currentScreen, language: this.language, detail: String(e) });
      console.warn('Audio playback error:', e);
      URL.revokeObjectURL(url);
      if (this.currentAudio === audio) {
        this.currentAudio = null;
      }
      // Skip errored audio, play next
      this.playAudioQueue();
    };

    try {
      await audio.play();
    } catch (err) {
      console.warn('Audio play() blocked or failed:', err);
      // Skip and continue queue
      this.playAudioQueue();
    }
  }

  /**
   * Unlock audio playback on first user interaction (Step 3).
   * Browsers block audio.play() until a user gesture has occurred.
   * Call this from any user-initiated action (e.g. mic button press).
   */
  private unlockAudio() {
    if (this.audioUnlocked) return;
    try {
      const silent = new Audio();
      silent.volume = 0;
      silent.play().then(() => {
        silent.pause();
        this.audioUnlocked = true;
      }).catch(() => {
        // Still not unlocked — will try again next interaction
      });
      // Also create + resume an AudioContext (needed for some browsers)
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch {
      // ignore
    }
  }

  /**
   * Fallback: Play TTS via the HTTP /tts proxy (server.js).
   * Used only when the backend WebSocket doesn't provide binary audio.
   */
  private async playSarvamTTSFallback(text: string) {
    this.stopTTS();
    try {
      const langMap: Record<string, string> = {
        'English': 'en', 'Hindi': 'hi', 'Telugu': 'te', 'Tamil': 'ta',
        'Telugu_EN': 'te-en', 'Hindi_EN': 'hi-en'
      };
      const lang = langMap[this.language] || 'en';

      debugLog({ type: 'TTS', action: 'HTTP_FALLBACK_START', detail: { text, language: lang, textLength: text.length } });
      VoiceLogger.logTTS({ phase: 'HTTP_FALLBACK', text, source: 'http_fallback', screen: this.currentScreen, language: this.language });

      const response = await fetch("/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: lang })
      });
      if (!response.ok) throw new Error("TTS proxy failed");

      const blob = await response.blob();
      debugLog({ type: 'TTS', action: 'HTTP_FALLBACK_RECEIVED', detail: { blobSize: blob.size, mimeType: blob.type } });
      VoiceLogger.logTTS({ phase: 'AUDIO_RECEIVED', text, source: 'http_fallback', screen: this.currentScreen, language: this.language, audioMeta: { sizeBytes: blob.size, mimeType: blob.type } });
      this.enqueueAudio(blob);
    } catch (err) {
      debugLog({ type: 'TTS', action: 'HTTP_FALLBACK_ERROR', detail: { text, error: String(err) } });
      console.warn('Sarvam TTS HTTP fallback failed:', err);
      // Recover from stuck SPEAKING state — transition to IDLE so the UI isn't frozen
      if (this.currentState === VoiceState.SPEAKING) {
        this.notify(VoiceState.IDLE);
      }
    }
  }

  private closeWebSocket() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.sessionId = null;
    }
  }

  // ── Audio Helpers ────────────────────────────────────────────────────────

  private stopTTS() {
    const hadAudio = !!this.currentAudio;
    const queueLen = this.audioQueue.length;
    // Stop current audio
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    // Clear the queue so no pending audio plays
    this.audioQueue = [];
    this.isPlayingAudio = false;
    if (hadAudio || queueLen > 0) {
      debugLog({ type: 'TTS', action: 'STOP_ALL', detail: { wasPlaying: hadAudio, droppedFromQueue: queueLen } });
      VoiceLogger.logTTS({ phase: 'STOPPED', screen: this.currentScreen, language: this.language, detail: `Interrupted. Was playing: ${hadAudio}, dropped ${queueLen} from queue` });
    }
  }

  private playBeep(frequency = 600) {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(frequency + 200, ctx.currentTime + 0.1);

      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.05);
      gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
      // Ignore audio context errors if browser blocks autoplay
    }
  }

  // ── Fallback mock (original behaviour) ──────────────────────────────────

  private startMockListening() {
    debugLog({ type: 'STT', action: 'MOCK_MODE', detail: { reason: 'no_backend' } });
    this.safeTimeout(() => {
      if (Math.random() < 0.1) {
        debugLog({ type: 'STT', action: 'MOCK_ERROR', detail: { simulated: true } });
        this.notify(VoiceState.ERROR, "Sorry, I couldn't hear you clearly. Please try again.");
        return;
      }
      const mockTranscript = "My name is Rajesh Kumar, age 45 years.";
      debugLog({ type: 'STT', action: 'MOCK_TRANSCRIPT', detail: { transcript: mockTranscript } });
      VoiceLogger.logSTT({ phase: 'TRANSCRIPT', transcript: mockTranscript, screen: this.currentScreen, language: this.language, detail: 'Mock mode' });
      this.notify(VoiceState.PROCESSING, mockTranscript);
      this.processMockAudio();
    }, 3000);
  }

  private processMockAudio() {
    this.safeTimeout(() => {
      const mockReply = "I have updated your details, Rajesh.";
      debugLog({ type: 'TTS', action: 'MOCK_SPEAK', detail: { text: mockReply } });
      VoiceLogger.logTTS({ phase: 'TEXT_QUEUED', text: mockReply, source: 'mock', screen: this.currentScreen, language: this.language });
      this.notify(VoiceState.SPEAKING, mockReply);
      this.safeTimeout(() => this.notify(VoiceState.IDLE), 2000);
    }, 1500);
  }
}

export const voiceManager = new VoiceManager();