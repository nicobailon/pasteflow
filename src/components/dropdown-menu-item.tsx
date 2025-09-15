import React from 'react';

import { DropdownOption } from './dropdown';

interface DropdownMenuItemProps {
  option: DropdownOption;
  isActive: boolean;
  onSelect: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent, value: string) => void;
  renderCustomOption?: (option: DropdownOption, isActive: boolean) => React.ReactNode;
  getItemClassName: (isActive: boolean) => string;
  renderMenuItem: (option: DropdownOption, isActive: boolean) => React.ReactNode;
}

export const DropdownMenuItem: React.FC<DropdownMenuItemProps> = ({
  option,
  isActive,
  onSelect,
  onKeyDown,
  renderCustomOption,
  getItemClassName,
  renderMenuItem,
}) => {
  if (option.className && option.className.includes('dropdown-divider')) {
    return <div className="dropdown-divider" role="separator" aria-hidden />;
  }
  const isDisabled = Boolean(option.disabled);
  const className = renderCustomOption ? undefined : `${getItemClassName(isActive)}${isDisabled ? ' disabled' : ''}`;

  const handleClick = () => {
    if (isDisabled) {
      if (typeof (option as any).onDisabledClick === 'function') {
        try { (option as any).onDisabledClick(); } catch { /* noop */ }
      }
      return;
    }
    onSelect(option.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isDisabled) {
      // Prevent triggering selection on Enter/Space for disabled items
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    onKeyDown(e, option.value);
  };
  const ariaLabel = isDisabled ? `${option.label} — Requires API key` : undefined;
  return (
    <div
      key={option.value}
      className={className}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="menuitem"
      aria-disabled={isDisabled || undefined}
      aria-label={ariaLabel}
      tabIndex={isDisabled ? -1 : 0}
      title={isDisabled ? 'Configure Keys in Agent Settings' : undefined}
    >
      {renderMenuItem(option, isActive)}
    </div>
  );
};
