import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { VoiceState, Language } from '../types';
import { translations } from '../i18n';

interface VoiceOrbProps {
  state: VoiceState;
  onClick: () => void;
  size?: 'small' | 'large';
  language?: Language;
}

// Ripple element spawned on tap
interface RippleItem {
  id: number;
  x: number;
  y: number;
}

let rippleIdCounter = 0;

export const VoiceOrb: React.FC<VoiceOrbProps> = ({ state, onClick, size = 'large', language = Language.ENGLISH }) => {
  const L = translations[language];
  const sizeClasses = size === 'large' ? 'w-[15vh] h-[15vh] min-w-[80px] min-h-[80px]' : 'w-[7vh] h-[7vh] min-w-[40px] min-h-[40px]';
  const iconSize = size === 'large' ? 'text-[6vh] md:text-[7.5vh]' : 'text-[3.5vh]';

  const [ripples, setRipples] = useState<RippleItem[]>([]);
  const [hasInteracted, setHasInteracted] = useState(false);

  // Spawn a ripple ring on pointer down for instant feedback
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = ++rippleIdCounter;
    setRipples(prev => [...prev, { id, x, y }]);
    // Auto-clean after animation
    setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 700);
  }, []);

  // Define premium state colors and animations
  const getStateStyles = () => {
    switch (state) {
      case VoiceState.LISTENING:
        return {
          bgColor: 'bg-gradient-to-tr from-rose-500 to-red-400 dark:from-rose-600 dark:to-red-500',
          shadow: 'shadow-[0_0_30px_rgba(244,63,94,0.6)]',
          icon: 'mic',
          animation: { scale: [1, 1.1, 1], transition: { repeat: Infinity, duration: 1.5, ease: "easeInOut" } }
        };
      case VoiceState.PROCESSING:
        return {
          bgColor: 'bg-gradient-to-tr from-amber-400 to-orange-400 dark:from-amber-600 dark:to-orange-500',
          shadow: 'shadow-[0_0_30px_rgba(251,191,36,0.5)]',
          icon: 'hourglass_empty',
          animation: { rotate: 360, transition: { repeat: Infinity, duration: 2, ease: "linear" } }
        };
      case VoiceState.SPEAKING:
        return {
          bgColor: 'bg-gradient-to-tr from-emerald-400 to-teal-500 dark:from-emerald-600 dark:to-teal-600',
          shadow: 'shadow-[0_0_30px_rgba(52,211,153,0.5)]',
          icon: 'graphic_eq',
          animation: { scale: [1, 1.05, 1], opacity: [0.8, 1, 0.8], transition: { repeat: Infinity, duration: 1, ease: "easeInOut" } }
        };
      case VoiceState.ERROR:
        return {
          bgColor: 'bg-gradient-to-tr from-red-600 to-red-800 dark:from-red-700 dark:to-red-900',
          shadow: 'shadow-[0_0_20px_rgba(220,38,38,0.5)]',
          icon: 'error_outline',
          animation: { x: [-5, 5, -5, 5, 0], transition: { duration: 0.4 } }
        };
      case VoiceState.IDLE:
      default:
        return {
          bgColor: 'bg-gradient-to-tr from-primary to-blue-400 dark:from-blue-700 dark:to-blue-500',
          shadow: '',
          icon: 'mic_none',
          animation: {} // Idle pulse handled by CSS class
        };
    }
  };

  const currentStyle = getStateStyles();
  const isIdle = state === VoiceState.IDLE;
  const isListening = state === VoiceState.LISTENING;

  return (
    <div className="relative flex flex-col items-center justify-center gap-2">
      {/* Outer Glow / Ripple for Listening/Speaking state */}
      <AnimatePresence>
        {(state === VoiceState.LISTENING || state === VoiceState.SPEAKING) && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 0.4, scale: 1.5 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeOut" }}
            className={`absolute rounded-full ${sizeClasses} ${currentStyle.bgColor} blur-xl gpu-accelerated`}
          />
        )}
      </AnimatePresence>

      {/* Main Orb Button */}
      <motion.button
        onClick={() => {
          setHasInteracted(true);
          onClick();
        }}
        onPointerDown={handlePointerDown}
        animate={isIdle ? {} : currentStyle.animation}
        whileHover={isIdle ? { scale: 1.05 } : {}}
        whileTap={{ scale: 0.92 }}
        transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
        className={`${sizeClasses} ${currentStyle.bgColor} ${currentStyle.shadow} rounded-full flex items-center justify-center text-white transition-colors duration-500 relative z-50 overflow-hidden border border-white/20 ${isIdle ? 'alive-pulse' : ''} gpu-accelerated`}
        aria-label="Voice Assistant"
      >
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-white/10 opacity-0 hover:opacity-100 transition-opacity duration-300"></div>

        {/* Tap ripple rings */}
        {ripples.map(ripple => (
          <span
            key={ripple.id}
            className="ripple-ring absolute rounded-full border-2 border-white/50"
            style={{
              left: ripple.x - 20,
              top: ripple.y - 20,
              width: 40,
              height: 40,
            }}
          />
        ))}

        {/* Icon with animated swap */}
        <AnimatePresence mode="wait">
          <motion.span
            key={currentStyle.icon}
            initial={{ opacity: 0, scale: 0.5, rotate: -90 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.5, rotate: 90 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            className={`material-symbols-outlined ${iconSize} font-light drop-shadow-md`}
          >
            {currentStyle.icon}
          </motion.span>
        </AnimatePresence>
      </motion.button>


      {/* Waveform bars for listening state */}
      <AnimatePresence>
        {isListening && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2 }}
            className="flex items-end justify-center gap-0.5 h-5 text-red-400 dark:text-red-300"
          >
            <span className="waveform-bar" />
            <span className="waveform-bar" />
            <span className="waveform-bar" />
            <span className="waveform-bar" />
            <span className="waveform-bar" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* State label */}
      <motion.span
        key={state}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className={`text-xs md:text-sm font-bold whitespace-nowrap select-none ${state === VoiceState.LISTENING ? 'text-red-500 dark:text-red-400' :
          state === VoiceState.PROCESSING ? 'text-amber-500 dark:text-amber-400' :
            state === VoiceState.SPEAKING ? 'text-emerald-500 dark:text-emerald-400' :
              'text-gray-500 dark:text-gray-400'
          }`}
      >
        {state === VoiceState.LISTENING ? L.speakNow :
          state === VoiceState.PROCESSING ? '...' :
            state === VoiceState.SPEAKING ? '🔊' :
              L.tapAndSpeak}
      </motion.span>
    </div>
  );
};