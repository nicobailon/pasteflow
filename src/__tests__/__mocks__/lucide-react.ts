import React from 'react';

function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

const mock: any = new Proxy(
  {},
  {
    get: (_target, prop: string | symbol) => {
      return React.forwardRef<any, any>((props, ref) =>
        React.createElement('div', {
          'data-testid': `${toKebabCase(String(prop))}-icon`,
          ...props,
          ref,
        })
      );
    },
  }
);

// CommonJS-style export to support named imports like: import { Search } from 'lucide-react'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(module as any).exports = mock;

export {};