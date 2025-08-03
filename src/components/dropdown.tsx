import { ChevronDown } from "lucide-react";
import * as React from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface DropdownOption {
  value: string;
  label: string;
  icon?: JSX.Element;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  buttonClassName?: string;
  buttonLabel?: string;
  buttonIcon?: JSX.Element;
  containerClassName?: string;
  menuClassName?: string;
  itemClassName?: string;
  activeItemClassName?: string;
  showCheckmark?: boolean;
  renderCustomOption?: (option: DropdownOption, isActive: boolean) => JSX.Element;
  position?: "left" | "right";
  closeOnChange?: boolean;
  animationType?: "scale" | "fade" | "slide";
  glassEffect?: boolean;
  variant?: "default" | "primary" | "subtle";
}

export interface DropdownRef {
  close: () => void;
}

const Dropdown = forwardRef<DropdownRef, DropdownProps>(
  (
    {
      options,
      value,
      onChange,
      buttonLabel = "Sort",
      buttonIcon = <ChevronDown size={16} />,
      buttonClassName = "",
      containerClassName = "",
      menuClassName = "",
      itemClassName = "",
      activeItemClassName = "",
      showCheckmark = true,
      renderCustomOption,
      position = "left",
      closeOnChange = true,
      animationType = "scale",
      glassEffect = true,
      variant = "default",
    },
    ref
  ) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    close: () => setIsOpen(false)
  }), []);

  const handleToggle = useCallback(() => {
    setIsOpen((isCurrentlyOpen: boolean) => !isCurrentlyOpen);
  }, []);

  const handleSelect = useCallback((optionValue: string) => {
    onChange(optionValue);
    if (closeOnChange) {
      setIsOpen(false);
    }
  }, [onChange, closeOnChange]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent, value?: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (value === undefined) {
        handleToggle();
      } else {
        handleSelect(value);
      }
    } else if (event.key === "Escape" && isOpen) {
      setIsOpen(false);
    }
  }, [handleSelect, handleToggle, isOpen]);

  // Close the dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    
    // Add event listener when dropdown is open
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    
    // Clean up event listener
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const getAnimationClass = () => {
    switch (animationType) {
      case "fade": {
        return "dropdown-menu-fade";
      }
      case "slide": {
        return "dropdown-menu-slide";
      }
      default: {
        return "";
      }
    }
  };

  const getButtonClass = () => {
    let className = "dropdown-button";
    if (glassEffect) className += " glass-effect";
    if (variant !== "default") className += ` dropdown-${variant}`;
    if (buttonClassName) className += ` ${buttonClassName}`;
    return className;
  };

  return (
    <div 
      ref={dropdownRef}
      className={`dropdown-container ${containerClassName}`}
    >
      <button
        className={getButtonClass()}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        {buttonIcon}
        {buttonLabel && <span>{buttonLabel}</span>}
      </button>
      
      {isOpen && (
        <div 
          ref={menuRef}
          className={`dropdown-menu ${getAnimationClass()} ${menuClassName}`}
          style={position === "right" ? { right: 0, left: "auto" } : {}}
          role="menu"
        >
          {options.map((option) => {
            const isActive = option.value === value;
            
            if (renderCustomOption) {
              return (
                <div
                  key={option.value}
                  onClick={() => handleSelect(option.value)}
                  onKeyDown={(e) => handleKeyDown(e, option.value)}
                  role="menuitem"
                  tabIndex={0}
                >
                  {renderCustomOption(option, isActive)}
                </div>
              );
            }
            
            const getItemClassName = () => {
              let className = "dropdown-item";
              if (isActive) {
                className += " active";
                if (activeItemClassName) {
                  className += ` ${activeItemClassName}`;
                }
              }
              if (itemClassName) {
                className += ` ${itemClassName}`;
              }
              return className;
            };
            
            return (
              <div
                key={option.value}
                className={getItemClassName()}
                onClick={() => handleSelect(option.value)}
                onKeyDown={(e) => handleKeyDown(e, option.value)}
                role="menuitem"
                tabIndex={0}
              >
                {option.icon && <span className="dropdown-item-icon">{option.icon}</span>}
                <span>{option.label}</span>
                {isActive && showCheckmark && <span className="checkmark">✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

Dropdown.displayName = 'Dropdown';

export default Dropdown; 