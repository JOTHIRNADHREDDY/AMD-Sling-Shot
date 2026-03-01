import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { KioskProvider, useKiosk } from './context/KioskContext';
import { ScreenName } from './types';
import { AdaptiveHeader } from './components/AdaptiveHeader';
import { VoiceOrb } from './components/VoiceOrb';
import { HomeScreen } from './screens/HomeScreen';
import { RegistrationScreen } from './screens/RegistrationScreen';
import { QueueScreen } from './screens/QueueScreen';
import { LanguageScreen } from './screens/LanguageScreen';
import { LabTestsScreen } from './screens/LabTestsScreen';
import { ComplaintScreen } from './screens/ComplaintScreen';
import { ReceiptScreen } from './screens/ReceiptScreen';
import { NavigationScreen } from './screens/NavigationScreen';
import { HelpModal } from './components/HelpModal';
import { ProcessingIndicator } from './components/ProcessingIndicator';
import { VoiceLogPanel } from './components/VoiceLogPanel';
import { VoiceDebugOverlay } from './components/VoiceDebugOverlay';
import { translations } from './i18n';

// ── Initialize Debug Mode ────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  (window as any).APP_DEBUG = (window as any).APP_DEBUG ?? false;
  (window as any).APP_BRAIN_LOG = (window as any).APP_BRAIN_LOG ?? [];
}

// ── Screen transition variants ────────────────────────────────────────────────
const screenTransition = {
  initial: { opacity: 0, y: 16, scale: 0.99 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -10, scale: 0.99 },
  transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
};
const screenExitTransition = { duration: 0.2, ease: [0.4, 0, 1, 1] };

// ── Screen resolver (pure, no hooks) ──────────────────────────────────────────
const SCREEN_MAP: Record<ScreenName, React.FC> = {
  [ScreenName.HOME]: HomeScreen,
  [ScreenName.REGISTRATION]: RegistrationScreen,
  [ScreenName.QUEUE]: QueueScreen,
  [ScreenName.LANGUAGE]: LanguageScreen,
  [ScreenName.LAB_TESTS]: LabTestsScreen,
  [ScreenName.NAVIGATION]: NavigationScreen,
  [ScreenName.COMPLAINT]: ComplaintScreen,
  [ScreenName.RECEIPT]: ReceiptScreen,
};

