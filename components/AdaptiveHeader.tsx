import React from 'react';
import { motion } from 'motion/react';
import { useKiosk } from '../context/KioskContext';
import { ScreenName, Language } from '../types';

const nativeLanguage: Record<Language, string> = {
  [Language.TELUGU]: 'తెలుగు',
  [Language.HINDI]: 'हिंदी',
  [Language.ENGLISH]: 'English',
  [Language.TAMIL]: 'தமிழ்',
  [Language.TELUGU_EN]: 'Telugu (EN)',
  [Language.HINDI_EN]: 'Hindi (EN)',
};

const tapTransition = { duration: 0.15, ease: [0.22, 1, 0.36, 1] as const };

export const AdaptiveHeader: React.FC = () => {
  const { currentScreen, language, dispatchInteract, resetKiosk, isDarkMode, toggleDarkMode, toggleHelp } = useKiosk();

  return (
    <header className="flex flex-row items-center justify-between px-4 md:px-6 py-4 bg-white shadow-sm border-b border-gray-200 z-50 relative">
      {/* Left: Back + Title */}
      <div className="flex items-center gap-4">
        {/* Back / Home Button */}
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={resetKiosk}
          className="w-12 h-12 flex items-center justify-center rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
          aria-label="Home"
        >
          <span className="material-symbols-outlined text-3xl font-bold">
            {currentScreen !== ScreenName.HOME ? 'arrow_back' : 'home'}
          </span>
        </motion.button>

        {/* Hospital Name */}
        <h1 className="text-xl md:text-3xl font-black text-gray-800 tracking-tight">
          🏥 <span className="text-blue-600">Medi</span>Kiosk
        </h1>
      </div>

      {/* Right: Language */}
      <div className="flex items-center">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => dispatchInteract({ type: 'NAVIGATE', payload: { route: ScreenName.LANGUAGE } })}
          className="bg-blue-600 text-white px-5 py-2.5 rounded-full flex items-center gap-2 shadow-md hover:bg-blue-700 transition-colors font-bold"
        >
          <span className="material-symbols-outlined">language</span>
          <span className="text-base md:text-lg">{nativeLanguage[language]}</span>
        </motion.button>
      </div>
    </header>
  );
};