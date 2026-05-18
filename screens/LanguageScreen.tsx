import React from 'react';
import { motion } from 'motion/react';
import { useKiosk } from '../context/KioskContext';
import { Language, ScreenName } from '../types';

const LANGUAGES = [
  { lang: Language.TELUGU, native: 'తెలుగు', label: 'Telugu', color: 'from-green-500 to-emerald-600', ring: 'ring-green-400/60', emoji: '🟢' },
  { lang: Language.ENGLISH, native: 'English', label: 'English', color: 'from-blue-500 to-indigo-600', ring: 'ring-blue-400/60', emoji: '🔵' },
  { lang: Language.HINDI, native: 'हिंदी', label: 'Hindi', color: 'from-amber-400 to-yellow-500', ring: 'ring-amber-400/60', emoji: '🟡' },
  { lang: Language.TAMIL, native: 'தமிழ்', label: 'Tamil', color: 'from-purple-500 to-violet-600', ring: 'ring-purple-400/60', emoji: '🟣' },
  { lang: Language.TELUGU_EN, native: 'Telugu (EN)', label: 'Telugu (English)', color: 'from-teal-500 to-cyan-600', ring: 'ring-teal-400/60', emoji: '🟩' },
  { lang: Language.HINDI_EN, native: 'Hindi (EN)', label: 'Hindi (English)', color: 'from-orange-400 to-red-500', ring: 'ring-orange-400/60', emoji: '🟧' },
] as const;

export const LanguageScreen: React.FC = () => {
  const { setLanguage, dispatchInteract } = useKiosk();

  const handleSelect = (lang: Language) => {
    setLanguage(lang);
    dispatchInteract({ type: 'NAVIGATE', payload: { route: ScreenName.HOME } });
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen w-full p-6 md:p-12">
      {/* Title */}
      <motion.div
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
        className="text-center mb-10 md:mb-14"
      >
        <h1 className="text-4xl md:text-6xl font-bold text-slate-800 dark:text-white mb-4 drop-shadow-sm">
          🏥 Select Your Language
        </h1>
        <p className="text-lg md:text-2xl text-slate-500 dark:text-slate-400 font-medium">
          భాష ఎంచుకోండి &bull; भाषा चुनें &bull; Choose Language
        </p>
      </motion.div>

      {/* Language Buttons - Full Width, Big */}
      <div className="flex flex-col gap-5 md:gap-7 w-full max-w-2xl">
        {LANGUAGES.map(({ lang, native, label, color, ring, emoji }, idx) => (
          <motion.button
            key={lang}
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 + idx * 0.1, type: 'spring', stiffness: 280, damping: 22 }}
            whileHover={{ scale: 1.04, y: -3 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => handleSelect(lang)}
            className={`relative w-full bg-gradient-to-r ${color} text-white rounded-2xl md:rounded-3xl shadow-lg hover:shadow-2xl transition-all duration-300 flex items-center gap-5 md:gap-8 py-6 md:py-10 px-8 md:px-12 ring-4 ${ring} ring-offset-2 ring-offset-slate-50 dark:ring-offset-slate-950 overflow-hidden cursor-pointer glow-press`}
          >
            {/* Shine overlay */}
            <div className="absolute inset-0 bg-gradient-to-r from-white/20 via-transparent to-transparent opacity-60 pointer-events-none" />
            <span className="text-4xl md:text-6xl z-10 drop-shadow-md">{emoji}</span>
            <div className="flex flex-col items-start z-10">
              <span className="text-3xl md:text-5xl font-extrabold tracking-tight drop-shadow-md leading-tight">{native}</span>
              <span className="text-base md:text-xl opacity-85 font-semibold mt-0.5">{label}</span>
            </div>
            {/* Arrow */}
            <span className="ml-auto text-3xl md:text-5xl opacity-60 z-10 font-light">→</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
};