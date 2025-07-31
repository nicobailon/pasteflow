import React, { createContext, useContext } from 'react';

interface ThemeContextType {
  theme: 'light' | 'dark' | 'system';
  currentTheme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'system',
  currentTheme: 'light',
  setTheme: () => {},
});

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const value: ThemeContextType = {
    theme: 'system',
    currentTheme: 'light',
    setTheme: jest.fn(),
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};