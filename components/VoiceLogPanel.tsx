import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { VoiceLogger, VoiceLogEntry, STTLogEntry, TTSLogEntry } from '../services/VoiceLogger';

// ── Types ─────────────────────────────────────────────────────────────────────

type FilterMode = 'ALL' | 'STT' | 'TTS';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
    '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 1000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ── Phase badges ──────────────────────────────────────────────────────────────

const STT_PHASE_COLORS: Record<string, string> = {
  MIC_OPEN: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  RECORDING_START: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  VAD_SILENCE: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  AUDIO_SENT: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  TRANSCRIPT: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  FINAL_TRANSCRIPT: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  TEXT_COMMAND: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  ERROR: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const TTS_PHASE_COLORS: Record<string, string> = {
  TEXT_QUEUED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  AUDIO_RECEIVED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  PLAYBACK_START: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  PLAYBACK_END: 'bg-slate-100 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300',
  PLAYBACK_ERROR: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  HTTP_FALLBACK: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  BROWSER_SYNTH: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  STOPPED: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400',
  CLARIFICATION: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
};

// ── Single Log Row ────────────────────────────────────────────────────────────

const STTRow: React.FC<{ entry: STTLogEntry }> = ({ entry }) => (
  <div className="flex flex-col gap-1 px-3 py-2 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
    <div className="flex items-center gap-2">
      <span className="text-lg" title="Speech-to-Text">🎙️</span>
      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${STT_PHASE_COLORS[entry.phase] || 'bg-slate-100 text-slate-600'}`}>
        {entry.phase.replace(/_/g, ' ')}
      </span>
      {entry.confidence && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
          entry.confidence === 'high' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' :
          entry.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' :
          'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
        }`}>
          {entry.confidence}
        </span>
      )}
      <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto font-mono" title={new Date(entry.timestamp).toISOString()}>
        {formatTime(entry.timestamp)}
      </span>
    </div>
    {entry.transcript && (
      <div className="ml-7 text-sm text-slate-800 dark:text-slate-200 font-medium bg-blue-50/50 dark:bg-blue-950/30 rounded px-2 py-1">
        "{entry.transcript}"
      </div>
    )}
    <div className="ml-7 flex flex-wrap gap-2 text-[10px] text-slate-500 dark:text-slate-400">
      {entry.screen && <span>📍 {entry.screen}</span>}
      {entry.language && <span>🌐 {entry.language}</span>}
      {entry.audioMeta?.sizeBytes && <span>📦 {formatBytes(entry.audioMeta.sizeBytes)}</span>}
      {entry.audioMeta?.chunks && <span>🧱 {entry.audioMeta.chunks} chunks</span>}
      {entry.detail && <span className="italic">— {entry.detail}</span>}
    </div>
  </div>
);

