import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { BrainLogEntry } from '../services/AppBrain';
import { isDebugEnabled, enableDebug, disableDebug } from '../services/AppBrain';

/**
 * ════════════════════════════════════════════════════════════════════════════════
 * Voice Debug Overlay (Section 10 — Debug Mode)
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * Floating panel that shows real-time voice/intent/dispatch logs.
 * Activated by:
 *  - window.VOICE_DEBUG = true (console)
 *  - enableVoiceDebug() (console)
 *  - Triple-tap on the voice orb area
 *
 * Shows:
 *  - Transcript
 *  - Detected intent
 *  - Dispatched action
 *  - Screen change
 *  - Confidence level
 */

const TYPE_COLORS: Record<string, string> = {
  'VOICE_INPUT': 'text-blue-400',
  'PARSED_COMMAND': 'text-purple-400',
  'ACTION': 'text-green-400',
  'NAVIGATION': 'text-yellow-400',
  'FIELD_FILL': 'text-cyan-400',
  'ERROR': 'text-red-400',
  'BLOCKED': 'text-orange-400',
  'STT': 'text-indigo-400',
  'TTS': 'text-pink-400',
  'CONFIRMED': 'text-emerald-400',
};

const MAX_DISPLAY = 50;

export const VoiceDebugOverlay: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(isDebugEnabled());
  const [logs, setLogs] = useState<BrainLogEntry[]>([]);
  const [filter, setFilter] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // Poll for new logs
  useEffect(() => {
    if (!isOpen) return;

    const poll = () => {
      if (typeof window !== 'undefined' && window.APP_BRAIN_LOG) {
        setLogs([...window.APP_BRAIN_LOG].slice(-MAX_DISPLAY));
      }
    };
    poll();
    pollRef.current = setInterval(poll, 500);
    return () => clearInterval(pollRef.current);
  }, [isOpen]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const toggleDebug = () => {
    if (debugEnabled) {
      disableDebug();
      setDebugEnabled(false);
    } else {
      enableDebug();
      setDebugEnabled(true);
    }
  };

  const filteredLogs = filter
    ? logs.filter(l => (l.type + ' ' + (l.action || '')).toLowerCase().includes(filter.toLowerCase()))
    : logs;

  const clearLogs = () => {
    if (typeof window !== 'undefined') {
      window.APP_BRAIN_LOG = [];
      setLogs([]);
    }
  };

  return (
    <>
      {/* Toggle button — bottom-left corner */}
      <button
        onClick={() => setIsOpen(p => !p)}
        className="fixed bottom-6 left-4 z-[70] w-8 h-8 rounded-full bg-slate-800/80 text-white text-xs flex items-center justify-center hover:bg-slate-700 transition-colors backdrop-blur-sm border border-slate-600/50"
        title="Voice Debug Panel"
      >
        {isOpen ? '×' : '🐛'}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, x: -300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -300 }}
            transition={{ type: 'spring', damping: 25, stiffness: 250 }}
            className="fixed bottom-16 left-4 z-[70] w-[400px] max-w-[calc(100vw-2rem)] max-h-[60vh] bg-slate-900/95 backdrop-blur-lg rounded-xl border border-slate-700/50 shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50 flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-300">Voice Debug</span>
                <button
                  onClick={toggleDebug}
                  className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                    debugEnabled
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : 'bg-red-500/20 text-red-400 border border-red-500/30'
                  }`}
                >
                  {debugEnabled ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={clearLogs}
                  className="text-[10px] px-2 py-0.5 rounded bg-slate-700/50 text-slate-400 hover:text-white transition-colors"
                >
                  Clear
                </button>
                <span className="text-[10px] text-slate-500 font-mono">{filteredLogs.length} logs</span>
              </div>
            </div>

            {/* Filter */}
            <div className="px-3 py-1.5 border-b border-slate-700/30 flex-shrink-0">
              <input
                type="text"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Filter (STT, TTS, ACTION, PARSED_COMMAND...)"
                className="w-full bg-slate-800/50 text-slate-300 text-[11px] font-mono rounded px-2 py-1 border border-slate-700/30 focus:outline-none focus:border-blue-500/50 placeholder-slate-600"
              />
            </div>

            {/* Log entries */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-2 py-1 text-[10px] font-mono leading-relaxed"
            >
              {filteredLogs.length === 0 && (
                <div className="text-slate-600 text-center py-4">
                  {debugEnabled ? 'Waiting for voice activity...' : 'Enable debug mode to see logs'}
                </div>
              )}
              {filteredLogs.map((log, i) => {
                const time = new Date(log.timestamp).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const colorClass = TYPE_COLORS[log.type] || 'text-slate-400';
                const detail = log.detail ? (typeof log.detail === 'string' ? log.detail : JSON.stringify(log.detail)) : '';
                // Truncate long detail strings
                const shortDetail = detail.length > 120 ? detail.slice(0, 120) + '…' : detail;

                return (
                  <div key={i} className="flex gap-1 py-0.5 border-b border-slate-800/30 hover:bg-slate-800/30">
                    <span className="text-slate-600 flex-shrink-0">{time}</span>
                    <span className={`${colorClass} flex-shrink-0 w-[80px] truncate`}>{log.type}</span>
                    <span className="text-slate-300 flex-shrink-0">{log.action || '-'}</span>
                    {shortDetail && (
                      <span className="text-slate-500 truncate ml-1" title={detail}>{shortDetail}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
