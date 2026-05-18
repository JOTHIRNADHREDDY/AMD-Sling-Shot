import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { useKiosk } from '../context/KioskContext';
import { ScreenName } from '../types';
import { translations } from '../i18n';
import { resolveDepartment, debugLog } from '../services/AppBrain';

interface Department {
  id: string;
  nameKey: string;
  emoji: string;
  floorKey: string;
  room: string;
  color: string;
  floorColor: string;
}

const departments: Department[] = [
  { id: '1', nameKey: 'navGeneralMedicine', emoji: '🤒', floorKey: 'navGroundFloor', room: '101-105', color: 'bg-blue-500', floorColor: '🟢' },
  { id: '2', nameKey: 'navCardiology', emoji: '🫀', floorKey: 'navFirstFloor', room: '201-205', color: 'bg-red-500', floorColor: '🔵' },
  { id: '3', nameKey: 'navPediatrics', emoji: '👶', floorKey: 'navFirstFloor', room: '210-215', color: 'bg-green-500', floorColor: '🔵' },
  { id: '4', nameKey: 'navOrthopedics', emoji: '🦴', floorKey: 'navSecondFloor', room: '301-305', color: 'bg-orange-500', floorColor: '🟣' },
  { id: '5', nameKey: 'navNeurology', emoji: '🧠', floorKey: 'navSecondFloor', room: '310-315', color: 'bg-purple-500', floorColor: '🟣' },
  { id: '6', nameKey: 'navPharmacy', emoji: '💊', floorKey: 'navGroundFloor', room: 'Near Exit', color: 'bg-teal-500', floorColor: '🟢' },
  { id: '7', nameKey: 'navLaboratory', emoji: '🧪', floorKey: 'navBasement', room: 'B-01', color: 'bg-indigo-500', floorColor: '⚪' },
  { id: '8', nameKey: 'navRadiology', emoji: '📡', floorKey: 'navBasement', room: 'B-05', color: 'bg-gray-600', floorColor: '⚪' },
];

/** Map department display names to department objects */
const DEPT_NAME_MAP: Record<string, Department> = {};
// Build reverse lookup from nameKey values and common names
const DEPT_COMMON_NAMES: Record<string, string> = {
  'General Medicine': '1',
  'Cardiology': '2',
  'Pediatrics': '3',
  'Orthopedics': '4',
  'Neurology': '5',
  'Pharmacy': '6',
  'Laboratory': '7',
  'Radiology': '8',
};

