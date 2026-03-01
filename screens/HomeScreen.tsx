import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { useKiosk } from '../context/KioskContext';
import { ScreenName, Language, VoiceState } from '../types';
import { translations } from '../i18n';
import { debugLog } from '../services/AppBrain';

// ── Tile config with warm color palette ───────────────────────────────────────

const TILES = [
  { screen: ScreenName.REGISTRATION, emoji: '👨‍⚕️', labelKey: 'opReg', color: 'from-sky-400 to-blue-500', border: 'border-sky-300' },
  { screen: ScreenName.LAB_TESTS, emoji: '🧪', labelKey: 'labTests', color: 'from-teal-400 to-emerald-500', border: 'border-teal-300' },
  { screen: ScreenName.QUEUE, emoji: '🎫', labelKey: 'queue', color: 'from-violet-400 to-purple-500', border: 'border-violet-300' },
  { screen: ScreenName.NAVIGATION, emoji: '📍', labelKey: 'findRoom', color: 'from-orange-400 to-amber-500', border: 'border-orange-300' },
  { screen: ScreenName.RECEIPT, emoji: '📄', labelKey: 'receipt', color: 'from-yellow-400 to-amber-500', border: 'border-yellow-300' },
  { screen: ScreenName.COMPLAINT, emoji: '⚠️', labelKey: 'complaint', color: 'from-rose-400 to-pink-500', border: 'border-rose-300' },
] as const;

// ── Animation variants ────────────────────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 350, damping: 28 } },
} as const;

// ── Home Screen ───────────────────────────────────────────────────────────────

export const HomeScreen: React.FC = () => {
  const { dispatchInteract, language, voiceState, toggleVoice, resetKiosk, startRegFlow } = useKiosk();
  const L = translations[language];
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAutoSpoken = useRef(false);

  // ── No idle timer here as per user request ──────────────
  useEffect(() => {
    // Intentionally empty
  }, []);

  const handleEmergency = () => {
    alert(`🚨 ${L.emergency}\n\n${L.emergencyAlert}`);
  };

  return (
    <div className="w-full flex-1 flex flex-col items-center pt-4 md:pt-6 px-4 md:px-8 pb-16 scroll-momentum">
      {/* Welcome — short, simple */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="text-center mb-3 md:mb-4 w-full max-w-4xl"
      >
        <h2 className="font-heading text-2xl md:text-4xl font-bold text-slate-800 dark:text-slate-100 mb-1">
          {L.welcome} <span className="text-primary dark:text-blue-400">{L.hospitalName}</span>
        </h2>
        <p className="text-base md:text-lg text-slate-500 dark:text-slate-400 font-semibold">
          {L.helpText}
        </p>
      </motion.div>

      {/* 🚨 Emergency */}
      <motion.button
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1 }}
        whileTap={{ scale: 0.96 }}
        onClick={handleEmergency}
        className="w-full max-w-4xl mx-auto mb-4 bg-gradient-to-r from-red-600 to-red-500 text-white rounded-2xl shadow-lg flex items-center justify-center gap-4 py-4 px-6 border-2 border-red-400/40 relative overflow-hidden cursor-pointer min-h-[72px]"
      >
        <motion.div
          animate={{ opacity: [0.05, 0.15, 0.05] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute inset-0 bg-white rounded-2xl pointer-events-none"
        />
        <span className="text-3xl md:text-4xl z-10 select-none">🚨</span>
        <span className="text-xl md:text-2xl font-extrabold z-10">{L.emergency}</span>
        <motion.div
          animate={{ scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="w-4 h-4 rounded-full bg-white ml-auto z-10"
        />
      </motion.button>

      {/* ── Main Action Grid — Large, Touch-Friendly ── */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-5 w-full max-w-4xl mx-auto"
      >
        {TILES.map(({ screen, emoji, labelKey, color, border }) => (
          <motion.button
            key={screen}
            variants={itemVariants}
            whileTap={{ scale: 0.94 }}
            id={`tile-${screen.toLowerCase()}`}
            onClick={() => {
              debugLog({ type: 'ACTION', action: 'TILE_CLICK', detail: { screen } });
              if (screen === ScreenName.REGISTRATION) {
                startRegFlow();
              } else {
                dispatchInteract({ type: 'NAVIGATE', payload: { route: screen } });
              }
            }}
            className={`relative bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl ${border} border-2 shadow-md flex flex-col items-center justify-center p-4 md:p-6 min-h-[180px] md:min-h-[220px] cursor-pointer overflow-hidden transition-all active:shadow-lg`}
            style={{ pointerEvents: 'auto' }}
          >
            {/* Icon */}
            <div className={`bg-gradient-to-br ${color} w-16 h-16 md:w-20 md:h-20 rounded-2xl flex items-center justify-center shadow-md mb-3 border border-white/30`}>
              <span className="text-4xl md:text-5xl select-none drop-shadow-md">{emoji}</span>
            </div>
            {/* 2-word label */}
            <span className="font-heading text-slate-800 dark:text-slate-100 font-bold text-lg md:text-xl text-center leading-tight">
              {(L as any)[labelKey]}
            </span>
            {/* Decorative glow */}
            <div className={`absolute -bottom-8 -right-8 w-32 h-32 rounded-full bg-gradient-to-br ${color} opacity-10 blur-2xl pointer-events-none`} />
          </motion.button>
        ))}
      </motion.div>

      {/* ── Trust Badges ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="flex flex-wrap items-center justify-center gap-3 mt-5 w-full max-w-4xl"
      >
        <span className="text-sm md:text-base font-bold text-slate-500 dark:text-slate-400 bg-white/70 dark:bg-slate-800/60 px-4 py-2 rounded-full border border-slate-200/50 dark:border-slate-700/50 shadow-sm">
          {L.safePrivate}
        </span>
        <span className="text-sm md:text-base font-bold text-slate-500 dark:text-slate-400 bg-white/70 dark:bg-slate-800/60 px-4 py-2 rounded-full border border-slate-200/50 dark:border-slate-700/50 shadow-sm">
          {L.freeService}
        </span>
        <span className="text-sm md:text-base font-bold text-slate-500 dark:text-slate-400 bg-white/70 dark:bg-slate-800/60 px-4 py-2 rounded-full border border-slate-200/50 dark:border-slate-700/50 shadow-sm">
          {L.staffHelp}
        </span>
      </motion.div>

      {/* ── Start Over Button ── */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        whileTap={{ scale: 0.95 }}
        onClick={resetKiosk}
        className="mt-4 px-6 py-3 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-base border border-slate-200 dark:border-slate-700 shadow-sm cursor-pointer min-h-[48px]"
      >
        {L.startOver}
      </motion.button>
    </div>
  );
};