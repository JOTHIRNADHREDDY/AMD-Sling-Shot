import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { useKiosk } from '../context/KioskContext';
import { LabTest, ScreenName } from '../types';
import { translations } from '../i18n';
import { saveLabTestScan, type LabScanSaveResult } from '../services/labTestSyncService';

export const LabTestsScreen: React.FC = () => {
  const { dispatchInteract, registrationResult, language } = useKiosk();
  const L = translations[language];
  const [viewState, setViewState] = useState<'IDLE' | 'CAMERA' | 'PROCESSING' | 'RESULTS'>('IDLE');
  const [scannedTests, setScannedTests] = useState<LabTest[]>([]);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<LabScanSaveResult | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      stopCamera();
      if (cameraTimeoutRef.current) clearTimeout(cameraTimeoutRef.current);
    };
  }, []);

  // Auto-start camera when entering lab tests screen
  useEffect(() => {
    if (viewState === 'IDLE') {
      const timer = setTimeout(() => {
        startCamera();
      }, 600); // Small delay for screen to render
      return () => clearTimeout(timer);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startCamera = async () => {
    setCameraReady(false);
    setCameraError(null);

    // If camera API isn't available (e.g. HTTP, no hardware), skip directly to simulated scan
    if (!navigator.mediaDevices?.getUserMedia) {
      console.warn('Camera API not available — simulating scan');
      setViewState('CAMERA');
      setCameraError(L.labCameraError);
      return;
    }

    // Switch to CAMERA view immediately so user sees the loading state
    setViewState('CAMERA');

    // Set a timeout: if camera doesn't initialize in 8s, show fallback
    cameraTimeoutRef.current = setTimeout(() => {
      if (!cameraReady) {
        setCameraError(L.labCameraError);
      }
    }, 8000);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      streamRef.current = stream;
      if (cameraTimeoutRef.current) clearTimeout(cameraTimeoutRef.current);
      // Small delay to ensure ref is mounted
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadeddata = () => setCameraReady(true);
        }
      }, 150);
    } catch (err) {
      console.error("Camera error:", err);
      if (cameraTimeoutRef.current) clearTimeout(cameraTimeoutRef.current);
      setCameraError(L.labCameraError);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
    setCameraError(null);
  };

  const captureAndProcess = () => {
    setViewState('PROCESSING');
    stopCamera();

    // Simulate OCR Processing delay
    setTimeout(() => {
      // Mock data representing scanned lab-test results from a prescription
      const mockData: LabTest[] = [
        { id: 'CBC-001', name: 'Complete Blood Count (CBC)', price: 350, status: 'Pending' },
        { id: 'LFT-002', name: 'Liver Function Test', price: 750, status: 'Pending' },
        { id: 'RBS-003', name: 'Random Blood Sugar', price: 150, status: 'Pending' },
        { id: 'TSH-004', name: 'Thyroid Profile (TSH)', price: 500, status: 'Pending' },
        { id: 'UA-005', name: 'Urine Analysis', price: 200, status: 'Pending' },
      ];
      setScannedTests(mockData);
      setViewState('RESULTS');

      // Persist scan results (cloud-first, offline fallback)
      saveLabTestScan(mockData, registrationResult?.registration_id)
        .then((result) => {
          setSaveResult(result);
          console.log('[LabTests] Scan saved:', result.location, result.scanId);
        })
        .catch((err) => console.error('[LabTests] Save failed:', err));
    }, 2500);
  };

  const handleConfirm = () => {
    // Navigate to Queue after confirming tests
    dispatchInteract({ type: 'NAVIGATE', payload: { route: ScreenName.QUEUE } });
  };

  const getTotalPrice = () => scannedTests.reduce((sum, test) => sum + test.price, 0);

  // Render: Initial State
  const renderIdle = () => (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 md:p-8 text-center animate-fade-in pb-24 md:pb-[20vh] overflow-y-auto scroll-momentum">
      {/* Big visual with hand pointing */}
      <motion.div
        animate={{ y: [0, -12, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="mb-6 md:mb-8"
      >
        <div className="bg-teal-50 dark:bg-teal-900/20 p-8 md:p-12 rounded-full shadow-sm relative">
          <span className="text-6xl md:text-[12vh] select-none">📄</span>
          <motion.span
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="absolute -bottom-2 right-2 text-4xl md:text-5xl select-none"
          >
            👇
          </motion.span>
        </div>
      </motion.div>

      <h2 className="text-2xl md:text-4xl font-bold text-gray-800 dark:text-white mb-2 md:mb-4">
        {L.labShowPaper}
      </h2>
      <p className="text-base md:text-xl text-gray-500 dark:text-gray-400 max-w-lg mb-8 md:mb-12 px-4">
        {L.labShowPaperDesc}
      </p>
      <motion.button
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
        onClick={startCamera}
        id="btn-scan-now"
        className="bg-gradient-to-r from-teal-500 to-emerald-600 text-white px-8 md:px-12 py-5 md:py-7 rounded-2xl text-xl md:text-3xl font-bold shadow-lg transition-transform flex items-center gap-3 md:gap-4 cursor-pointer glow-press"
      >
        <span className="text-3xl md:text-4xl select-none">🟢</span>
        {L.labScanNow}
      </motion.button>

      {/* Trust indicators */}
      <div className="flex flex-wrap gap-3 mt-8 justify-center">
        {[L.freeService, L.goBackAnytime, L.staffHelp].map((text, i) => (
          <span key={i} className="text-xs md:text-sm font-semibold text-slate-500 dark:text-slate-400 bg-white/60 dark:bg-slate-800/60 px-3 py-1.5 rounded-full border border-slate-200/50 dark:border-slate-700/50">
            {text}
          </span>
        ))}
      </div>
    </div>
  );

  // Render: Camera State
  const renderCamera = () => (
    <div className="relative min-h-[60vh] h-full w-full bg-gray-900 flex flex-col items-center overflow-hidden rounded-xl">
      {/* Video feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${cameraReady ? 'opacity-80' : 'opacity-0'}`}
      />

      {/* Camera loading state */}
      {!cameraReady && !cameraError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
          <div className="w-16 h-16 border-4 border-teal-300/30 border-t-teal-400 rounded-full animate-spin mb-6"></div>
          <p className="text-white/80 text-lg font-medium">{L.labCameraInit}</p>
          <p className="text-white/50 text-sm mt-2">{L.labCameraAllow}</p>
        </div>
      )}

      {/* Camera error / fallback */}
      {cameraError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 p-6">
          <span className="text-5xl mb-4 select-none">📷</span>
          <p className="text-white/90 text-lg font-medium text-center mb-6">{cameraError}</p>
          <button
            onClick={captureAndProcess}
            className="bg-teal-500 hover:bg-teal-600 text-white px-8 py-3 rounded-xl text-lg font-bold shadow-lg transition-colors flex items-center gap-2"
          >
            <span className="text-xl select-none">🟢</span>
            {L.labSimulateScan}
          </button>
        </div>
      )}

      {/* Scanner Overlay — only visible when camera is active */}
      {cameraReady && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[70%] h-[60%] border-4 border-white/50 rounded-3xl relative">
            <div className="absolute top-0 left-0 w-16 h-16 border-t-4 border-l-4 border-teal-400 rounded-tl-2xl"></div>
            <div className="absolute top-0 right-0 w-16 h-16 border-t-4 border-r-4 border-teal-400 rounded-tr-2xl"></div>
            <div className="absolute bottom-0 left-0 w-16 h-16 border-b-4 border-l-4 border-teal-400 rounded-bl-2xl"></div>
            <div className="absolute bottom-0 right-0 w-16 h-16 border-b-4 border-r-4 border-teal-400 rounded-br-2xl"></div>

            {/* Scanning Line Animation */}
            <div className="absolute left-0 right-0 h-1 bg-teal-400/80 shadow-[0_0_15px_rgba(45,212,191,0.8)] animate-[scan_2s_ease-in-out_infinite]"></div>
          </div>
        </div>
      )}

      {/* Capture Button — only when camera is ready */}
      {cameraReady && (
        <div className="absolute bottom-[22vh] z-20">
          <button
            onClick={captureAndProcess}
            className="bg-white rounded-full w-24 h-24 flex items-center justify-center shadow-lg active:scale-90 transition-transform cursor-pointer tap-bounce"
          >
            <div className="w-20 h-20 rounded-full border-4 border-teal-600 bg-teal-50"></div>
          </button>
        </div>
      )}

      {cameraReady && (
        <div className="absolute top-8 bg-black/50 px-6 py-2 rounded-full backdrop-blur-sm">
          <p className="text-white text-lg font-medium">{L.labAlignDoc}</p>
        </div>
      )}
    </div>
  );

  // Render: Processing State
  const renderProcessing = () => (
    <div className="flex flex-col items-center justify-center min-h-[60vh] pb-[20vh]">
      <div className="w-24 h-24 border-8 border-teal-200 border-t-teal-600 rounded-full animate-spin mb-8"></div>
      <h3 className="text-3xl font-bold text-gray-800 dark:text-white">{L.labAnalyzing}</h3>
      <p className="text-gray-500 mt-2 text-xl">{L.labIdentifying}</p>
    </div>
  );

  // Render: Results State
  const renderResults = () => (
    <div className="min-h-[60vh] flex flex-col p-6 animate-fade-in relative pt-16">
      {/* Floating Close Button for Results view, since header is gone */}
      <button
        onClick={() => {
          stopCamera();
          setViewState('IDLE');
        }}
        className="absolute top-4 right-4 z-30 w-12 h-12 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors shadow-sm cursor-pointer tap-bounce min-h-[48px]"
      >
        <span className="material-symbols-outlined text-3xl">close</span>
      </button>

      {/* Results List */}
      <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-2 relative">
        {scannedTests.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 opacity-60">
            <span className="material-symbols-outlined text-[10vh] mb-4 text-gray-400">content_paste_off</span>
            <p className="text-2xl font-bold text-gray-600 dark:text-gray-300">{L.labNoTests}</p>
            <p className="text-lg text-gray-500 mt-2 max-w-md">{L.labNoTestsHint}</p>
          </div>
        ) : (
          scannedTests.map((test, idx) => (
            <div key={idx} className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-gray-700 last:border-0">
              <div>
                <h4 className="text-2xl font-bold text-gray-800 dark:text-white">{test.name}</h4>
                <span className="text-teal-600 dark:text-teal-400 font-medium text-lg">{L.labTestCode}: {test.id}</span>
              </div>
              <div className="text-3xl font-bold text-gray-700 dark:text-gray-200">
                ₹{test.price}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Cloud / Offline sync status indicator */}
      {saveResult && (
        <div className={`mt-4 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium ${saveResult.location === 'cloud'
          ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
          : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
          }`}>
          <span className="material-symbols-outlined text-lg">
            {saveResult.location === 'cloud' ? 'cloud_done' : 'cloud_off'}
          </span>
          {saveResult.location === 'cloud'
            ? L.labSavedCloud
            : L.labSavedOffline}
        </div>
      )}

      {/* Action Bar - Added bottom margin to clear Voice Orb */}
      <div className="mt-6 mb-[20vh] bg-teal-50 dark:bg-teal-900/30 rounded-2xl p-6 flex items-center justify-between border border-teal-100 dark:border-teal-800">
        <div>
          <p className="text-gray-500 dark:text-teal-200 text-lg">{L.labTotalAmount}</p>
          <p className="text-4xl font-bold text-teal-700 dark:text-teal-300">₹{getTotalPrice()}</p>
        </div>

        {scannedTests.length > 0 ? (
          <button
            onClick={handleConfirm}
            className="bg-teal-600 hover:bg-teal-700 text-white px-10 py-4 rounded-xl text-2xl font-bold shadow-md transition-transform active:scale-95 cursor-pointer tap-bounce min-h-[48px] glow-press"
          >
            {L.labConfirm}
          </button>
        ) : (
          <button
            onClick={() => setViewState('CAMERA')}
            className="bg-teal-600 hover:bg-teal-700 text-white px-10 py-4 rounded-xl text-2xl font-bold shadow-md transition-transform active:scale-95 flex items-center gap-2"
          >
            <span className="material-symbols-outlined">refresh</span>
            {L.labScanAgain}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-[70vh] w-full p-4 flex flex-col">
      <div className="min-h-[70vh] flex-1 w-full bg-white dark:bg-gray-900 rounded-3xl shadow-xl overflow-hidden border border-gray-200 dark:border-gray-800 relative flex flex-col">
        {viewState === 'IDLE' && renderIdle()}
        {viewState === 'CAMERA' && renderCamera()}
        {viewState === 'PROCESSING' && renderProcessing()}
        {viewState === 'RESULTS' && renderResults()}

        {/* Back button available for CAMERA state only (RESULTS button is now inline/floating in renderResults) */}
        {viewState === 'CAMERA' && (
          <button
            onClick={() => {
              stopCamera();
              setViewState('IDLE');
            }}
            className="absolute top-6 left-6 z-30 w-12 h-12 flex items-center justify-center rounded-full transition-colors bg-white/20 backdrop-blur-md text-white hover:bg-white/30 cursor-pointer tap-bounce min-h-[48px]"
          >
            <span className="material-symbols-outlined text-3xl">close</span>
          </button>
        )}
      </div>
    </div>
  );
};