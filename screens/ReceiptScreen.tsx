import React, { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import { motion } from 'motion/react';
import { useKiosk } from '../context/KioskContext';
import { ScreenName, Language } from '../types';
import { translations } from '../i18n';

/**
 * Multi-language guidelines that explain how to use the OP receipt / QR code.
 * Shown on the receipt so the patient knows what to do next.
 */
const GUIDELINES: Record<string, { title: string; steps: string[] }> = {
  [Language.TELUGU]: {
    title: 'OP రసీదు సూచనలు',
    steps: [
      '1. ఈ QR కోడ్ లేదా టోకెన్ నంబర్‌ను జాగ్రత్తగా ఉంచుకోండి.',
      '2. మీ డిపార్ట్‌మెంట్ కౌంటర్ వద్ద ఈ కోడ్‌ను స్కాన్ చేయండి.',
      '3. స్కాన్ చేసిన తర్వాత మీ వివరాలు & క్యూ స్థితి కనిపిస్తుంది.',
      '4. మీ టోకెన్ నంబర్ పిలిచే వరకు వేచి ఉండే ప్రాంతంలో కూర్చోండి.',
      '5. ఏవైనా ప్రశ్నలు ఉంటే హెల్ప్ డెస్క్‌ను సంప్రదించండి.',
    ],
  },
  [Language.HINDI]: {
    title: 'OP रसीद निर्देश',
    steps: [
      '1. इस QR कोड या टोकन नंबर को सुरक्षित रखें।',
      '2. अपने विभाग के काउंटर पर इस कोड को स्कैन करें।',
      '3. स्कैन करने पर आपकी जानकारी और कतार की स्थिति दिखेगी।',
      '4. जब तक आपका टोकन नंबर बुलाया न जाए, प्रतीक्षा क्षेत्र में बैठें।',
      '5. किसी भी प्रश्न के लिए हेल्प डेस्क से संपर्क करें।',
    ],
  },
  [Language.ENGLISH]: {
    title: 'OP Receipt Instructions',
    steps: [
      '1. Keep this QR code or token number safe.',
      '2. Show or scan this code at your department counter.',
      '3. After scanning, your details & queue status will appear.',
      '4. Please wait in the waiting area until your token is called.',
      '5. For any questions, contact the Help Desk.',
    ],
  },
  [Language.TAMIL]: {
    title: 'OP ரசீது வழிமுறைகள்',
    steps: [
      '1. இந்த QR குறியீடு அல்லது டோக்கன் எண்ணைப் பாதுகாப்பாக வைத்திருங்கள்.',
      '2. உங்கள் துறை கவுண்டரில் இந்த குறியீட்டை ஸ்கேன் செய்யுங்கள்.',
      '3. ஸ்கேன் செய்தவுடன் உங்கள் விவரங்கள் & வரிசை நிலை தெரியும்.',
      '4. உங்கள் டோக்கன் அழைக்கப்படும் வரை காத்திருப்பு பகுதியில் அமருங்கள்.',
      '5. ஏதேனும் கேள்விகள் இருந்தால் உதவி மையத்தை அணுகவும்.',
    ],
  },
  [Language.TELUGU_EN]: {
    title: 'OP Receipt Soochanalu',
    steps: [
      '1. Ee QR code ledhaa token number jaagratthaga unchukondandi.',
      '2. Mee department counter lo ee code scan cheyandi.',
      '3. Scan chesina tarvata mee vivaralu & queue status kanipistundi.',
      '4. Mee token number piliche varaku wait area lo koorchondandi.',
      '5. Emaina questions unte Help Desk ni sampradinchandi.',
    ],
  },
  [Language.HINDI_EN]: {
    title: 'OP Raseed Nirdesh',
    steps: [
      '1. Is QR code ya token number ko surakshit rakhein.',
      '2. Apne vibhag ke counter par is code ko scan karein.',
      '3. Scan karne par aapki jaankari aur line ki sthiti dikhegi.',
      '4. Jab tak aapka token number bulaya na jaaye, wait area mein baithein.',
      '5. Kisi bhi sawal ke liye Help Desk se sampark karein.',
    ],
  },
};

export const ReceiptScreen: React.FC = () => {
  const {
    registrationResult,
    language,
    dispatchInteract,
    scanToken,
    lookupResult,
    lookupLoading,
    error,
    uploadReceiptImage,
    uploadingReceipt,
    uploadProgress,
    receiptUrl,
  } = useKiosk();

  const [manualToken, setManualToken] = useState('');
  const [scanning, setScanning] = useState(false);
  const [cloudSaved, setCloudSaved] = useState(false);
  const [cloudSaving, setCloudSaving] = useState(false);
  const [cloudUrl, setCloudUrl] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const receiptCardRef = useRef<HTMLDivElement | null>(null);
  const processingRef = useRef(false);
  const autoSavedRef = useRef(false);
  const scannerDivId = 'receipt-qr-scanner';

  // Only show the receipt card if the user just completed registration
  // (i.e. they were redirected here from submit, not from Home > Scan Receipt)
  const [showReceipt, setShowReceipt] = useState(!!registrationResult);
  const reg = showReceipt ? registrationResult : null;
  const guide = GUIDELINES[language] || GUIDELINES[Language.ENGLISH];
  const L = translations[language];

  // The QR payload is a URL that includes the token; when scanned by the app it
  // triggers the lookup endpoint automatically.
  const qrPayload = reg
    ? `${window.location.origin}/v1/registration/lookup/${reg.token_number}`
    : '';

  // Handle manual token lookup
  const handleLookup = () => {
    if (manualToken.trim()) {
      scanToken(manualToken.trim().toUpperCase());
    }
  };

  // Save receipt to Firebase Cloud Storage
  const handleCloudSave = async () => {
    if (!reg || cloudSaving || cloudSaved) return;
    setCloudSaving(true);
    try {
      const cardEl = receiptCardRef.current;
      if (cardEl) {
        const canvas = document.createElement('canvas');
        const rect = cardEl.getBoundingClientRect();
        canvas.width = rect.width * 2;
        canvas.height = rect.height * 2;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.scale(2, 2);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, rect.width, rect.height);
          ctx.fillStyle = '#1e40af';
          ctx.fillRect(0, 0, rect.width, 60);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 24px sans-serif';
          ctx.fillText('OP Receipt — AMD Hospital', 20, 40);
          ctx.fillStyle = '#1e40af';
          ctx.font = 'bold 48px sans-serif';
          ctx.fillText(reg.token_number, 20, 130);
          ctx.fillStyle = '#374151';
          ctx.font = '16px sans-serif';
          const lines = [
            `Patient: ${reg.patient_name}`,
            `Age / Gender: ${reg.patient_age} / ${reg.patient_gender}`,
            `Department: ${reg.department}`,
            `Queue Position: #${reg.position}`,
            `Est. Wait: ${reg.estimated_wait_time_mins} min`,
            `Phone: ${reg.patient_phone || '—'}`,
            `Registration ID: ${reg.registration_id}`,
            `Date: ${new Date().toLocaleDateString()}`,
          ];
          lines.forEach((line, i) => ctx.fillText(line, 20, 170 + i * 28));
        }
        const dataUrl = canvas.toDataURL('image/png');
        // Use the context method which has progress tracking
        const result = await uploadReceiptImage(dataUrl);
        if (result) {
          setCloudUrl(result.downloadUrl);
          setCloudSaved(true);
        }
      }
    } catch (err) {
      console.error('Cloud save failed:', err);
    } finally {
      setCloudSaving(false);
    }
  };

  // Auto-save receipt to cloud on first render (fire-and-forget)
  useEffect(() => {
    if (reg && !autoSavedRef.current && !cloudSaved) {
      autoSavedRef.current = true;
      // Small delay to let the card render
      const timer = setTimeout(() => handleCloudSave(), 1500);
      return () => clearTimeout(timer);
    }
  }, [reg]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync context receiptUrl → local state
  useEffect(() => {
    if (receiptUrl && !cloudUrl) {
      setCloudUrl(receiptUrl);
      setCloudSaved(true);
    }
  }, [receiptUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Camera QR Scanner ──────────────────────────────────────
  const startScanner = async () => {
    processingRef.current = false;
    setScanning(true);
    // Give the DOM a tick to render the container div
    await new Promise((r) => setTimeout(r, 200));

    const container = document.getElementById(scannerDivId);
    if (!container) {
      console.error('Scanner container not found');
      setScanning(false);
      return;
    }

    const html5Qr = new Html5Qrcode(scannerDivId);
    scannerRef.current = html5Qr;

    try {
      await html5Qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          // Prevent multiple triggers
          if (processingRef.current) return;
          processingRef.current = true;

          // Try to extract token from URL payload or raw token text
          let token = decodedText;
          const match = decodedText.match(/lookup\/([A-Za-z0-9-]+)/);
          if (match) token = match[1];

          const finalToken = token.toUpperCase();
          setManualToken(finalToken);

          // Defer stop so we're not calling it from inside the callback
          setTimeout(async () => {
            try {
              if (scannerRef.current) {
                await scannerRef.current.stop();
                scannerRef.current = null;
              }
            } catch { /* ignore */ }
            setScanning(false);
            scanToken(finalToken);
          }, 50);
        },
        // ignore scan failures (no QR in frame)
        () => { },
      );
    } catch (err) {
      console.error('Camera start failed:', err);
      // Camera permission denied or not available
      setScanning(false);
    }
  };

  const stopScanner = async () => {
    processingRef.current = false;
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch { /* already stopped */ }
      scannerRef.current = null;
    }
    setScanning(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopScanner(); };
  }, []);

  return (
    <div className="h-full w-full p-4 md:p-[3vw] flex flex-col items-center overflow-y-auto scroll-momentum pt-6 md:pt-[4vh] gap-6 md:gap-8">
      {/* ── OP Receipt Card ─────────────────────────────────────── */}
      {reg && (
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          ref={receiptCardRef}
          className="bg-white dark:bg-[#1E293B] w-full max-w-2xl rounded-3xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden"
        >
          {/* Header band */}
          <div className="bg-primary dark:bg-[#2563EB] px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-white text-2xl md:text-3xl font-black tracking-tight">{L.rcptTitle}</h2>
              <p className="text-blue-100 text-sm font-medium">{L.rcptHospital}</p>
            </div>
            <span className="material-symbols-outlined text-white/80 text-4xl">receipt_long</span>
          </div>

          <div className="p-6 md:p-8 flex flex-col md:flex-row gap-6 items-center">
            {/* QR Code */}
            <div className="flex flex-col items-center gap-2 flex-shrink-0">
              <div className="bg-white p-3 rounded-2xl shadow-md border">
                <QRCodeSVG
                  value={qrPayload}
                  size={160}
                  level="H"
                  includeMargin={false}
                />
              </div>
              <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">{L.rcptScanToView}</span>
            </div>

            {/* Patient Info */}
            <div className="flex-1 w-full space-y-3">
              {/* Token big */}
              <div className="text-center md:text-left">
                <p className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest font-bold">{L.rcptTokenNumber}</p>
                <p className="text-5xl md:text-6xl font-black text-primary dark:text-[#60A5FA] tracking-tight leading-none mt-1">
                  {reg.token_number}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mt-4">
                <Detail label={L.rcptPatient} value={reg.patient_name} />
                <Detail label={L.rcptAgeGender} value={`${reg.patient_age} / ${reg.patient_gender}`} />
                <Detail label={L.rcptDepartment} value={reg.department} />
                <Detail label={L.rcptQueuePos} value={`#${reg.position}`} />
                <Detail label={L.rcptEstWait} value={`${reg.estimated_wait_time_mins} min`} />
                <Detail label={L.rcptPhone} value={reg.patient_phone || '—'} />
              </div>
            </div>
          </div>

          {/* Guidelines in native language */}
          <div className="border-t border-dashed border-gray-200 dark:border-gray-700 mx-6" />
          <div className="px-6 pb-6 pt-4">
            <h3 className="font-bold text-lg text-gray-700 dark:text-gray-200 mb-2">{guide.title}</h3>
            <ul className="space-y-1">
              {guide.steps.map((s, i) => (
                <li key={i} className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{s}</li>
              ))}
            </ul>
          </div>

          {/* Actions */}
          <div className="px-6 pb-6 flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => window.print()}
              className="flex-1 h-12 rounded-xl border-2 border-primary text-primary dark:text-[#60A5FA] dark:border-[#60A5FA] font-bold text-base hover:bg-blue-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center gap-2 cursor-pointer tap-bounce min-h-[48px]"
            >
              <span className="material-symbols-outlined text-xl">print</span>
              {L.rcptPrint}
            </button>
            <button
              onClick={handleCloudSave}
              disabled={cloudSaving || uploadingReceipt || cloudSaved}
              className={`flex-1 h-12 rounded-xl border-2 font-bold text-base transition-colors flex items-center justify-center gap-2 cursor-pointer tap-bounce min-h-[48px] ${cloudSaved
                ? 'border-green-500 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 cursor-default'
                : 'border-purple-500 text-purple-600 dark:text-purple-400 dark:border-purple-500 hover:bg-purple-50 dark:hover:bg-gray-800'
                } disabled:opacity-60`}
            >
              {(cloudSaving || uploadingReceipt) ? (
                <span className="material-symbols-outlined animate-spin text-xl">progress_activity</span>
              ) : cloudSaved ? (
                <span className="material-symbols-outlined text-xl">cloud_done</span>
              ) : (
                <span className="material-symbols-outlined text-xl">cloud_upload</span>
              )}
              {(cloudSaving || uploadingReceipt) ? L.rcptSaving : cloudSaved ? L.rcptSavedCloud : L.rcptSaveCloud}
            </button>
            <button
              onClick={() => dispatchInteract({ type: 'NAVIGATE', payload: { route: ScreenName.QUEUE } })}
              className="flex-1 h-12 rounded-xl border-2 border-green-500 text-green-600 dark:text-green-400 dark:border-green-500 font-bold text-base hover:bg-green-50 dark:hover:bg-gray-800 transition-colors flex items-center justify-center gap-2 cursor-pointer tap-bounce min-h-[48px]"
            >
              <span className="material-symbols-outlined text-xl">queue</span>
              {L.rcptViewQueue}
            </button>
            <button
              onClick={() => dispatchInteract({ type: 'NAVIGATE', payload: { route: ScreenName.HOME } })}
              className="flex-1 h-12 rounded-xl bg-primary hover:bg-blue-700 dark:bg-[#2563EB] text-white font-bold text-base shadow-lg transition-colors flex items-center justify-center gap-2 cursor-pointer tap-bounce min-h-[48px] glow-press"
            >
              <span className="material-symbols-outlined text-xl">home</span>
              {L.rcptDone}
            </button>
          </div>

          {/* Cloud upload progress bar */}
          {(cloudSaving || uploadingReceipt) && (
            <div className="px-6 pb-3">
              <div className="bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(uploadProgress * 100, 5)}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 text-center">
                {L.rcptUploading} {Math.round(uploadProgress * 100)}%
              </p>
            </div>
          )}

          {/* Cloud save confirmation */}
          {cloudSaved && cloudUrl && (
            <div className="px-6 pb-6">
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-green-500 text-lg">cloud_done</span>
                  <p className="text-sm text-green-700 dark:text-green-300 font-medium flex-1">
                    {L.rcptCloudSuccess}
                  </p>
                </div>
                <a
                  href={cloudUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 font-medium hover:underline"
                >
                  <span className="material-symbols-outlined text-sm">open_in_new</span>
                  {L.rcptViewDownload}
                </a>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* ── Token Lookup Section ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-white dark:bg-[#1E293B] w-full max-w-2xl rounded-3xl shadow-xl border border-gray-100 dark:border-gray-700 p-6"
      >
        <h3 className="font-bold text-lg text-gray-700 dark:text-gray-200 mb-1 flex items-center gap-2">
          <span className="material-symbols-outlined">qr_code_scanner</span>
          {L.rcptHaveToken}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {L.rcptEnterOrScan}
        </p>

        <div className="flex gap-3">
          <input
            type="text"
            placeholder="e.g. C-001"
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
            className="flex-1 h-12 px-4 text-lg border-2 border-gray-200 dark:border-gray-600 rounded-xl focus:border-primary focus:outline-none bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white font-mono uppercase tracking-widest"
          />
          <button
            onClick={handleLookup}
            disabled={lookupLoading || !manualToken.trim()}
            className="h-12 px-6 bg-primary hover:bg-blue-700 disabled:bg-gray-300 text-white font-bold rounded-xl transition-colors flex items-center gap-2 cursor-pointer tap-bounce min-h-[48px]"
          >
            {lookupLoading ? (
              <span className="material-symbols-outlined animate-spin text-xl">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-xl">search</span>
            )}
            {L.rcptLookup}
          </button>
          <button
            onClick={scanning ? stopScanner : startScanner}
            className={`h-12 px-5 rounded-xl font-bold transition-colors flex items-center gap-2 cursor-pointer tap-bounce min-h-[48px] ${scanning
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'bg-amber-500 hover:bg-amber-600 text-white'
              }`}
          >
            <span className="material-symbols-outlined text-xl">
              {scanning ? 'stop' : 'photo_camera'}
            </span>
            {scanning ? L.rcptStop : L.rcptScan}
          </button>
        </div>

        {/* Camera scanner preview */}
        <div
          className={`mt-4 overflow-hidden transition-all duration-300 ${scanning ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'}`}
        >
          <div className="relative rounded-2xl overflow-hidden border-2 border-amber-400 dark:border-amber-500 bg-black">
            <div id={scannerDivId} className="w-full" style={{ minHeight: 280 }} />
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-4 py-3">
              <p className="text-white text-sm text-center font-medium">
                {L.rcptPointCamera}
              </p>
            </div>
          </div>
        </div>

        {/* Error message */}
        {error && !lookupResult && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-red-500">error</span>
            <p className="text-sm text-red-700 dark:text-red-300 font-medium">{error}</p>
          </motion.div>
        )}

        {/* Lookup result */}
        {lookupResult && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mt-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-4"
          >
            <h4 className="font-bold text-green-800 dark:text-green-300 text-base mb-2 flex items-center gap-2">
              <span className="material-symbols-outlined">check_circle</span>
              {L.rcptPatientFound} — {lookupResult.token_number}
            </h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <Detail label={L.rcptPatient} value={lookupResult.patient_name} />
              <Detail label={L.rcptAgeGender} value={`${lookupResult.patient_age} / ${lookupResult.patient_gender}`} />
              <Detail label={L.rcptDepartment} value={lookupResult.department} />
              <Detail label={L.rcptQueuePos} value={`#${lookupResult.position}`} />
              <Detail label={L.rcptEstWait} value={`${lookupResult.estimated_wait_time_mins} min`} />
            </div>

            {/* Guidelines for scanned patient */}
            <div className="border-t border-green-200 dark:border-green-800 mt-3 pt-3">
              <p className="text-sm font-bold text-green-700 dark:text-green-400 mb-1">{guide.title}</p>
              {guide.steps.map((s, i) => (
                <p key={i} className="text-xs text-green-700/80 dark:text-green-400/80 leading-relaxed">{s}</p>
              ))}
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
};

/** Small helper component for label/value pairs */
const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <span className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-wider font-bold">{label}</span>
    <p className="text-gray-800 dark:text-gray-200 font-semibold truncate">{value}</p>
  </div>
);
