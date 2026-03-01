import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useKiosk } from '../context/KioskContext';
import { ScreenName, PatientLookup } from '../types';
import { translations } from '../i18n';
import { lookupPatient } from '../services/api';
import { generateSpeech } from '../services/tts';

/** Map department names to room numbers */
const DEPT_ROOMS: Record<string, string> = {
  'general medicine': '102',
  'gastroenterology': '204',
  'orthopedics': '310',
  'cardiology': '415',
  'dermatology': '108',
};

export const QueueScreen: React.FC = () => {
  const { dispatchInteract, registrationResult, lookupResult, queueData, queueLoading, refreshQueue, language } = useKiosk();
  const L = translations[language];

  // If the user just registered, show their info directly (skip token entry)
  const [tokenInput, setTokenInput] = useState('');
  const [patient, setPatient] = useState<PatientLookup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-populate from registrationResult if arriving from registration flow
  useEffect(() => {
    if (registrationResult) {
      setPatient({
        registration_id: registrationResult.registration_id,
        token_number: registrationResult.token_number,
        department: registrationResult.department,
        position: registrationResult.position,
        queue_status: 'waiting',
        estimated_wait_time_mins: registrationResult.estimated_wait_time_mins,
        patient_name: registrationResult.patient_name,
        patient_age: registrationResult.patient_age,
        patient_gender: registrationResult.patient_gender,
        patient_phone: registrationResult.patient_phone,
        language: registrationResult.language,
        created_at: registrationResult.created_at,
      });
      setTokenInput(registrationResult.token_number);
    }
  }, [registrationResult]);

  // Auto-populate from lookupResult (voice command "token number D-001")
  useEffect(() => {
    if (lookupResult) {
      setPatient(lookupResult);
      setTokenInput(lookupResult.token_number);
    }
  }, [lookupResult]);

  // Refresh department queue data
  useEffect(() => { refreshQueue(); }, [refreshQueue]);

  // Auto-prompt: ask for token number when entering queue without patient data
  const hasPrompted = useRef(false);
  useEffect(() => {
    if (!registrationResult && !patient && !hasPrompted.current) {
      hasPrompted.current = true;
      // Map language codes to TTS language strings
      const langMap: Record<string, string> = { ENGLISH: 'en', TELUGU: 'te', HINDI: 'hi', TAMIL: 'ta' };
      const ttsLang = langMap[language] || 'en';
      const prompt = L.queueEnterToken || 'Please say or enter your token number.';
      generateSpeech(prompt, ttsLang).catch(() => {});
    }
  }, [registrationResult, patient, language]);

  const handleLookup = useCallback(async () => {
    const token = tokenInput.trim().toUpperCase();
    if (!token) return;
    setLoading(true);
    setError(null);
    setPatient(null);
    try {
      const data = await lookupPatient(token);
      setPatient(data);
    } catch {
      setError(`❌ ${L.queueErrorTitle}\n${L.queueErrorHint}`);
    } finally {
      setLoading(false);
    }
  }, [tokenInput]);

  // Derived values from the looked-up patient
  const dept = patient?.department || '';
  const roomNo = DEPT_ROOMS[dept.toLowerCase()] || '102';
  const deptQueue = queueData.find(q => q.department.toLowerCase() === dept.toLowerCase());
  const deptTotal = deptQueue?.total_waiting ?? 0;

  return (
    <div className="h-full w-full p-4 md:p-[3vw] flex items-start justify-center relative pt-10 md:pt-[6vh] overflow-y-auto scroll-momentum">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
        className="bg-white dark:bg-[#1E293B] w-full max-w-4xl rounded-3xl shadow-2xl flex flex-col items-center p-6 md:p-[4vh] border border-gray-100 dark:border-gray-700 transition-colors duration-300 mb-20"
      >
        {/* ── Token Input Section ── */}
        <div className="w-full max-w-lg mb-6">
          <h2 className="text-gray-700 dark:text-gray-200 text-xl md:text-2xl font-bold text-center mb-1 flex items-center justify-center gap-2">
            <span className="text-3xl select-none">🎫</span>
            {L.queueTitle}
          </h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm text-center mb-2">
            {L.queueEnterToken}
          </p>

          {/* Big example token */}
          <div className="text-center mb-4">
            <span className="text-3xl md:text-5xl font-black text-gray-200 dark:text-gray-700 tracking-widest select-none">
              {L.queueExample}
            </span>
          </div>

          <div className="flex gap-3">
            <input
              type="text"
              placeholder="C-001"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
              className="flex-1 h-16 px-4 text-3xl border-2 border-gray-200 dark:border-gray-600 rounded-xl focus:border-primary focus:outline-none bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white font-mono uppercase tracking-widest text-center"
            />
            <motion.button
              whileTap={{ scale: 0.96 }}
              transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
              onClick={handleLookup}
              disabled={loading || !tokenInput.trim()}
              className="h-16 px-8 bg-primary hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white font-bold rounded-xl transition-colors flex items-center gap-2 text-lg cursor-pointer glow-press"
            >
              {loading ? (
                <span className="material-symbols-outlined animate-spin text-xl">progress_activity</span>
              ) : (
                <span className="material-symbols-outlined text-xl">search</span>
              )}
              {L.queueCheck}
            </motion.button>
          </div>



          {/* Error - Friendly */}
          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3"
            >
              <span className="text-2xl select-none flex-shrink-0">❌</span>
              <div>
                <p className="text-base font-bold text-red-700 dark:text-red-300">{L.queueErrorTitle}</p>
                <p className="text-sm text-red-600 dark:text-red-400 mt-1 whitespace-pre-line">{L.queueErrorHint}</p>
              </div>
            </motion.div>
          )}
        </div>

        {/* ── Queue Info (shown after lookup) ── */}
        <AnimatePresence mode="wait">
          {patient && (
            <motion.div
              key={patient.token_number}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="w-full flex flex-col items-center"
            >
              {queueLoading && (
                <div className="w-full text-center text-sm text-gray-400 dark:text-gray-500 mb-2 animate-pulse">{L.queueRefreshing}</div>
              )}

              {/* Patient name */}
              <p className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-1">
                {patient.patient_name} • {patient.department}
              </p>

              <h2 className="text-gray-600 dark:text-gray-300 text-lg font-medium uppercase tracking-widest text-center">{L.queueYourToken}</h2>

              {/* Token Number Display */}
              <div className="flex items-center justify-center my-4 md:my-[2vh]">
                <div className="text-7xl md:text-[12vh] font-black text-primary dark:text-[#60A5FA] leading-none tracking-tighter drop-shadow-sm">
                  {patient.token_number}
                </div>
              </div>

              {/* Status badge */}
              <div className={`px-4 py-1.5 rounded-full text-sm font-bold mb-6 ${patient.queue_status === 'serving'
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                : patient.queue_status === 'waiting'
                  ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                }`}>
                {patient.queue_status === 'serving' ? `🟢 ${L.queueNowServing}` : patient.queue_status === 'waiting' ? `🟡 ${L.queueWaiting}` : patient.queue_status}
              </div>

              {/* Stats Grid */}
              <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-4 md:gap-[2vw] mb-6">
                <div className="bg-blue-50 dark:bg-[#334155] rounded-2xl p-4 flex flex-col items-center border border-transparent dark:border-gray-600">
                  <span className="text-gray-500 dark:text-gray-300 text-xs font-medium">{L.queuePosition}</span>
                  <span className="text-primary dark:text-blue-100 font-bold text-3xl">{patient.position}</span>
                </div>
                <div className="bg-orange-50 dark:bg-[#7C2D12] rounded-2xl p-4 flex flex-col items-center border border-transparent dark:border-orange-800">
                  <span className="text-gray-500 dark:text-orange-100/80 text-xs font-medium">{L.queuePeopleAhead}</span>
                  <span className="text-orange-600 dark:text-orange-300 font-bold text-3xl">{Math.max(patient.position - 1, 0)}</span>
                </div>
                <div className="bg-green-50 dark:bg-[#064E3B] rounded-2xl p-4 flex flex-col items-center border border-transparent dark:border-green-800">
                  <span className="text-gray-500 dark:text-green-100/80 text-xs font-medium">{L.queueEstWait}</span>
                  <span className="text-accent dark:text-green-400 font-bold text-3xl">{patient.estimated_wait_time_mins}<span className="text-lg"> min</span></span>
                </div>
                <div className="bg-purple-50 dark:bg-[#4C1D95] rounded-2xl p-4 flex flex-col items-center border border-transparent dark:border-purple-800">
                  <span className="text-gray-500 dark:text-purple-100/80 text-xs font-medium">{L.queueRoomNo}</span>
                  <span className="text-purple-700 dark:text-purple-300 font-bold text-3xl">{roomNo}</span>
                </div>
              </div>

              {/* Department queue summary */}
              {deptQueue && (
                <div className="w-full bg-gray-50 dark:bg-gray-800 rounded-2xl p-4 mb-6 border border-gray-100 dark:border-gray-700">
                  <p className="text-gray-500 dark:text-gray-400 text-xs font-bold uppercase tracking-wider mb-2">{dept} — {L.queueDeptQueue}</p>
                  <div className="flex justify-around text-center">
                    <div>
                      <p className="text-2xl font-bold text-gray-800 dark:text-gray-200">{deptQueue.current_serving || '—'}</p>
                      <p className="text-xs text-gray-400">{L.queueNowServing}</p>
                    </div>
                    <div className="border-l border-gray-200 dark:border-gray-600" />
                    <div>
                      <p className="text-2xl font-bold text-gray-800 dark:text-gray-200">{deptTotal}</p>
                      <p className="text-xs text-gray-400">{L.queueWaiting}</p>
                    </div>
                    <div className="border-l border-gray-200 dark:border-gray-600" />
                    <div>
                      <p className="text-2xl font-bold text-gray-800 dark:text-gray-200">{deptQueue.estimated_wait_time_mins} min</p>
                      <p className="text-xs text-gray-400">{L.queueAvgWait}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="w-full flex flex-col sm:flex-row gap-4 md:gap-[2vw]">
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                  onClick={() => { setPatient(null); setTokenInput(''); setError(null); }}
                  className="flex-1 h-14 rounded-2xl border-2 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-bold text-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined">search</span>
                  {L.queueCheckAnother}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => dispatchInteract({ type: 'NAVIGATE', payload: { route: ScreenName.HOME } })}
                  className="flex-1 h-14 rounded-2xl bg-primary hover:bg-blue-700 dark:bg-[#2563EB] dark:hover:bg-blue-600 text-white font-bold text-lg shadow-lg shadow-blue-200 dark:shadow-none transition-colors flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined">home</span>
                  {L.queueDone}
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Placeholder when no patient looked up yet */}
        {!patient && !loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center py-8 text-center"
          >
            <span className="text-[10vh] mb-4 select-none">🎫</span>
            <p className="text-gray-400 dark:text-gray-500 text-lg">{L.queuePlaceholder}</p>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
};