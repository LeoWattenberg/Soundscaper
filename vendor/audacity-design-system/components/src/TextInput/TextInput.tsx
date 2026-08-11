/**
 * TextInput - Text input field component
 * Based on Figma design: node-id=3084-118526
 */

import React, { useState, useRef, useEffect } from 'react';
import { useTheme } from '../ThemeProvider';
import './TextInput.css';

export interface TextInputProps {
  /**
   * Input value
   */
  value?: string;
  /**
   * Default value for uncontrolled component
   */
  defaultValue?: string;
  /**
   * Placeholder text
   */
  placeholder?: string;
  /**
   * Whether the input is disabled
   */
  disabled?: boolean;
  /**
   * Whether the input has an error
   */
  error?: boolean;
  /**
   * Change handler
   */
  onChange?: (value: string) => void;
  /**
   * Focus handler
   */
  onFocus?: () => void;
  /**
   * Blur handler
   */
  onBlur?: () => void;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Input width
   */
  width?: number | string;
  /**
   * Input type
   */
  type?: 'text' | 'password' | 'email' | 'number';
  /**
   * Tab index for keyboard navigation
   */
  tabIndex?: number;
  /**
   * Whether to use a textarea for multi-line input
   */
  multiline?: boolean;
  /**
   * Maximum width for multiline input (triggers word wrap)
   */
  maxWidth?: number | string;
}

/**
 * TextInput component - Standard text input field
 */
export function TextInput({
  value,
  defaultValue,
  placeholder,
  disabled = false,
  error = false,
  onChange,
  onFocus,
  onBlur,
  className = '',
  width,
  type = 'text',
  tabIndex,
  multiline = false,
  maxWidth,
}: TextInputProps) {
  const { theme } = useTheme();
  const [internalValue, setInternalValue] = useState(defaultValue || '');
  const [isFocused, setIsFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : internalValue;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    if (!isControlled) {
      setInternalValue(newValue);
    }
    onChange?.(newValue);
  };

  const handleFocus = () => {
    setIsFocused(true);
    onFocus?.();
  };

  const handleBlur = () => {
    setIsFocused(false);
    onBlur?.();
  };

  // Auto-grow textarea height based on content
  useEffect(() => {
    if (multiline && textareaRef.current) {
      const textarea = textareaRef.current;
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [currentValue, multiline]);

  // Determine state class
  let stateClass = 'text-input--idle';
  if (disabled) {
    stateClass = 'text-input--disabled';
  } else if (isFocused) {
    stateClass = 'text-input--active';
  } else if (isHovered) {
    stateClass = 'text-input--hover';
  }

  // Determine type class
  const hasValue = currentValue.length > 0;
  const typeClass = error
    ? hasValue
      ? 'text-input--completed-error'
      : 'text-input--empty-error'
    : hasValue
    ? 'text-input--completed'
    : 'text-input--empty';

  const widthStyle = width ? (typeof width === 'number' ? `${width}px` : width) : undefined;
  const maxWidthStyle = maxWidth ? (typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth) : undefined;

  const style = {
    ...(widthStyle ? { width: widthStyle } : {}),
    ...(maxWidthStyle ? { maxWidth: maxWidthStyle } : {}),
    '--input-bg': theme.background.control.input.idle,
    '--input-border-idle': theme.border.default,
    '--input-hover-border-color': theme.border.input.hover,
    '--input-text-color': theme.foreground.text.primary,
    '--input-placeholder-color': theme.foreground.text.secondary,
    '--input-error-border': theme.border.error,
    '--input-caret-color': theme.foreground.text.primary,
    '--focus-border-color': theme.border.focus,
    '--focus-ring-color': theme.border.focus,
  } as React.CSSProperties;

  return (
    <div
      className={`text-input ${stateClass} ${typeClass} ${className} ${multiline ? 'text-input--multiline' : ''}`}
      style={style}
      onMouseEnter={() => !disabled && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {multiline ? (
        <textarea
          ref={textareaRef}
          value={currentValue}
          placeholder={placeholder}
          disabled={disabled}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className="text-input__field"
          tabIndex={tabIndex}
          rows={1}
          style={{
            resize: 'none',
            overflow: 'hidden',
            wordWrap: 'break-word',
          }}
        />
      ) : (
        <input
          ref={inputRef}
          type={type}
          value={currentValue}
          placeholder={placeholder}
          disabled={disabled}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className="text-input__field"
          tabIndex={tabIndex}
        />
      )}
    </div>
  );
}

export default TextInput;
