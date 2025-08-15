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
  return (
    <div
      key={option.value}
      className={renderCustomOption ? undefined : getItemClassName(isActive)}
      onClick={() => onSelect(option.value)}
      onKeyDown={(e) => onKeyDown(e, option.value)}
      role="menuitem"
      tabIndex={0}
    >
      {renderMenuItem(option, isActive)}
    </div>
  );
};