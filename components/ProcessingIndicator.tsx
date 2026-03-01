import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useKiosk } from '../context/KioskContext';
import { VoiceState } from '../types';

export const ProcessingIndicator: React.FC = () => {
  const { voiceState, transcript, confidenceScore, suggestions, setTranscript, pendingAction, confirmAction, cancelAction } = useKiosk();

  // Don't show if idle or in an error state without a transcript, UNLESS there's a pending action
  if (voiceState === VoiceState.IDLE && !pendingAction) return null;

  // Determine confidence dot color
  const getConfidenceColor = () => {
    switch (confidenceScore) {
      case 'high': return 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]';
      case 'medium': return 'bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.6)]';
      case 'low': return 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]';
      default: return 'bg-gray-300 dark:bg-gray-600 hidden'; // Hide if missing
    }
  };

  return (
    <AnimatePresence>
      {(voiceState === VoiceState.PROCESSING || voiceState === VoiceState.SPEAKING || (voiceState === VoiceState.LISTENING && transcript) || pendingAction) && (
        <motion.div
          initial={{ opacity: 0, y: 15, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="absolute -top-32 left-1/2 transform -translate-x-1/2 flex flex-col items-center gap-3 z-50 pointer-events-auto"
        >
          {/* Main Transcript / Processing Bubble */}
          <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-md px-6 py-3 rounded-2xl shadow-xl border border-gray-200/50 dark:border-slate-700/50 flex flex-col items-center gap-3 max-w-[80vw] md:max-w-md">

            <div className="flex items-center gap-3 w-full">
              {/* Bounce Animation (While Processing without text) */}
              {voiceState === VoiceState.PROCESSING && !transcript && !pendingAction && (
                <div className="flex gap-1.5 shrink-0">
                  <div className="w-2h-2 bg-primary dark:bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s] gpu-accelerated"></div>
                  <div className="w-2.5 h-2.5 bg-primary dark:bg-blue-400 rounded-full animate-bounce [animation-delay:-0.15s] gpu-accelerated"></div>
                  <div className="w-2.5 h-2.5 bg-primary dark:bg-blue-400 rounded-full animate-bounce gpu-accelerated"></div>
                </div>
              )}

              {/* Status Icon / Confidence Dot */}
              {voiceState === VoiceState.SPEAKING && !pendingAction && (
                <span className="material-symbols-outlined text-emerald-500 animate-pulse shrink-0">vital_signs</span>
              )}
              {transcript && voiceState !== VoiceState.SPEAKING && !pendingAction && (
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 transition-colors duration-300 ${getConfidenceColor()}`} title={`Confidence: ${confidenceScore || 'Unknown'}`} />
              )}
              {pendingAction && (
                <span className="material-symbols-outlined text-yellow-500 shrink-0 select-none">help</span>
              )}

              {/* Transcript Text / Pending Action Text */}
              <span className="text-sm md:text-base font-medium text-slate-800 dark:text-slate-200 line-clamp-2 leading-snug break-words">
                {pendingAction ? pendingAction.message : (transcript ? `"${transcript}"` : 'Processing voice...')}
              </span>
            </div>

            {/* Pending Action Confirmation Buttons */}
            {pendingAction && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="flex items-center gap-3 w-full mt-2 pt-2 border-t border-gray-100 dark:border-slate-700/50"
              >
                <button
                  onClick={confirmAction}
                  className="flex-1 bg-green-500 hover:bg-green-600 active:bg-green-700 text-white font-bold py-2 px-4 rounded-xl shadow-md transition-colors flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-lg">check_circle</span>
                  Yes
                </button>
                <button
                  onClick={cancelAction}
                  className="flex-1 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-800/50 text-red-600 dark:text-red-400 font-bold py-2 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-lg">replay</span>
                  Try Again
                </button>
              </motion.div>
            )}

          </div>

          {/* Contextual Suggestion Chips (#5) */}
          {suggestions && suggestions.length > 0 && voiceState !== VoiceState.LISTENING && !pendingAction && (
            <motion.div
              initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              className="flex flex-wrap justify-center gap-2"
            >
              {suggestions.map((sugg, idx) => (
                <button
                  key={idx}
                  onClick={() => setTranscript(sugg)}
                  className="bg-white/80 dark:bg-slate-800/80 backdrop-blur px-3 py-1.5 rounded-full text-xs md:text-sm font-medium text-primary dark:text-blue-400 shadow-sm border border-blue-100 dark:border-blue-900/30 hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors"
                >
                  {sugg}
                </button>
              ))}
            </motion.div>
          )}

        </motion.div>
      )}
    </AnimatePresence>
  );
};
