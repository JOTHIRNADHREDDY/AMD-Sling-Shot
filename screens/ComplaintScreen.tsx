import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useKiosk } from '../context/KioskContext';
import { ScreenName, VoiceState } from '../types';
import { translations } from '../i18n';

type CategoryId = 'WAITING' | 'STAFF' | 'MEDICINE' | 'CLEANLINESS' | 'BILLING' | 'EMERGENCY';
type UrgencyLevel = 'NORMAL' | 'URGENT' | 'EMERGENCY';

export const ComplaintScreen: React.FC = () => {
  const { dispatchInteract, voiceState, transcript, toggleVoice, language } = useKiosk();
  const L = translations[language];

  const CATEGORIES: { id: CategoryId; label: string; emoji: string; keywords: string[] }[] = [
    { id: 'WAITING', label: L.complaintLongWait, emoji: '🕒', keywords: ['wait', 'waiting', 'long', 'slow', 'delay', 'time'] },
    { id: 'STAFF', label: L.complaintStaff, emoji: '👩‍⚕️', keywords: ['staff', 'doctor', 'nurse', 'rude', 'behavior', 'behaviour', 'attitude'] },
    { id: 'MEDICINE', label: L.complaintMedicine, emoji: '💊', keywords: ['medicine', 'drug', 'tablet', 'pill', 'pharmacy', 'prescription'] },
    { id: 'CLEANLINESS', label: L.complaintClean, emoji: '🧼', keywords: ['clean', 'dirty', 'hygiene', 'toilet', 'washroom', 'smell', 'cleanliness'] },
    { id: 'BILLING', label: L.complaintBilling, emoji: '💰', keywords: ['bill', 'billing', 'charge', 'money', 'payment', 'fee', 'cost', 'expensive'] },
    { id: 'EMERGENCY', label: L.complaintEmergency, emoji: '🚨', keywords: ['emergency', 'urgent', 'critical', 'serious', 'danger'] },
  ];

  const [step, setStep] = useState<'CATEGORY' | 'VOICE' | 'PRIORITY' | 'SUCCESS'>('CATEGORY');
  const [selectedCategory, setSelectedCategory] = useState<CategoryId | null>(null);
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState<UrgencyLevel>('NORMAL');
  const [complaintId, setComplaintId] = useState('');

  // Idle timeout
  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout>;
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => dispatchInteract({ type: 'NAVIGATE', payload: { route: ScreenName.HOME } }), 60000);
    };
    window.addEventListener('touchstart', resetIdleTimer);
    window.addEventListener('click', resetIdleTimer);
    resetIdleTimer();
    return () => {
      clearTimeout(idleTimer);
      window.removeEventListener('touchstart', resetIdleTimer);
      window.removeEventListener('click', resetIdleTimer);
    };
  }, [dispatchInteract]);

  // Voice transcript → auto-select category or fill description
  useEffect(() => {
    if (voiceState === VoiceState.PROCESSING && transcript) {
      const lower = transcript.toLowerCase();

      if (step === 'CATEGORY') {
        // Auto-select category based on keywords in voice input
        for (const cat of CATEGORIES) {
          if (cat.keywords.some(kw => lower.includes(kw))) {
            setSelectedCategory(cat.id);
            setDescription(transcript); // pre-fill description with what user said
            setStep('VOICE');
            return;
          }
        }
      } else if (step === 'VOICE') {
        setDescription(prev => prev + (prev ? ' ' : '') + transcript);
      }
    }
  }, [transcript, voiceState, step]);

  // Auto close on success
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (step === 'SUCCESS') {
      timer = setTimeout(() => dispatchInteract({ type: 'NAVIGATE', payload: { route: ScreenName.HOME } }), 10000);
    }
    return () => clearTimeout(timer);
  }, [step, dispatchInteract]);

  const handleCategorySelect = (cat: CategoryId) => {
    setSelectedCategory(cat);
    setStep('VOICE');
  };

  const handleSubmit = () => {
    const newId = `CMP-${Math.floor(1000 + Math.random() * 9000)}`;
    setComplaintId(newId);
    setStep('SUCCESS');
  };

  // ── Step 1: Category Selection ──────────────────────────────────────────
  const renderCategory = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center p-4 md:p-8 pb-24"
    >
      <h2 className="text-2xl md:text-4xl font-bold text-gray-800 dark:text-white mb-2 text-center">
        {L.complaintTitle}
      </h2>
      <p className="text-gray-500 dark:text-gray-400 mb-6 md:mb-10 text-center">
        {L.complaintSelectIssue}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6 w-full max-w-3xl">
        {CATEGORIES.map((cat, idx) => (
          <motion.button
            key={cat.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.08 }}
            whileHover={{ scale: 1.04, y: -3 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => handleCategorySelect(cat.id)}
            className="bg-white dark:bg-gray-800 border-2 border-gray-100 dark:border-gray-700 rounded-2xl p-5 md:p-8 flex flex-col items-center justify-center gap-2 md:gap-3 shadow-sm hover:shadow-lg hover:border-primary dark:hover:border-blue-500 transition-all min-h-[120px] md:min-h-[160px] cursor-pointer glow-press"
          >
            <span className="text-4xl md:text-6xl select-none">{cat.emoji}</span>
            <span className="text-sm md:text-base font-bold text-gray-700 dark:text-gray-200 text-center leading-tight">
              {cat.label}
            </span>
          </motion.button>
        ))}
      </div>

      {/* Trust */}
      <div className="flex flex-wrap gap-3 mt-8 justify-center">
        {[L.freeService, L.goBackAnytime, L.staffHelp].map((text, i) => (
          <span key={i} className="text-xs md:text-sm font-semibold text-slate-500 dark:text-slate-400 bg-white/60 dark:bg-slate-800/60 px-3 py-1.5 rounded-full border border-slate-200/50 dark:border-slate-700/50">
            {text}
          </span>
        ))}
      </div>
    </motion.div>
  );

  // ── Step 2: Voice + Priority ─────────────────────────────────────────────
  const renderVoice = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center p-4 md:p-8 pb-24 w-full max-w-2xl mx-auto"
    >
      {/* Back to categories */}
      <button
        onClick={() => { setStep('CATEGORY'); setDescription(''); }}
        className="self-start mb-4 flex items-center gap-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium cursor-pointer tap-bounce min-h-[48px]"
      >
        <span className="material-symbols-outlined text-xl">arrow_back</span>
        {selectedCategory && CATEGORIES.find(c => c.id === selectedCategory)?.emoji} {selectedCategory && CATEGORIES.find(c => c.id === selectedCategory)?.label}
      </button>

      <h2 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white mb-2 text-center">
        {L.complaintSpeakIssue}
      </h2>
      <p className="text-gray-500 dark:text-gray-400 mb-8 text-center">
        {L.complaintTapMic}
      </p>

      {/* Voice indicator — use the floating mic at the bottom */}
      <div className="flex flex-col items-center mb-6">
        <span className="material-symbols-outlined text-5xl md:text-7xl text-primary/60 dark:text-blue-400/60 mb-2">mic</span>
        <p className="text-lg font-bold text-gray-600 dark:text-gray-300">
          {voiceState === VoiceState.LISTENING ? L.complaintListening : L.complaintTapMic}
        </p>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">⬇ {L.tapAndSpeak}</p>
      </div>

      {/* Transcribed text area */}
      <div className="w-full bg-gray-50 dark:bg-gray-800 rounded-2xl border-2 border-gray-200 dark:border-gray-700 p-4 md:p-6 min-h-[120px] mb-6">
        {description ? (
          <p className="text-lg text-gray-800 dark:text-white font-medium leading-relaxed">{description}</p>
        ) : (
          <p className="text-gray-400 dark:text-gray-500 italic text-center">{L.complaintYourWords}</p>
        )}
      </div>

      {/* Priority - Color coded */}
      <div className="w-full mb-6">
        <p className="text-sm font-bold text-gray-500 dark:text-gray-400 mb-3 text-center uppercase tracking-wider">
          {L.complaintPriority}
        </p>
        <div className="flex gap-3">
          {([
            { level: 'NORMAL' as UrgencyLevel, label: L.complaintNormal, color: 'from-green-400 to-emerald-500', ring: 'ring-green-300', emoji: '🟢' },
            { level: 'URGENT' as UrgencyLevel, label: L.complaintUrgent, color: 'from-orange-400 to-amber-500', ring: 'ring-orange-300', emoji: '🟠' },
            { level: 'EMERGENCY' as UrgencyLevel, label: L.complaintEmergencyLevel, color: 'from-red-500 to-rose-600', ring: 'ring-red-300', emoji: '🔴' },
          ]).map(({ level, label, color, ring, emoji }) => (
            <motion.button
              key={level}
              whileTap={{ scale: 0.96 }}
              transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
              onClick={() => setUrgency(level)}
              className={`flex-1 py-4 rounded-2xl font-bold text-base md:text-lg transition-all flex flex-col items-center gap-1 ${urgency === level
                ? `bg-gradient-to-br ${color} text-white shadow-lg ${ring} ring-4 ring-offset-2 ring-offset-white dark:ring-offset-gray-900`
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700'
                }`}
            >
              <span className="text-2xl select-none">{emoji}</span>
              <span>{label}</span>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Submit */}
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={handleSubmit}
        disabled={!description}
        className={`w-full h-16 rounded-2xl font-bold text-xl shadow-lg transition-all flex items-center justify-center gap-3 ${!description
          ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
          : 'bg-primary hover:bg-blue-700 text-white active:scale-95'
          }`}
      >
        {L.complaintSubmit}
        <span className="text-2xl select-none">📨</span>
      </motion.button>
    </motion.div>
  );

  // ── Success ──────────────────────────────────────────────────────────────
  const renderSuccess = () => (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex-1 flex flex-col items-center justify-center p-8 text-center"
    >
      <motion.div
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 1.5, repeat: Infinity }}
        className="text-[12vh] mb-6 select-none"
      >
        ✅
      </motion.div>

      <h2 className="text-3xl md:text-5xl font-bold text-gray-900 dark:text-white mb-3">{L.complaintSuccess}</h2>
      <p className="text-lg md:text-xl text-gray-500 dark:text-gray-400 mb-8 max-w-md">
        {L.complaintSuccessMsg}
      </p>

      <div className="bg-white dark:bg-gray-800 px-10 py-6 rounded-3xl border-2 border-dashed border-gray-300 dark:border-gray-600 mb-8 shadow-sm">
        <span className="block text-sm text-gray-500 uppercase tracking-widest mb-2 font-bold">{L.complaintId}</span>
        <span className="block text-6xl font-black text-primary dark:text-blue-400 tracking-tighter leading-none">{complaintId}</span>
      </div>

      <div className="flex gap-4 w-full max-w-lg">
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={() => dispatchInteract({ type: 'NAVIGATE', payload: { route: ScreenName.HOME } })}
          className="flex-1 py-4 bg-primary text-white text-lg font-bold rounded-2xl shadow-lg hover:bg-blue-700 transition-colors"
        >
          {L.complaintDone}
        </motion.button>
        <button className="flex-1 py-4 bg-white dark:bg-gray-700 text-gray-800 dark:text-white border-2 border-gray-200 dark:border-gray-600 text-lg font-bold rounded-2xl shadow-sm flex items-center justify-center gap-2">
          🖨️ {L.complaintPrint}
        </button>
      </div>
    </motion.div>
  );

  return (
    <div className="h-full w-full bg-[#F8FDFF] dark:bg-gray-900 flex flex-col relative pt-4 overflow-y-auto scroll-momentum">
      <AnimatePresence mode="wait">
        {step === 'CATEGORY' && <motion.div key="cat" exit={{ opacity: 0 }}>{renderCategory()}</motion.div>}
        {step === 'VOICE' && <motion.div key="voice" exit={{ opacity: 0 }}>{renderVoice()}</motion.div>}
        {step === 'SUCCESS' && <motion.div key="success" exit={{ opacity: 0 }}>{renderSuccess()}</motion.div>}
      </AnimatePresence>
    </div>
  );
};