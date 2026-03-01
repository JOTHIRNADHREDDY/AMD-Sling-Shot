import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useKiosk } from '../context/KioskContext';
import { ScreenName, VoiceState } from '../types';
import { translations } from '../i18n';
import { isFieldFilled, type RegistrationStep } from '../services/RegistrationFlow';
import { debugLog } from '../services/AppBrain';

const DEPT_MAP: { id: string; emoji: string; key: string }[] = [
  { id: 'General Medicine', emoji: '🤒', key: 'regFever' },
  { id: 'Cardiology', emoji: '🫀', key: 'regHeart' },
  { id: 'Orthopedics', emoji: '🦴', key: 'regBones' },
  { id: 'Pediatrics', emoji: '👶', key: 'regChild' },
  { id: 'Gynecology', emoji: '👩', key: 'regWomen' },
  { id: 'Ophthalmology', emoji: '👁', key: 'regEye' },
  { id: 'Dermatology', emoji: '🩹', key: 'regSkin' },
  { id: 'ENT', emoji: '👂', key: 'regGeneral' },
];

type WizardStep = 'TYPE' | 'MOBILE' | 'NAME' | 'DEPARTMENT' | 'RETURNING';

/** Maps our RegistrationFlow step ↔ WizardStep */
function flowStepToWizard(step: RegistrationStep): WizardStep {
  switch (step) {
    case 'IDLE': return 'TYPE';
    case 'MOBILE': return 'MOBILE';
    case 'NAME':
    case 'AGE':
    case 'GENDER':
      return 'NAME'; // NAME, AGE, GENDER share the same wizard panel
    case 'DEPARTMENT':
    case 'CONFIRM':
    case 'SUBMITTED':
      return 'DEPARTMENT';
    default: return 'TYPE';
  }
}

