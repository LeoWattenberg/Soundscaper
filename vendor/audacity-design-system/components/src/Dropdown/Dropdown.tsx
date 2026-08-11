import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../ThemeProvider';
import '../assets/fonts/musescore-icon.css';
import './Dropdown.css';

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface DropdownProps {
  /**
   * Available options
   */
  options: DropdownOption[];
  /**
   * Current value
   */
  value?: string;
  /**
   * Placeholder text when no value selected
   */
  placeholder?: string;
  /**
   * Disabled state
   */
  disabled?: boolean;
  /**
   * Change handler
   */
  onChange?: (value: string) => void;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Width of the dropdown (CSS value)
   */
  width?: string;
  /**
   * Tab index for keyboard navigation
   */
  tabIndex?: number;
}

export const Dropdown: React.FC<DropdownProps> = ({
  options,
  value,
  placeholder = 'Select option',
  disabled = false,
  onChange,
  className = '',
  width,
  tabIndex,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number>(-1);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);
  const displayText = selectedOption ? selectedOption.label : placeholder;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const isClickInsideDropdown = dropdownRef.current?.contains(event.target as Node);
      const isClickInsideMenu = menuRef.current?.contains(event.target as Node);

      if (!isClickInsideDropdown && !isClickInsideMenu) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleToggle = () => {
    if (!disabled) {
      const newIsOpen = !isOpen;
      setIsOpen(newIsOpen);
      if (newIsOpen) {
        // Set initial hovered index to the first item when opening
        setHoveredIndex(0);
      }
    }
  };

  const handleSelect = (optionValue: string) => {
    onChange?.(optionValue);
    setIsOpen(false);
    setHoveredIndex(-1);
    // Return focus to trigger button after selection, but only if the dropdown
    // is part of the tab order. When tabIndex={-1} the dropdown is embedded in
    // a composite widget and stealing focus breaks the parent's keyboard handling.
    if (triggerRef.current && tabIndex !== -1) {
      triggerRef.current.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (isOpen) {
        // If dropdown is open and an item is hovered, select it
        if (hoveredIndex >= 0 && hoveredIndex < options.length) {
          handleSelect(options[hoveredIndex].value);
        }
      } else {
        // If dropdown is closed, open it
        handleToggle();
      }
    } else if (e.key === 'Escape' && isOpen) {
      // Only handle Escape if dropdown is open
      e.preventDefault();
      e.stopPropagation(); // Prevent Dialog from closing
      setIsOpen(false);
      setHoveredIndex(-1);
      // Return focus to the trigger button
      if (triggerRef.current) {
        triggerRef.current.focus();
      }
    } else if (e.key === 'ArrowDown' && isOpen) {
      // Only handle arrow keys when dropdown is already open
      e.preventDefault();
      setHoveredIndex((prev) => (prev < options.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp' && isOpen) {
      // Only handle arrow keys when dropdown is already open
      e.preventDefault();
      setHoveredIndex((prev) => (prev > 0 ? prev - 1 : prev));
    }
    // When dropdown is closed, arrow keys will be handled by parent (TabGroupField)
  };

  // Calculate menu position when dropdown opens and update on scroll
  useEffect(() => {
    const updatePosition = () => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setMenuPosition({
          top: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
        });
      }
    };

    if (isOpen) {
      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    } else {
      setMenuPosition(null);
    }
  }, [isOpen]);

  // Focus management: when dropdown opens, focus the menu
  useEffect(() => {
    if (isOpen && menuRef.current) {
      menuRef.current.focus();
    }
  }, [isOpen]);

  const { theme } = useTheme();

  const style = {
    '--dropdown-bg': '#FFFFFF',
    '--dropdown-border': theme.border.input.idle,
    '--dropdown-border-hover': theme.border.input.hover,
    '--dropdown-border-active': theme.border.focus,
    '--dropdown-text': theme.foreground.text.primary,
    '--dropdown-menu-bg': '#FFFFFF',
    '--dropdown-menu-shadow': '0px 10px 30px 0px rgba(20, 21, 26, 0.3)',
    '--dropdown-option-hover-bg': theme.background.surface.hover,
    '--dropdown-option-hover-outline': theme.border.focus,
    ...(width ? { width } : {}),
  } as React.CSSProperties;

  const getStateClass = () => {
    if (disabled) return 'dropdown--disabled';
    if (isOpen) return 'dropdown--active';
    return '';
  };

  return (
    <div
      ref={dropdownRef}
      className={`dropdown ${className}`}
      style={style}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`dropdown__trigger ${getStateClass()}`}
        onClick={handleToggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        tabIndex={tabIndex}
      >
        <span className="dropdown__text">{displayText}</span>
        <span className="dropdown__icon musescore-icon">{'\uEF12'}</span>
      </button>

      {isOpen && !disabled && menuPosition && createPortal(
        <div
          ref={menuRef}
          className="dropdown__menu"
          role="listbox"
          tabIndex={-1}
          style={{
            position: 'fixed',
            top: `${menuPosition.top}px`,
            left: `${menuPosition.left}px`,
            width: `${menuPosition.width}px`,
            '--dropdown-menu-bg': '#FFFFFF',
            '--dropdown-border': theme.border.input.idle,
            '--dropdown-menu-shadow': '0px 10px 30px 0px rgba(20, 21, 26, 0.3)',
            '--dropdown-text': theme.foreground.text.primary,
            '--dropdown-option-hover-bg': theme.background.surface.hover,
            '--dropdown-option-hover-outline': theme.border.focus,
          } as React.CSSProperties}
        >
          {options.map((option, index) => {
            if (option.disabled) {
              // Render separator for disabled items
              return (
                <div
                  key={option.value}
                  className="dropdown__separator"
                  role="separator"
                />
              );
            }
            return (
              <div
                key={option.value}
                className={`dropdown__option ${
                  option.value === value ? 'dropdown__option--selected' : ''
                } ${hoveredIndex === index ? 'dropdown__option--hover' : ''}`}
                onClick={() => handleSelect(option.value)}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(-1)}
                role="option"
                aria-selected={option.value === value}
              >
                {option.label}
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
};

export default Dropdown;