const TTSRow: React.FC<{ entry: TTSLogEntry }> = ({ entry }) => (
  <div className="flex flex-col gap-1 px-3 py-2 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
    <div className="flex items-center gap-2">
      <span className="text-lg" title="Text-to-Speech">🔊</span>
      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${TTS_PHASE_COLORS[entry.phase] || 'bg-slate-100 text-slate-600'}`}>
        {entry.phase.replace(/_/g, ' ')}
      </span>
      {entry.source && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-mono">
          {entry.source}
        </span>
      )}
      <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto font-mono" title={new Date(entry.timestamp).toISOString()}>
        {formatTime(entry.timestamp)}
      </span>
    </div>
    {entry.text && (
      <div className="ml-7 text-sm text-slate-800 dark:text-slate-200 font-medium bg-amber-50/50 dark:bg-amber-950/30 rounded px-2 py-1">
        "{entry.text}"
      </div>
    )}
    <div className="ml-7 flex flex-wrap gap-2 text-[10px] text-slate-500 dark:text-slate-400">
      {entry.screen && <span>📍 {entry.screen}</span>}
      {entry.language && <span>🌐 {entry.language}</span>}
      {entry.audioMeta?.sizeBytes && <span>📦 {formatBytes(entry.audioMeta.sizeBytes)}</span>}
      {entry.audioMeta?.durationSec && <span>⏱️ {entry.audioMeta.durationSec.toFixed(1)}s</span>}
      {entry.audioMeta?.queueLength !== undefined && <span>📋 Queue: {entry.audioMeta.queueLength}</span>}
      {entry.detail && <span className="italic">— {entry.detail}</span>}
    </div>
  </div>
);

// ── Main Panel ────────────────────────────────────────────────────────────────

export const VoiceLogPanel: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const [entries, setEntries] = useState<VoiceLogEntry[]>([]);
  const [filter, setFilter] = useState<FilterMode>('ALL');
  const [searchText, setSearchText] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Subscribe to live updates
  useEffect(() => {
    setEntries(VoiceLogger.getAll());
    const unsub = VoiceLogger.subscribe((newEntries) => setEntries(newEntries));
    return unsub;
  }, []);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  // Filter logic
  const filtered = entries.filter(e => {
    if (filter !== 'ALL' && e.type !== filter) return false;
    if (searchText) {
      const s = searchText.toLowerCase();
      const text = e.type === 'STT'
        ? `${(e as STTLogEntry).transcript || ''} ${(e as STTLogEntry).phase} ${(e as STTLogEntry).detail || ''}`
        : `${(e as TTSLogEntry).text || ''} ${(e as TTSLogEntry).phase} ${(e as TTSLogEntry).detail || ''}`;
      return text.toLowerCase().includes(s);
    }
    return true;
  });

  const stats = VoiceLogger.getStats();

  const handleCopy = useCallback(async () => {
    const ok = await VoiceLogger.copyToClipboard(filter === 'ALL' ? undefined : filter);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [filter]);

  const handleDownload = useCallback(() => {
    VoiceLogger.downloadJSON(filter === 'ALL' ? undefined : filter);
  }, [filter]);

  const handleClear = useCallback(() => {
    VoiceLogger.clear();
  }, []);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[70]"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-white dark:bg-slate-900 shadow-2xl z-[71] flex flex-col"
          >
            {/* Header */}
            <div className="flex-none px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <span className="material-symbols-outlined text-xl">graphic_eq</span>
                  Voice Logs
                </h2>
                <button
                  onClick={onClose}
                  className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                >
                  <span className="material-symbols-outlined text-lg text-slate-500">close</span>
                </button>
              </div>

              {/* Stats bar */}
              <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mb-2">
                <span className="flex items-center gap-1">🎙️ {stats.sttCount} STT</span>
                <span className="flex items-center gap-1">🔊 {stats.ttsCount} TTS</span>
                <span className="flex items-center gap-1">📝 {stats.transcriptCount} transcripts</span>
                {stats.lastActivity && (
                  <span className="ml-auto">Last: {formatRelative(stats.lastActivity)}</span>
                )}
              </div>

              {/* Filter tabs */}
              <div className="flex gap-1 mb-2">
                {(['ALL', 'STT', 'TTS'] as FilterMode[]).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setFilter(mode)}
                    className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors ${
                      filter === mode
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {mode === 'ALL' ? `All (${stats.totalEntries})` : mode === 'STT' ? `🎙️ STT (${stats.sttCount})` : `🔊 TTS (${stats.ttsCount})`}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative">
                <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-sm text-slate-400">search</span>
                <input
                  type="text"
                  placeholder="Search transcripts, phases..."
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  className="w-full text-xs pl-7 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>

            {/* Log list */}
            <div
              ref={listRef}
              className="flex-1 overflow-y-auto"
              onScroll={() => {
                if (listRef.current) {
                  const { scrollTop, scrollHeight, clientHeight } = listRef.current;
                  setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
                }
              }}
            >
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500 gap-2">
                  <span className="material-symbols-outlined text-4xl">mic_off</span>
                  <span className="text-sm">No voice logs yet</span>
                  <span className="text-xs">Start a voice interaction to see logs here</span>
                </div>
              ) : (
                filtered.map(entry =>
                  entry.type === 'STT'
                    ? <STTRow key={entry.id} entry={entry as STTLogEntry} />
                    : <TTSRow key={entry.id} entry={entry as TTSLogEntry} />
                )
              )}
            </div>

            {/* Footer toolbar */}
            <div className="flex-none px-4 py-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                <span className="material-symbols-outlined text-sm">{copied ? 'check' : 'content_copy'}</span>
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                <span className="material-symbols-outlined text-sm">download</span>
                Download
              </button>
              <button
                onClick={handleClear}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
              >
                <span className="material-symbols-outlined text-sm">delete</span>
                Clear
              </button>
              <div className="ml-auto flex items-center gap-1.5">
                <label className="text-[10px] text-slate-400 dark:text-slate-500 select-none">Auto-scroll</label>
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={e => setAutoScroll(e.target.checked)}
                  className="w-3.5 h-3.5 accent-blue-600"
                />
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
