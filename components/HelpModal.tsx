import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useKiosk } from '../context/KioskContext';
import { ScreenName } from '../types';

export const HelpModal: React.FC = () => {
  const { isHelpOpen, toggleHelp, currentScreen } = useKiosk();

  const getHelpContent = () => {
    switch (currentScreen) {
      case ScreenName.HOME:
        return {
          title: "Welcome to General Hospital",
          instructions: [
            "Tap the microphone button to start speaking.",
            "Say 'Register' to start a new registration.",
            "Say 'Queue' to check your token status.",
            "Say 'Lab Tests' to view your reports."
          ],
          faq: [
            { q: "Is this kiosk free?", a: "Yes, this service is free for all patients." },
            { q: "Can I change the language?", a: "Yes, tap the language button at the top." }
          ]
        };
      case ScreenName.REGISTRATION:
        return {
          title: "Patient Registration",
          instructions: [
            "Speak your full name clearly.",
            "Mention your age and gender.",
            "Confirm your details before submitting."
          ],
          faq: [
            { q: "Do I need an ID card?", a: "No, just your name and age are required for the token." },
            { q: "What if I make a mistake?", a: "You can say 'Reset' to start over." }
          ]
        };
      case ScreenName.QUEUE:
        return {
          title: "Queue Status",
          instructions: [
            "Your token number is displayed on the screen.",
            "Wait for your number to be called.",
            "You can choose to receive an SMS alert."
          ],
          faq: [
            { q: "How long is the wait?", a: "The estimated wait time is shown on the screen." },
            { q: "Can I leave and come back?", a: "Yes, but please return before your estimated time." }
          ]
        };
      default:
        return {
          title: "Help & Support",
          instructions: [
            "Use voice commands to navigate.",
            "Tap buttons if you prefer touch input.",
            "Ask for assistance if needed."
          ],
          faq: []
        };
    }
  };

  const content = getHelpContent();

  return (
    <AnimatePresence>
      {isHelpOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="bg-white dark:bg-gray-900 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-700 gpu-accelerated"
          >
            {/* Header */}
            <div className="bg-primary dark:bg-blue-900 p-6 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <span className="material-symbols-outlined">help</span>
                {content.title}
              </h2>
              <motion.button
                whileHover={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.15)' }}
                whileTap={{ scale: 0.96 }}
                transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                onClick={toggleHelp}
                className="text-white/80 hover:text-white rounded-full p-2 transition-colors cursor-pointer min-w-[48px] min-h-[48px] flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-2xl">close</span>
              </motion.button>
            </div>

            {/* Content */}
            <div className="p-6 max-h-[70vh] overflow-y-auto scroll-momentum">
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary dark:text-blue-400">info</span>
                  Instructions
                </h3>
                <ul className="space-y-3">
                  {content.instructions.map((instruction, idx) => (
                    <li key={idx} className="flex items-start gap-3 text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg">
                      <span className="bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 w-6 h-6 flex items-center justify-center rounded-full text-sm font-bold flex-shrink-0">
                        {idx + 1}
                      </span>
                      <span>{instruction}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {content.faq.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary dark:text-blue-400">quiz</span>
                    Frequently Asked Questions
                  </h3>
                  <div className="space-y-3">
                    {content.faq.map((item, idx) => (
                      <div key={idx} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                        <p className="font-medium text-gray-900 dark:text-gray-100 mb-1">{item.q}</p>
                        <p className="text-gray-600 dark:text-gray-400 text-sm">{item.a}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <motion.button
                whileHover={{ scale: 1.02, filter: 'brightness(0.95)' }}
                whileTap={{ scale: 0.96 }}
                transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                onClick={toggleHelp}
                className="px-6 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-full font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors cursor-pointer min-h-[48px] glow-press"
              >
                Close
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