export const RegistrationScreen: React.FC = () => {
  const {
    patientDetails,
    updatePatientDetails,
    submitRegistration,
    registrationLoading,
    scanToken,
    lookupResult,
    lookupLoading,
    dispatchInteract,
    voiceState,
    transcript,
    toggleVoice,
    language,
    // Registration Flow State Machine
    regFlow,
    updateRegFlow,
    startRegFlow,
    resetRegFlow,
    setRegStep,
    // Token confirmation
    pendingTokenConfirm,
    confirmToken,
    rejectToken,
  } = useKiosk();

  const L = translations[language];

  const [step, setStep] = useState<WizardStep>('TYPE');
  const [mobile, setMobile] = useState('');
  const [existingToken, setExistingToken] = useState('');

  // ── Sync wizard step from Registration Flow State Machine ─────────
  useEffect(() => {
    if (regFlow.step !== 'IDLE') {
      const wizardStep = flowStepToWizard(regFlow.step);
      if (wizardStep !== step) {
        debugLog({ type: 'NAVIGATION', action: 'REG_WIZARD_SYNC', detail: { flowStep: regFlow.step, wizardStep } });
        setStep(wizardStep);
      }
    }
  }, [regFlow.step]);

  // Voice transcript → fill current field (only if not already filled)
  useEffect(() => {
    if (voiceState === VoiceState.PROCESSING && transcript) {
      // Only fill the field for the CURRENT flow step
      if (regFlow.step === 'NAME' && !isFieldFilled(regFlow, 'name')) {
        updateRegFlow('name', transcript);
      } else if (regFlow.step === 'AGE' && !isFieldFilled(regFlow, 'age')) {
        const ageMatch = transcript.match(/\d{1,3}/);
        if (ageMatch) updateRegFlow('age', ageMatch[0]);
      }
    }
  }, [transcript, voiceState]);

  // Auto-advance wizard when voice/LLM fills form fields via BATCH_FORM_FILL
  useEffect(() => {
    const { name, age, department, phone } = patientDetails;

    if (step === 'TYPE' && name) {
      if (department) {
        setStep('DEPARTMENT');
        setRegStep('DEPARTMENT');
      } else {
        setStep('NAME');
        setRegStep('NAME');
      }
    } else if (step === 'MOBILE' && name) {
      if (department) {
        setStep('DEPARTMENT');
        setRegStep('DEPARTMENT');
      } else {
        setStep('NAME');
        setRegStep('NAME');
      }
    } else if (step === 'NAME' && name && department) {
      setStep('DEPARTMENT');
      setRegStep('DEPARTMENT');
    }
  }, [patientDetails.name, patientDetails.age, patientDetails.department]);

  const handleTokenLookup = useCallback(() => {
    if (existingToken.trim()) scanToken(existingToken.trim());
  }, [existingToken, scanToken]);

  const handleNewPatient = useCallback(() => {
    startRegFlow();
    setStep('MOBILE');
  }, [startRegFlow]);

  const handleNextFromMobile = useCallback(() => {
    if (mobile.length >= 10) {
      updateRegFlow('mobile', mobile);
      updatePatientDetails({ phone: mobile });
      setStep('NAME');
    }
  }, [mobile, updateRegFlow, updatePatientDetails]);

  const handleNextFromName = useCallback(() => {
    if (patientDetails.name) {
      setStep('DEPARTMENT');
      setRegStep('DEPARTMENT');
    }
  }, [patientDetails.name, setRegStep]);

  const numPad = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

  // ── Step progress indicator ──────────────────────────────────────────
  const renderProgress = (current: number, total: number) => (
    <div className="flex items-center justify-center gap-2 mb-6">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-2 rounded-full transition-all duration-300 ${i < current ? 'bg-primary w-10' : i === current ? 'bg-primary/50 w-8' : 'bg-gray-200 dark:bg-gray-700 w-6'
            }`}
        />
      ))}
    </div>
  );

  // ── Step 1: New vs Returning ─────────────────────────────────────────
  const renderTypeStep = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex flex-col items-center p-4 md:p-8"
    >
      <h2 className="text-2xl md:text-4xl font-bold text-gray-800 dark:text-white mb-2 text-center">
        {L.regNewPatient}
      </h2>
      <p className="text-gray-500 dark:text-gray-400 mb-8 text-center">
        {L.opRegSub}
      </p>

      <div className="flex flex-col gap-4 w-full max-w-lg">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.96 }}
          transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
          onClick={handleNewPatient}
          id="btn-new-patient"
          className="w-full py-8 bg-gradient-to-br from-green-400 to-emerald-500 text-white rounded-3xl shadow-xl flex flex-col items-center gap-3 cursor-pointer glow-press"
        >
          <span className="text-6xl select-none">🟢</span>
          <span className="text-2xl md:text-3xl font-black">{L.regNew}</span>
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.96 }}
          transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
          onClick={() => setStep('RETURNING')}
          className="w-full py-8 bg-gradient-to-br from-blue-400 to-indigo-500 text-white rounded-3xl shadow-xl flex flex-col items-center gap-3 cursor-pointer glow-press"
        >
          <span className="text-6xl select-none">🔵</span>
          <span className="text-2xl md:text-3xl font-black">{L.regExisting}</span>
        </motion.button>
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

  // ── Step 2: Mobile Number ────────────────────────────────────────────
  const renderMobileStep = () => (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      className="flex flex-col items-center p-4 md:p-8 max-w-lg mx-auto w-full"
    >
      {renderProgress(0, 4)}

      <button onClick={() => setStep('TYPE')} className="self-start mb-4 flex items-center gap-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 font-medium cursor-pointer tap-bounce min-h-[48px]">
        <span className="material-symbols-outlined text-xl">arrow_back</span>
      </button>

      <h2 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white mb-2 text-center">
        📱 {L.regEnterMobile}
      </h2>

      {/* Display */}
      <div className="w-full bg-gray-50 dark:bg-gray-800 rounded-2xl border-2 border-gray-200 dark:border-gray-700 p-4 mb-6 text-center">
        <span className="text-4xl md:text-5xl font-black tracking-[0.3em] text-gray-800 dark:text-white">
          {mobile || <span className="text-gray-300 dark:text-gray-600">{L.regMobilePlaceholder}</span>}
        </span>
      </div>

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-2 md:gap-3 w-full mb-6">
        {numPad.map((key, i) => (
          <motion.button
            key={i}
            whileTap={{ scale: 0.93 }}
            transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
            onClick={() => {
              if (key === '⌫') setMobile(prev => prev.slice(0, -1));
              else if (key && mobile.length < 10) setMobile(prev => prev + key);
            }}
            disabled={key === ''}
            className={`h-14 md:h-16 rounded-2xl text-2xl font-bold transition-all ${key === '' ? 'invisible' : key === '⌫'
              ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 active:bg-red-200'
              : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-white border border-gray-200 dark:border-gray-700 active:bg-gray-100 dark:active:bg-gray-700 shadow-sm'
              }`}
          >
            {key}
          </motion.button>
        ))}
      </div>

      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={handleNextFromMobile}
        disabled={mobile.length < 10}
        className={`w-full h-16 rounded-2xl font-bold text-xl shadow-lg transition-all flex items-center justify-center gap-2 ${mobile.length < 10 ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed' : 'bg-primary text-white hover:bg-blue-700'
          }`}
      >
        {L.regNext} →
      </motion.button>
    </motion.div>
  );

  // ── Step 3: Name (voice + fallback) ──────────────────────────────────
  const renderNameStep = () => (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      className="flex flex-col items-center p-4 md:p-8 max-w-lg mx-auto w-full"
    >
      {renderProgress(1, 4)}

      <button onClick={() => setStep('MOBILE')} className="self-start mb-4 flex items-center gap-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 font-medium">
        <span className="material-symbols-outlined text-xl">arrow_back</span>
      </button>

      <h2 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white mb-2 text-center">
        🎤 {L.regSpeakName}
      </h2>
      <p className="text-gray-500 dark:text-gray-400 mb-6 text-center">{L.regOrType}</p>

      {/* Voice hint — use the floating mic at the bottom */}
      <div className="flex flex-col items-center mb-6">
        <span className="material-symbols-outlined text-4xl md:text-5xl text-primary/60 dark:text-blue-400/60 mb-1">mic</span>
        <p className="text-sm font-bold text-gray-500 dark:text-gray-400">
          {voiceState === VoiceState.LISTENING ? L.speakNow : L.tapAndSpeak}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">⬇ {L.regOrType}</p>
      </div>

      {/* Name display / text fallback */}
      <input
        id="field-name"
        type="text"
        value={patientDetails.name}
        onChange={(e) => { updatePatientDetails({ name: e.target.value }); updateRegFlow('name', e.target.value); }}
        placeholder={L.regNamePlaceholder}
        className="w-full h-14 px-4 text-xl border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:border-primary focus:outline-none bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white mb-4"
      />

      {/* Age + Gender row */}
      <div className="w-full flex gap-3 mb-6">
        <input
          id="field-age"
          type="number"
          value={patientDetails.age}
          onChange={(e) => { updatePatientDetails({ age: e.target.value }); updateRegFlow('age', e.target.value); }}
          placeholder={L.regAgePlaceholder}
          className="flex-1 h-16 px-4 text-xl border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:border-primary focus:outline-none bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white"
        />
        <div className="flex gap-2" id="field-gender">
          {[
            { val: 'Male', label: L.regMale, emoji: '👨' },
            { val: 'Female', label: L.regFemale, emoji: '👩' },
          ].map(({ val, label, emoji }) => (
            <motion.button
              key={val}
              whileTap={{ scale: 0.96 }}
              transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
              id={`btn-gender-${val.toLowerCase()}`}
              onClick={() => { updatePatientDetails({ gender: val }); updateRegFlow('gender', val); }}
              className={`h-16 px-5 rounded-2xl font-bold text-base flex items-center gap-2 transition-all min-w-[80px] ${patientDetails.gender === val
                ? 'bg-primary text-white shadow-md'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700'
                }`}
            >
              <span className="text-2xl select-none">{emoji}</span> {label}
            </motion.button>
          ))}
        </div>
      </div>

      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={handleNextFromName}
        disabled={!patientDetails.name}
        className={`w-full h-16 rounded-2xl font-bold text-xl shadow-lg transition-all flex items-center justify-center gap-2 ${!patientDetails.name ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed' : 'bg-primary text-white hover:bg-blue-700'
          }`}
      >
        {L.regNext} →
      </motion.button>
    </motion.div>
  );

  // ── Step 4: Department Grid ──────────────────────────────────────────
  const renderDeptStep = () => (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      className="flex flex-col items-center p-4 md:p-8 pb-24"
    >
      {renderProgress(2, 4)}

      <button onClick={() => setStep('NAME')} className="self-start mb-4 flex items-center gap-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 font-medium">
        <span className="material-symbols-outlined text-xl">arrow_back</span>
      </button>

      <h2 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white mb-2 text-center">
        🏥 {L.regSelectDept}
      </h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 w-full max-w-3xl mt-4" id="field-department">
        {DEPT_MAP.map((dept, idx) => {
          const isSelected = patientDetails.department === dept.id;
          return (
            <motion.button
              key={dept.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              whileTap={{ scale: 0.96 }}
              id={`btn-dept-${dept.id.toLowerCase().replace(/\s+/g, '-')}`}
              onClick={() => { updatePatientDetails({ department: dept.id }); updateRegFlow('department', dept.id); }}
              className={`rounded-2xl p-4 md:p-5 flex flex-col items-center justify-center gap-2 shadow-sm transition-all min-h-[140px] md:min-h-[160px] border-2 cursor-pointer ${isSelected
                ? 'border-primary bg-blue-50 dark:bg-blue-900/30 ring-4 ring-primary/30 shadow-lg'
                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 active:border-primary/50'
                }`}
            >
              <span className="text-5xl md:text-6xl select-none">{dept.emoji}</span>
              <span className={`text-base md:text-lg font-bold text-center leading-tight ${isSelected ? 'text-primary dark:text-blue-400' : 'text-gray-700 dark:text-gray-200'}`}>
                {(L as any)[dept.key] || dept.id}
              </span>
            </motion.button>
          );
        })}
      </div>

      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={submitRegistration}
        disabled={registrationLoading || !patientDetails.department}
        id="btn-submit-registration"
        className={`w-full max-w-lg h-[72px] rounded-2xl font-bold text-xl shadow-lg mt-6 transition-all flex items-center justify-center gap-3 ${!patientDetails.department ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed' : 'bg-primary text-white hover:bg-blue-700'
          }`}
      >
        {registrationLoading ? (
          <>
            <span className="material-symbols-outlined animate-spin">progress_activity</span>
            {L.regRegistering}
          </>
        ) : (
          <>
            {L.regConfirm}
            <span className="text-2xl select-none">✅</span>
          </>
        )}
      </motion.button>
    </motion.div>
  );

  // ── Returning Patient ────────────────────────────────────────────────
  const renderReturning = () => (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      className="flex flex-col items-center p-4 md:p-8 max-w-lg mx-auto w-full"
    >
      <button onClick={() => setStep('TYPE')} className="self-start mb-4 flex items-center gap-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 font-medium">
        <span className="material-symbols-outlined text-xl">arrow_back</span>
      </button>

      <h2 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white mb-6 text-center">
        🎟️ {L.regEnterToken}
      </h2>

      <div className="flex gap-3 w-full mb-4">
        <input
          type="text"
          placeholder="e.g. C-001"
          value={existingToken}
          onChange={(e) => setExistingToken(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && handleTokenLookup()}
          className="flex-1 h-16 px-4 text-2xl border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:border-primary focus:outline-none bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white font-mono tracking-widest uppercase"
        />
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={handleTokenLookup}
          disabled={lookupLoading || !existingToken.trim()}
          className="h-16 px-6 bg-primary hover:bg-blue-700 disabled:bg-gray-300 text-white font-bold rounded-2xl transition-colors flex items-center gap-2 text-lg"
        >
          {lookupLoading ? (
            <span className="material-symbols-outlined animate-spin">progress_activity</span>
          ) : (
            <span className="text-2xl">🔍</span>
          )}
          {L.regFind}
        </motion.button>
      </div>

      <AnimatePresence>
        {lookupResult && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="w-full bg-green-50 dark:bg-green-900/20 border-2 border-green-200 dark:border-green-800 rounded-3xl p-5 mt-2"
          >
            <div className="flex items-center gap-2 mb-4">
              <span className="text-3xl select-none">✅</span>
              <h3 className="font-bold text-green-800 dark:text-green-300 text-xl">{L.regPatientFound}</h3>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <span className="text-gray-400 text-xs uppercase font-bold">{L.regToken}</span>
                <p className="text-3xl font-black text-primary dark:text-blue-400">{lookupResult.token_number}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs uppercase font-bold">{L.regDepartment}</span>
                <p className="font-semibold text-gray-800 dark:text-gray-200 text-lg">{lookupResult.department}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs uppercase font-bold">{L.regName}</span>
                <p className="font-semibold text-gray-800 dark:text-gray-200 text-lg">{lookupResult.patient_name}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs uppercase font-bold">{L.regAgeGender}</span>
                <p className="font-semibold text-gray-800 dark:text-gray-200">{lookupResult.patient_age} / {lookupResult.patient_gender}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs uppercase font-bold">{L.regQueuePos}</span>
                <p className="font-semibold text-gray-800 dark:text-gray-200 text-lg">#{lookupResult.position}</p>
              </div>
              <div>
                <span className="text-gray-400 text-xs uppercase font-bold">{L.regEstWait}</span>
                <p className="font-semibold text-gray-800 dark:text-gray-200">{lookupResult.estimated_wait_time_mins} min</p>
              </div>
            </div>

            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => dispatchInteract({ type: 'NAVIGATE', payload: { route: ScreenName.RECEIPT } })}
              className="w-full mt-5 bg-green-600 hover:bg-green-700 text-white h-14 rounded-2xl font-bold text-lg shadow-lg transition-all flex items-center justify-center gap-2"
            >
              📄 {L.regViewReceipt}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {!lookupResult && (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-400 dark:text-gray-500 mt-8">
          <span className="text-7xl mb-4 select-none">🎟️</span>
          <p className="text-base font-medium">{L.regEnterTokenHint}</p>
        </div>
      )}
    </motion.div>
  );

  return (
    <div className="h-full w-full bg-[#F8FDFF] dark:bg-gray-900 flex flex-col relative overflow-y-auto scroll-momentum">
      {/* Token Confirmation Dialog */}
      <AnimatePresence>
        {pendingTokenConfirm && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-xl border-2 border-blue-200 dark:border-blue-700 p-5"
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl">🎟️</span>
              <div>
                <p className="font-bold text-gray-800 dark:text-white text-lg">
                  You said <span className="text-primary font-black">{pendingTokenConfirm}</span>
                </p>
                <p className="text-gray-500 dark:text-gray-400 text-sm">Is this correct?</p>
              </div>
            </div>
            <div className="flex gap-3">
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={confirmToken}
                className="flex-1 h-12 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl transition-colors"
              >
                ✅ Yes, correct
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={rejectToken}
                className="flex-1 h-12 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-bold rounded-xl transition-colors"
              >
                ❌ No, retry
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {step === 'TYPE' && <motion.div key="type" exit={{ opacity: 0 }}>{renderTypeStep()}</motion.div>}
        {step === 'MOBILE' && <motion.div key="mobile" exit={{ opacity: 0 }}>{renderMobileStep()}</motion.div>}
        {step === 'NAME' && <motion.div key="name" exit={{ opacity: 0 }}>{renderNameStep()}</motion.div>}
        {step === 'DEPARTMENT' && <motion.div key="dept" exit={{ opacity: 0 }}>{renderDeptStep()}</motion.div>}
        {step === 'RETURNING' && <motion.div key="ret" exit={{ opacity: 0 }}>{renderReturning()}</motion.div>}
      </AnimatePresence>
    </div>
  );
};