const MainContent: React.FC = () => {
  const { currentScreen, voiceState, toggleVoice, error, dismissError, hasSelectedLanguage, language, navigate, isLocked } = useKiosk();
  const [isLogPanelOpen, setIsLogPanelOpen] = useState(false);

  const ScreenComponent = useMemo(() => SCREEN_MAP[currentScreen] ?? HomeScreen, [currentScreen]);

  // ── Full-screen language gate ───────────────────────────────────────────────
  if (!hasSelectedLanguage) {
    return (
      <div className="min-h-screen w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 relative font-sans overflow-x-hidden flex items-center justify-center">
        <LanguageScreen />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen w-full bg-slate-50 dark:bg-slate-950 relative transition-colors duration-500 font-sans overflow-x-hidden">
      {/* Subtle background gradient */}
      <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden>
        <div className="absolute top-0 -left-1/4 w-[150%] h-[150%] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-100/50 via-white to-transparent dark:from-blue-900/20 dark:via-slate-950 dark:to-slate-950 opacity-70" />
      </div>

      {/* Header */}
      <div className="flex-none z-20 sticky top-0">
        <AdaptiveHeader />
      </div>

      {/* Main screen area — ensure pointer-events always work */}
      <main className="flex-1 relative z-10 flex flex-col w-full pb-24 md:pb-32" data-screen-content>
        <AnimatePresence mode="wait">
          <motion.div
            key={currentScreen}
            initial={screenTransition.initial}
            animate={screenTransition.animate}
            exit={{ ...screenTransition.exit, transition: screenExitTransition }}
            transition={screenTransition.transition}
            className="h-full w-full will-change-transform gpu-accelerated"
            style={{ pointerEvents: 'auto' }}
            onAnimationComplete={() => {
              // Ensure no stale overlays after screen transition
              if ((window as any).APP_DEBUG) {
                console.log('[App] Screen transition complete:', currentScreen);
              }
            }}
          >
            <ScreenComponent />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Floating Voice Orb */}
      <div className="fixed left-0 right-0 flex justify-center items-center z-50 pointer-events-none bottom-6 md:bottom-8">
        <div className="pointer-events-auto relative flex items-center justify-center">
          <ProcessingIndicator />
          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.92 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-[1.5vh] rounded-full shadow-elevation dark:shadow-glow ring-1 ring-white/50 dark:ring-white/10 gpu-accelerated"
          >
            <VoiceOrb state={voiceState} onClick={toggleVoice} size="large" language={language} />
          </motion.div>
        </div>
      </div>

      {/* Global Interaction Lock Overlay — only during brief transitions (400ms max) */}
      <AnimatePresence>
        {isLocked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="fixed inset-0 z-lock"
            style={{ pointerEvents: 'all' }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if ((window as any).APP_DEBUG) {
                console.log('[App Brain] Swallow touch: System is locked/transitioning');
              }
            }}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* Friendly Error Display — no technical text */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed top-24 left-1/2 -translate-x-1/2 z-[60] w-[90vw] max-w-md"
            role="alert"
          >
            <div className="bg-white/95 backdrop-blur-lg dark:bg-slate-900/95 rounded-2xl shadow-xl p-5 border border-slate-200/50 dark:border-slate-700/50">
              {/* Friendly message */}
              <div className="flex items-center gap-4 mb-4">
                <motion.div
                  animate={{ scale: [1, 1.15, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0"
                >
                  <span className="text-3xl">😕</span>
                </motion.div>
                <div className="flex-1">
                  <p className="text-base font-bold text-slate-700 dark:text-slate-200">
                    {translations[language]?.voiceError || 'Something went wrong'}
                  </p>
                </div>
                <button
                  onClick={dismissError}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full"
                >
                  <span className="material-symbols-outlined text-lg text-slate-400">close</span>
                </button>
              </div>

              {/* 3 Big Fallback Action Buttons */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { screen: ScreenName.HOME, emoji: '🏠', label: translations[language]?.startOver || 'Home' },
                  { screen: ScreenName.REGISTRATION, emoji: '👨‍⚕️', label: translations[language]?.opReg || 'Register' },
                  { screen: ScreenName.QUEUE, emoji: '🎫', label: translations[language]?.queue || 'Queue' },
                ].map(({ screen, emoji, label }) => (
                  <motion.button
                    key={screen}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => { dismissError(); navigate(screen); }}
                    className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-3 px-2 flex flex-col items-center gap-1 cursor-pointer min-h-[72px]"
                  >
                    <span className="text-2xl">{emoji}</span>
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300 text-center leading-tight">{label}</span>
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Help Modal */}
      <HelpModal />

      {/* Voice Log Panel Toggle Button */}
      <button
        onClick={() => setIsLogPanelOpen(true)}
        className="fixed bottom-6 md:bottom-8 right-4 z-50 bg-white/80 dark:bg-slate-800/80 backdrop-blur-lg shadow-lg rounded-full p-2.5 ring-1 ring-slate-200/50 dark:ring-slate-700/50 hover:bg-white dark:hover:bg-slate-700 transition-colors group"
        title="Voice Logs"
      >
        <span className="material-symbols-outlined text-lg text-slate-500 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">graphic_eq</span>
      </button>

      {/* Voice Log Panel */}
      <VoiceLogPanel isOpen={isLogPanelOpen} onClose={() => setIsLogPanelOpen(false)} />

      {/* Voice Debug Overlay (Section 10 — Debug Mode) */}
      <VoiceDebugOverlay />
    </div>
  );
};

const App: React.FC = () => (
  <KioskProvider>
    <MainContent />
  </KioskProvider>
);

export default App;