import { useState, useEffect } from 'react';

import { FeatureControl } from '../utils/feature-flags';

interface DeveloperSettingsProps {
  onClose: () => void;
}

export function DeveloperSettings({ onClose }: DeveloperSettingsProps) {
  const [workerTokensEnabled, setWorkerTokensEnabled] = useState(false);
  
  useEffect(() => {
    // Check current state
    setWorkerTokensEnabled(FeatureControl.isEnabled());
  }, []);
  
  const handleToggleWorkerTokens = () => {
    if (workerTokensEnabled) {
      FeatureControl.disable();
    } else {
      FeatureControl.enable();
    }
    // Note: FeatureControl will reload the app
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-semibold mb-4">Developer Settings</h2>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Web Worker Token Counting</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Use Web Workers for async token counting (enabled by default)
              </p>
            </div>
            <button
              onClick={handleToggleWorkerTokens}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                workerTokensEnabled ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  workerTokensEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-3">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              <strong>Note:</strong> Changing this setting will reload the application.
            </p>
          </div>
        </div>
        
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}