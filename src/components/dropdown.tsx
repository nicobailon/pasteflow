import { ChevronDown } from "lucide-react";
import * as React from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { DropdownMenuItem } from './dropdown-menu-item';

import "./dropdown.css";

export interface DropdownOption {
  value: string;
  label: string;
  icon?: JSX.Element;
  disabled?: boolean;
  className?: string;
}

export interface DropdownRef {
  close: () => void;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  buttonLabel?: string;
  buttonIcon?: JSX.Element;
  containerClassName?: string;
  buttonClassName?: string;
  menuClassName?: string;
  itemClassName?: string;
  activeItemClassName?: string;
  position?: "left" | "right";
  placement?: "bottom" | "top";
  renderCustomOption?: (option: DropdownOption, isActive: boolean) => JSX.Element;
  showCheckmark?: boolean;
  closeOnChange?: boolean;
  glassEffect?: boolean;
  variant?: "default" | "primary" | "secondary" | "minimal";
  /**
   * Animation type for dropdown menu appearance.
   * Changed from default "scale" to "fade" for better visual consistency
   * and to avoid layout shift issues with scaled content.
   * - "fade": Smooth opacity transition (recommended)
   * - "slide": Slide down animation
   * - "none": No animation
   */
  animationType?: "fade" | "slide" | "none";
}

/**
 * Hook for dropdown handlers
 */
function useDropdownHandlers(config: {
  onChange: (value: string) => void;
  closeOnChange: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isOpen: boolean;
}) {
  const { onChange, closeOnChange, setIsOpen, isOpen } = config;

  const handleToggle = useCallback(() => {
    setIsOpen((prev: boolean) => !prev);
  }, [setIsOpen]);

  const handleSelect = useCallback((optionValue: string) => {
    onChange(optionValue);
    if (closeOnChange) {
      setIsOpen(false);
    }
  }, [onChange, closeOnChange, setIsOpen]);

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
  }, [handleSelect, handleToggle, isOpen, setIsOpen]);

  return { handleToggle, handleSelect, handleKeyDown };
}

/**
 * Hook for dropdown class name getters
 */
function useDropdownClassNames(config: {
  glassEffect: boolean;
  variant: string;
  buttonClassName: string;
  itemClassName: string;
  activeItemClassName: string;
  animationType: string;
  showCheckmark: boolean;
  renderCustomOption?: (option: DropdownOption, isActive: boolean) => JSX.Element;
}) {
  const {
    glassEffect,
    variant,
    buttonClassName,
    itemClassName,
    activeItemClassName,
    animationType,
    showCheckmark,
    renderCustomOption
  } = config;

  const getAnimationClass = useCallback(() => {
    const classMap: Record<string, string> = {
      fade: "dropdown-menu-fade",
      slide: "dropdown-menu-slide"
    };
    return classMap[animationType] || "";
  }, [animationType]);

  const getButtonClass = useCallback(() => {
    const classes = ["dropdown-button"];
    if (glassEffect) classes.push("glass-effect");
    if (variant !== "default") classes.push(`dropdown-${variant}`);
    if (buttonClassName) classes.push(buttonClassName);
    return classes.join(" ");
  }, [glassEffect, variant, buttonClassName]);

  const getItemClassName = useCallback((isActive: boolean) => {
    const classes = ["dropdown-item"];
    if (isActive) {
      classes.push("active");
      if (activeItemClassName) classes.push(activeItemClassName);
    }
    if (itemClassName) classes.push(itemClassName);
    return classes.join(" ");
  }, [activeItemClassName, itemClassName]);

  const renderMenuItem = useCallback((option: DropdownOption, isActive: boolean) => {
    if (renderCustomOption) {
      return renderCustomOption(option, isActive);
    }
    
    return (
      <>
        {option.icon && <span className="dropdown-item-icon">{option.icon}</span>}
        <span>{option.label}</span>
        {isActive && showCheckmark && <span className="checkmark">✓</span>}
      </>
    );
  }, [renderCustomOption, showCheckmark]);

  return {
    getAnimationClass,
    getButtonClass,
    getItemClassName,
    renderMenuItem
  };
}

/**
 * Hook for handling clicks outside the dropdown
 */
