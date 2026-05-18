import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface SuccessAnimationProps {
    show: boolean;
    message?: string;
    onDone?: () => void;
}

export const SuccessAnimation: React.FC<SuccessAnimationProps> = ({ show, message = 'Done!', onDone }) => {
    return (
        <AnimatePresence>
            {show && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
                    onClick={onDone}
                >
                    <motion.div
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                        className="bg-white dark:bg-slate-800 rounded-3xl p-8 md:p-12 flex flex-col items-center gap-4 shadow-2xl max-w-sm mx-4"
                    >
                        {/* Animated Checkmark Circle */}
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 15 }}
                            className="w-24 h-24 md:w-32 md:h-32 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center shadow-lg"
                        >
                            <motion.svg
                                viewBox="0 0 24 24"
                                className="w-14 h-14 md:w-20 md:h-20"
                                initial={{ pathLength: 0 }}
                                animate={{ pathLength: 1 }}
                                transition={{ delay: 0.3, duration: 0.5, ease: 'easeOut' }}
                            >
                                <motion.path
                                    d="M5 13l4 4L19 7"
                                    fill="none"
                                    stroke="white"
                                    strokeWidth={3}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    initial={{ pathLength: 0 }}
                                    animate={{ pathLength: 1 }}
                                    transition={{ delay: 0.3, duration: 0.5, ease: 'easeOut' }}
                                />
                            </motion.svg>
                        </motion.div>

                        {/* Message */}
                        <motion.p
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.5 }}
                            className="text-xl md:text-2xl font-bold text-slate-800 dark:text-white text-center"
                        >
                            {message}
                        </motion.p>

                        {/* Auto-dismiss hint */}
                        <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 0.5 }}
                            transition={{ delay: 0.8 }}
                            className="text-sm text-slate-400 dark:text-slate-500"
                        >
                            ✓
                        </motion.p>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

// ── Error Pulse Animation ─────────────────────────────────────────────────────

interface ErrorPulseProps {
    show: boolean;
    message?: string;
    onDismiss?: () => void;
}

export const ErrorPulse: React.FC<ErrorPulseProps> = ({ show, message, onDismiss }) => {
    return (
        <AnimatePresence>
            {show && (
                <motion.div
                    initial={{ opacity: 0, y: -30, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -20, scale: 0.95 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className="fixed top-24 left-1/2 -translate-x-1/2 z-[60] w-[90vw] max-w-md"
                    role="alert"
                >
                    <div
                        className="bg-white/95 backdrop-blur-lg dark:bg-slate-900/95 border-l-4 border-red-500 px-5 py-4 rounded-xl shadow-xl flex items-center gap-4 cursor-pointer min-h-[72px]"
                        onClick={onDismiss}
                    >
                        {/* Pulsing red icon */}
                        <motion.div
                            animate={{ scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                            className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0"
                        >
                            <span className="text-2xl">😕</span>
                        </motion.div>
                        <p className="flex-1 text-base font-semibold text-slate-700 dark:text-slate-200 leading-snug">
                            {message}
                        </p>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
