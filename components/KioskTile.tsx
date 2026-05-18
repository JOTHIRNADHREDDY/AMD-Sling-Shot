import React, { useState, useCallback } from 'react';
import { motion } from 'motion/react';

interface KioskTileProps {
  title: string;
  subtitle?: string;
  icon?: string;
  emoji?: string;
  iconColor: string; // Tailwind bg class for the icon container
  onClick: () => void;
}

interface RippleItem {
  id: number;
  x: number;
  y: number;
}

let rippleId = 0;

export const KioskTile: React.FC<KioskTileProps> = ({ title, subtitle, icon, emoji, iconColor, onClick }) => {
  const [ripples, setRipples] = useState<RippleItem[]>([]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = ++rippleId;
    setRipples(prev => [...prev, { id, x, y }]);
    setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 600);
  }, []);

  return (
    <motion.button
      whileHover={{ y: -5, scale: 1.02 }}
      whileTap={{ scale: 0.96 }}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      onPointerDown={handlePointerDown}
      className="group relative bg-white/60 dark:bg-slate-800/60 backdrop-blur-lg rounded-2xl md:rounded-[2rem] border border-white/50 dark:border-slate-700/50 shadow-card hover:shadow-elevation flex flex-col items-center justify-center p-4 transition-all duration-300 w-full h-full overflow-hidden min-h-[180px] cursor-pointer hover-lift"
    >
      {/* Ripple effects */}
      {ripples.map(ripple => (
        <span
          key={ripple.id}
          className="ripple-effect"
          style={{
            left: ripple.x - 25,
            top: ripple.y - 25,
            width: 50,
            height: 50,
          }}
        />
      ))}

      {/* Icon Container - Responsive size */}
      <div className={`${iconColor} w-16 h-16 md:w-[14vh] md:h-[14vh] rounded-2xl md:rounded-[2rem] flex items-center justify-center shadow-md mb-3 md:mb-[2.5vh] z-10 transition-transform group-hover:scale-110 group-hover:rotate-3 duration-500 border border-white/20 gpu-accelerated`}>
        {emoji ? (
          <span className="text-4xl md:text-[7vh] drop-shadow-md select-none">{emoji}</span>
        ) : (
          <span className="material-symbols-outlined text-white text-3xl md:text-[6vh] font-light drop-shadow-md">
            {icon}
          </span>
        )}
      </div>

      {/* Title - Responsive size */}
      <span className="font-heading text-slate-800 dark:text-slate-100 font-bold text-base md:text-[2.8vh] tracking-tight z-10 text-center drop-shadow-sm leading-tight">
        {title}
      </span>

      {/* Subtitle */}
      {subtitle && (
        <span className="text-slate-500 dark:text-slate-400 text-xs md:text-[1.8vh] mt-1.5 z-10 text-center font-medium leading-snug">
          {subtitle}
        </span>
      )}

      {/* Decorative Glow - Responsive size */}
      <div className={`absolute -bottom-10 -right-10 w-40 h-40 md:w-[30vh] md:h-[30vh] rounded-full z-0 ${iconColor} opacity-10 group-hover:opacity-20 transition-all duration-700 blur-2xl group-hover:blur-3xl gpu-accelerated`} />

      {/* Top subtle highlight */}
      <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/40 to-transparent dark:from-white/5 rounded-t-[2rem] pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity duration-500" />
    </motion.button>
  );
};