export const NavigationScreen: React.FC = () => {
  const { dispatchInteract, directions, directionsLoading, loadDirections, language } = useKiosk();
  const L = translations[language];
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);

  const filteredDepts = departments.filter(dept => {
    const name = (L as any)[dept.nameKey] || dept.nameKey;
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const handleSelectDept = useCallback((dept: Department) => {
    setSelectedDept(dept);
    const room = dept.room === 'Near Exit' ? (L as any).navNearExit || dept.room : dept.room;
    loadDirections('Reception', room);
    debugLog({ type: 'NAVIGATION', action: 'SELECT_DEPARTMENT', detail: { id: dept.id, name: (L as any)[dept.nameKey] } });
  }, [loadDirections, L]);

  // ── Listen for voice-dispatched department selection ─────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.type === 'SELECT_DEPARTMENT' && detail?.payload?.department) {
        const deptName = detail.payload.department as string;
        debugLog({ type: 'VOICE_INPUT', action: 'VOICE_DEPT_SELECT', detail: { deptName } });

        // Find matching department
        const deptId = DEPT_COMMON_NAMES[deptName];
        if (deptId) {
          const dept = departments.find(d => d.id === deptId);
          if (dept) {
            handleSelectDept(dept);
            return;
          }
        }

        // Fuzzy match against translated names
        const lower = deptName.toLowerCase();
        const match = departments.find(d => {
          const name = ((L as any)[d.nameKey] || d.nameKey).toLowerCase();
          return name.includes(lower) || lower.includes(name);
        });
        if (match) {
          handleSelectDept(match);
        } else {
          debugLog({ type: 'ERROR', action: 'DEPT_NOT_FOUND', detail: { deptName } });
        }
      }
    };

    window.addEventListener('app-interaction', handler);
    return () => window.removeEventListener('app-interaction', handler);
  }, [handleSelectDept, L]);

  const getDeptName = (dept: Department) => (L as any)[dept.nameKey] || dept.nameKey;
  const getFloorName = (dept: Department) => (L as any)[dept.floorKey] || dept.floorKey;

  return (
    <div className="h-full w-full p-4 md:p-6 flex flex-col gap-4 md:gap-6 max-w-7xl mx-auto overflow-y-auto scroll-momentum">
      {/* Header & Search */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row justify-between items-center gap-4"
      >
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white">{L.navTitle}</h2>
          <p className="text-gray-500 dark:text-gray-400">{L.navSubtitle}</p>
        </div>

        <div className="relative w-full md:w-96">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-gray-400">search</span>
          <input
            type="text"
            placeholder={L.navSearchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-14 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary outline-none shadow-sm transition-all"
          />

        </div>
      </motion.div>

      <div className="flex-1 flex gap-6 overflow-hidden">
        {/* Department List */}
        <div className="flex-1 overflow-y-auto pr-2 space-y-3 scroll-momentum">
          {filteredDepts.map((dept, index) => (
            <motion.button
              key={dept.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => handleSelectDept(dept)}
              className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left group cursor-pointer hover-lift
                ${selectedDept?.id === dept.id
                  ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 shadow-md'
                  : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-sm'
                }`}
            >
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shadow-sm ${dept.color} bg-opacity-10`}>
                <span className="select-none">{dept.emoji}</span>
              </div>
              <div className="flex-1">
                <h3 className={`font-bold text-lg ${selectedDept?.id === dept.id ? 'text-primary dark:text-blue-400' : 'text-gray-800 dark:text-gray-200'}`}>
                  {getDeptName(dept)}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                  <span className="select-none">{dept.floorColor}</span>
                  {getFloorName(dept)}
                  <span className="text-gray-300 dark:text-gray-600 mx-1">|</span>
                  🚪 {dept.room}
                </p>
              </div>
              <span className="material-symbols-outlined text-gray-400 group-hover:text-primary transition-colors">chevron_right</span>
            </motion.button>
          ))}
        </div>

        {/* Map / Details Panel */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="hidden md:flex flex-col w-1/3 bg-white dark:bg-gray-800 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-xl overflow-hidden"
        >
          {selectedDept ? (
            <>
              <div className={`h-32 ${selectedDept.color} flex items-center justify-center relative overflow-hidden`}>
                <span className="text-[120px] text-white/20 absolute -bottom-4 -right-4 rotate-12 select-none">
                  {selectedDept.emoji}
                </span>
                <div className="text-center z-10">
                  <h3 className="text-3xl font-bold text-white drop-shadow-md">{selectedDept.room}</h3>
                  <p className="text-white/90 font-medium">{selectedDept.floorColor} {getFloorName(selectedDept)}</p>
                </div>
              </div>

              <div className="p-6 flex-1 flex flex-col gap-6">
                <div>
                  <h4 className="text-gray-500 dark:text-gray-400 text-sm font-medium uppercase tracking-wider mb-2">{L.navDirections}</h4>
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                    {directionsLoading ? (
                      <p className="text-gray-400 animate-pulse text-center py-4">{L.navLoadingDir}</p>
                    ) : directions && directions.steps.length > 0 ? (
                      <ol className="space-y-4 relative border-l-2 border-gray-200 dark:border-gray-700 ml-2 pl-6">
                        <li className="relative">
                          <span className="absolute -left-[31px] w-4 h-4 rounded-full bg-green-500 border-2 border-white dark:border-gray-900"></span>
                          <p className="text-gray-800 dark:text-gray-200 font-medium">{L.navYouAreHere} ({directions.from_node})</p>
                        </li>
                        {directions.steps.map((step: any, idx: number) => (
                          <li key={idx} className="relative">
                            <span className={`absolute -left-[31px] w-4 h-4 rounded-full border-2 border-white dark:border-gray-900 ${idx === directions.steps.length - 1 ? 'bg-primary animate-pulse' : 'bg-gray-300 dark:bg-gray-600'
                              }`}></span>
                            <p className={`${idx === directions.steps.length - 1
                              ? 'text-gray-800 dark:text-gray-200 font-bold'
                              : 'text-gray-600 dark:text-gray-400'
                              }`}>
                              {step.instruction}
                              <span className="text-xs text-gray-400 ml-2">({step.distance_meters}m)</span>
                            </p>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <ol className="space-y-4 relative border-l-2 border-gray-200 dark:border-gray-700 ml-2 pl-6">
                        <li className="relative">
                          <span className="absolute -left-[31px] w-4 h-4 rounded-full bg-green-500 border-2 border-white dark:border-gray-900"></span>
                          <p className="text-gray-800 dark:text-gray-200 font-medium">📍 {L.navYouAreHere} (Reception)</p>
                        </li>
                        <li className="relative">
                          <span className="absolute -left-[31px] w-4 h-4 rounded-full bg-gray-300 dark:bg-gray-600 border-2 border-white dark:border-gray-900"></span>
                          <p className="text-gray-600 dark:text-gray-400">🛗 {L.navTakeElevator} {selectedDept.floorColor} {getFloorName(selectedDept)}</p>
                        </li>
                        <li className="relative">
                          <span className="absolute -left-[31px] w-4 h-4 rounded-full bg-primary border-2 border-white dark:border-gray-900 animate-pulse"></span>
                          <p className="text-gray-800 dark:text-gray-200 font-bold">🚪 {L.navArriveRoom} {selectedDept.room}</p>
                        </li>
                      </ol>
                    )}
                  </div>
                  {directions && (
                    <p className="text-sm text-gray-400 mt-2 text-center">
                      {directions.total_distance_meters}m · ~{directions.estimated_time_mins} min
                    </p>
                  )}
                </div>

                <div className="mt-auto">
                  <button
                    onClick={() => dispatchInteract({ type: 'NAVIGATE', payload: { route: ScreenName.HOME } })}
                    className="w-full py-4 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center justify-center gap-2 cursor-pointer tap-bounce min-h-[48px]"
                  >
                    <span className="text-xl select-none">🏠</span>
                    {L.navBackHome}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-gray-400 dark:text-gray-500">
              <div className="w-24 h-24 bg-gray-50 dark:bg-gray-900 rounded-full flex items-center justify-center mb-4">
                <span className="text-5xl select-none">🗺️</span>
              </div>
              <h3 className="text-xl font-bold text-gray-600 dark:text-gray-300 mb-2">{L.navSelectDept}</h3>
              <p>{L.navSelectDeptHint}</p>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
};
