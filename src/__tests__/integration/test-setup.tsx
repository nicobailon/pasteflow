import * as React from 'react';
import { render as rtlRender, RenderOptions } from '@testing-library/react';
import { ThemeProvider } from '../../context/theme-context';

// Define precise types for our custom render options
type CustomRenderOptions = Omit<RenderOptions, 'wrapper'>;

// Custom render function that includes all providers
function customRender(
  ui: React.ReactElement,
  options?: CustomRenderOptions
) {
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <ThemeProvider>
      {children as JSX.Element}
    </ThemeProvider>
  );

  return rtlRender(ui, { wrapper: Wrapper, ...options });
}

// Re-export everything
export * from '@testing-library/react';
// Override the default render with proper typing
export { customRender as render };