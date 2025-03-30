import { useContext } from 'react';

import { UIStateContext, UIStateContextType } from '../context/ui-state-context';

export const useUIState = (): UIStateContextType => {
  const context = useContext(UIStateContext);
  if (context === undefined) {
    throw new Error('useUIState must be used within a UIStateProvider');
  }
  return context;
}; 