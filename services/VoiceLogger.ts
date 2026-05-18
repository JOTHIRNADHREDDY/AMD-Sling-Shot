/**
 * ════════════════════════════════════════════════════════════════════════════════
 * Voice Logger — Persistent STT & TTS Log Store
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * Captures every STT input (what the user said) and TTS output (what the system
 * spoke back) with timestamps, metadata, and contextual info.
 *
 * Features:
 *  - Structured log entries for STT and TTS separately
 *  - localStorage persistence (survives page refresh)
 *  - Configurable max entries (auto-prune oldest)
 *  - Export to JSON / clipboard
 *  - Real-time subscriber notifications for UI updates
 *  - Session grouping (logs grouped by voice interaction session)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface STTLogEntry {
  id: string;
  type: 'STT';
  timestamp: number;
  /** The phase: mic opened, recording, transcript received, etc. */
  phase: 'MIC_OPEN' | 'RECORDING_START' | 'VAD_SILENCE' | 'AUDIO_SENT' | 'TRANSCRIPT' | 'FINAL_TRANSCRIPT' | 'TEXT_COMMAND' | 'ERROR';
  /** Raw transcript text from speech recognition */
  transcript?: string;
  /** Confidence level from backend */
  confidence?: 'high' | 'medium' | 'low';
  /** Audio metadata */
  audioMeta?: {
    sizeBytes?: number;
    durationMs?: number;
    mimeType?: string;
    chunks?: number;
  };
  /** Current screen when STT happened */
  screen?: string;
  /** Language */
  language?: string;
  /** Session ID */
  sessionId?: string;
  /** Extra details */
  detail?: string;
}

export interface TTSLogEntry {
  id: string;
  type: 'TTS';
  timestamp: number;
  /** The phase: text queued, audio received, playback started/ended, etc. */
  phase: 'TEXT_QUEUED' | 'AUDIO_RECEIVED' | 'PLAYBACK_START' | 'PLAYBACK_END' | 'PLAYBACK_ERROR' | 'HTTP_FALLBACK' | 'BROWSER_SYNTH' | 'STOPPED' | 'CLARIFICATION';
  /** The text that was spoken / queued for TTS */
  text?: string;
  /** Audio metadata */
  audioMeta?: {
    sizeBytes?: number;
    durationSec?: number;
    mimeType?: string;
    queueLength?: number;
  };
  /** Source of TTS audio */
  source?: 'websocket' | 'http_fallback' | 'browser_synth' | 'mock';
  /** Current screen */
  screen?: string;
  /** Language */
  language?: string;
  /** Extra details */
  detail?: string;
}

export type VoiceLogEntry = STTLogEntry | TTSLogEntry;

type LogSubscriber = (entries: VoiceLogEntry[]) => void;

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'medikisok_voice_logs';
const MAX_ENTRIES = 500;
const PRUNE_TO = 350; // when pruning, keep this many

// ── Singleton Logger ──────────────────────────────────────────────────────────

class VoiceLoggerClass {
  private entries: VoiceLogEntry[] = [];
  private subscribers: Set<LogSubscriber> = new Set();
  private idCounter = 0;
  private _enabled = true;

  constructor() {
    this.loadFromStorage();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  get enabled() { return this._enabled; }
  set enabled(val: boolean) { this._enabled = val; }

  /** Log an STT event */
  logSTT(entry: Omit<STTLogEntry, 'id' | 'type' | 'timestamp'>) {
    if (!this._enabled) return;
    const full: STTLogEntry = {
      ...entry,
      id: this.nextId(),
      type: 'STT',
      timestamp: Date.now(),
    };
    this.push(full);
  }

  /** Log a TTS event */
  logTTS(entry: Omit<TTSLogEntry, 'id' | 'type' | 'timestamp'>) {
    if (!this._enabled) return;
    const full: TTSLogEntry = {
      ...entry,
      id: this.nextId(),
      type: 'TTS',
      timestamp: Date.now(),
    };
    this.push(full);
  }

  /** Get all logs */
  getAll(): VoiceLogEntry[] {
    return [...this.entries];
  }

  /** Get only STT logs */
  getSTT(): STTLogEntry[] {
    return this.entries.filter((e): e is STTLogEntry => e.type === 'STT');
  }

  /** Get only TTS logs */
  getTTS(): TTSLogEntry[] {
    return this.entries.filter((e): e is TTSLogEntry => e.type === 'TTS');
  }

  /** Get logs from the last N minutes */
  getRecent(minutes: number): VoiceLogEntry[] {
    const cutoff = Date.now() - minutes * 60_000;
    return this.entries.filter(e => e.timestamp >= cutoff);
  }

  /** Clear all logs */
  clear() {
    this.entries = [];
    this.saveToStorage();
    this.notifySubscribers();
  }

  /** Subscribe to log updates — returns unsubscribe function */
  subscribe(cb: LogSubscriber): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  /** Export logs as JSON string */
  exportJSON(filter?: 'STT' | 'TTS'): string {
    const data = filter ? this.entries.filter(e => e.type === filter) : this.entries;
    return JSON.stringify(data, null, 2);
  }

  /** Copy logs to clipboard */
  async copyToClipboard(filter?: 'STT' | 'TTS'): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(this.exportJSON(filter));
      return true;
    } catch {
      return false;
    }
  }

  /** Download logs as a JSON file */
  downloadJSON(filter?: 'STT' | 'TTS') {
    const json = this.exportJSON(filter);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voice-logs-${filter || 'all'}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Get summary stats */
  getStats() {
    const stt = this.getSTT();
    const tts = this.getTTS();
    const transcripts = stt.filter(e => e.phase === 'TRANSCRIPT' || e.phase === 'FINAL_TRANSCRIPT');
    return {
      totalEntries: this.entries.length,
      sttCount: stt.length,
      ttsCount: tts.length,
      transcriptCount: transcripts.length,
      lastActivity: this.entries.length > 0 ? this.entries[this.entries.length - 1].timestamp : null,
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private nextId(): string {
    return `vl_${Date.now()}_${++this.idCounter}`;
  }

  private push(entry: VoiceLogEntry) {
    this.entries.push(entry);
    // Auto-prune
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-PRUNE_TO);
    }
    this.saveToStorage();
    this.notifySubscribers();
  }

  private notifySubscribers() {
    const snapshot = [...this.entries];
    this.subscribers.forEach(cb => {
      try { cb(snapshot); } catch { /* swallow */ }
    });
  }

  private saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // Storage full — prune more aggressively
      this.entries = this.entries.slice(-100);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries)); } catch { /* give up */ }
    }
  }

  private loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.entries = parsed;
          this.idCounter = parsed.length;
        }
      }
    } catch {
      this.entries = [];
    }
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────────

export const VoiceLogger = new VoiceLoggerClass();

// Expose on window for console debugging
if (typeof window !== 'undefined') {
  (window as any).VoiceLogger = VoiceLogger;
}