function useClickOutside(
  menuRef: React.RefObject<HTMLDivElement>,
  isOpen: boolean,
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>
) {
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, menuRef, setIsOpen]);
}

/**
 * Dropdown button component
 */
interface DropdownButtonProps {
  icon: JSX.Element;
  label?: string;
  className: string;
  onClick: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  isOpen: boolean;
}

function DropdownButton({
  icon,
  label,
  className,
  onClick,
  onKeyDown,
  isOpen
}: DropdownButtonProps) {
  return (
    <button
      className={className}
      onClick={onClick}
      onKeyDown={onKeyDown}
      aria-haspopup="true"
      aria-expanded={isOpen}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}

/**
 * Dropdown menu component
 */
interface DropdownMenuProps {
  options: DropdownOption[];
  value: string;
  position: "left" | "right";
  placement: "bottom" | "top";
  menuClassName: string;
  animationClass: string;
  onSelect: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent, value?: string) => void;
  getItemClassName: (isActive: boolean) => string;
  renderMenuItem: (option: DropdownOption, isActive: boolean) => JSX.Element;
  renderCustomOption?: (option: DropdownOption, isActive: boolean) => JSX.Element;
}

const DropdownMenu = forwardRef<HTMLDivElement, DropdownMenuProps>(
  ({
    options,
    value,
    position,
    placement,
    menuClassName,
    animationClass,
    onSelect,
    onKeyDown,
    getItemClassName,
    renderMenuItem,
    renderCustomOption
  }, ref) => {
    return (
      <div 
        ref={ref}
        className={`dropdown-menu ${placement === 'top' ? 'dropup' : ''} ${animationClass} ${menuClassName}`}
        style={position === "right" ? { right: 0, left: "auto" } : {}}
        role="menu"
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            option={option}
            isActive={option.value === value}
            onSelect={onSelect}
            onKeyDown={onKeyDown}
            renderCustomOption={renderCustomOption}
            getItemClassName={getItemClassName}
            renderMenuItem={renderMenuItem}
          />
        ))}
      </div>
    );
  }
);

DropdownMenu.displayName = 'DropdownMenu';

/**
 * Main Dropdown component
 */
const Dropdown = forwardRef<DropdownRef, DropdownProps>(
  (
    {
      options,
      value,
      onChange,
      buttonLabel,
      buttonIcon = <ChevronDown size={16} />,
      containerClassName = "",
      buttonClassName = "",
      menuClassName = "",
      itemClassName = "",
      activeItemClassName = "",
      position = "left",
      placement = "bottom",
      renderCustomOption,
      showCheckmark = false,
      closeOnChange = true,
      glassEffect = true,
      variant = "default",
      animationType = "fade"
    },
    ref
  ) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const dropdownConfig = {
      onChange,
      closeOnChange,
      setIsOpen,
      isOpen,
      glassEffect,
      variant,
      buttonClassName,
      showCheckmark,
      renderCustomOption,
      itemClassName,
      activeItemClassName,
      animationType
    };

    const handlers = useDropdownHandlers(dropdownConfig);
    const classNameGetters = useDropdownClassNames(dropdownConfig);
    
    useImperativeHandle(ref, () => ({
      close: () => setIsOpen(false)
    }), []);

    useClickOutside(menuRef, isOpen, setIsOpen);

    return (
      <div 
        ref={dropdownRef}
        className={`dropdown-container ${containerClassName}`}
      >
        <DropdownButton
          icon={buttonIcon}
          label={buttonLabel}
          className={classNameGetters.getButtonClass()}
          onClick={handlers.handleToggle}
          onKeyDown={handlers.handleKeyDown}
          isOpen={isOpen}
        />
        
        {isOpen && (
          <DropdownMenu
            ref={menuRef}
            options={options}
            value={value}
            position={position}
            placement={placement}
            menuClassName={menuClassName}
            animationClass={classNameGetters.getAnimationClass()}
            onSelect={handlers.handleSelect}
            onKeyDown={handlers.handleKeyDown}
            getItemClassName={classNameGetters.getItemClassName}
            renderMenuItem={classNameGetters.renderMenuItem}
            renderCustomOption={renderCustomOption}
          />
        )}
      </div>
    );
  }
);

Dropdown.displayName = 'Dropdown';

export default Dropdown;
