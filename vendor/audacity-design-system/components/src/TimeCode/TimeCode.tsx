import React, { useState, useRef, useEffect, useCallback, useContext } from 'react';
import { TimeCodeDigit } from './TimeCodeDigit';
import { TimeCodeUnit } from './TimeCodeUnit';
import { Icon } from '../Icon';
import { ContextMenu } from '../ContextMenu';
import { useTimeCodeSubmenuPosition } from './useTimeCodeSubmenuPosition';
import { TimeCodeFormatMenuItems } from './TimeCodeFormatMenuItems';
import { useTheme } from '../ThemeProvider';
import { TimeCodeMusicalContext } from './time-code-musical-context';
import { timeCodePreviousMusicalBeat } from './time-code-musical-step';
import { formatTimeToSegments, segmentsToSeconds, type TimeCodeSegment } from './time-code-segments';
import { useTimeCodeText } from './useTimeCodeText';
import { ContextMenuItem } from '../ContextMenuItem/ContextMenuItem';
import './TimeCode.css';
import './TimeCodeDigit.css';
import './TimeCodeUnit.css';

import { timeCodeFormatOptionsForDomain, type TimeCodeFormat, type TimeCodeFormatDomain } from './time-code-formats';
export { timeCodeFormatOptionsForDomain, type TimeCodeFormat, type TimeCodeFormatDomain, type TimeCodeFormatOption } from './time-code-formats';

export interface TimeCodeUnit {
  value: string;
  maxLength: number;
  max: number;
  label?: string;
}

export interface TimeCodeProps {
  /** Accessible name for this editable time value. */
  ariaLabel?: string;
  /** Accessible name for the optional format menu button. */
  formatAriaLabel?: string;
  /** Optional localized description of the rendered digit groups. */
  ariaDescription?: string;
  /** IDs of explanatory content for this editable time value. */
  ariaDescribedBy?: string;
  /**
   * Current time value in seconds
   */
  value: number;
  /**
   * Format to display the timecode
   * @default 'hh:mm:ss'
   */
  format?: TimeCodeFormat;
  /** Value domain used to constrain the format selector. */
  formatDomain?: TimeCodeFormatDomain;
  /**
   * Sample rate for sample-based formats
   * @default 44100
   */
  sampleRate?: number;
  /**
   * Frame rate for frame-based formats
   * @default 24
   */
  frameRate?: number;
  /**
   * Callback when value changes
   */
  onChange?: (value: number) => void;
  /** Confirm the current value when digit editing ends with Enter. */
  onCommit?: () => void;
  /**
   * Callback when format changes
   */
  onFormatChange?: (format: TimeCodeFormat) => void;
  /**
   * Show format selector dropdown
   * @default true
   */
  showFormatSelector?: boolean;
  /**
   * Disabled state
   * @default false
   */
  disabled?: boolean;
  /**
   * Visual variant
   * - dark: Dark background with light text (transport controls)
   * - light: Light background with dark text (label editor)
   * @default 'dark'
   */
  variant?: 'dark' | 'light';
  /**
   * Optional className for custom styling
   */
  className?: string;
}

/**
 * TimeCode component - Displays and edits time in various formats
 * Supports multiple time formats including SMPTE, samples, Hz, etc.
 */
export function TimeCode({
  ariaLabel = 'Time code',
  formatAriaLabel = 'Time code format',
  ariaDescription,
  ariaDescribedBy,
  value,
  format = 'hh:mm:ss',
  formatDomain = format === 'Hz' ? 'frequency' : 'time',
  sampleRate = 44100,
  frameRate = 24,
  onChange,
  onCommit,
  onFormatChange,
  showFormatSelector = true,
  disabled = false,
  variant = 'dark',
  className = '',
}: TimeCodeProps) {
  const { theme } = useTheme();
  const musicalMap = useContext(TimeCodeMusicalContext);
  const formatOptions = timeCodeFormatOptionsForDomain(formatDomain, frameRate);
  const [isEditing, setIsEditing] = useState(false);
  const [editingDigitIndex, setEditingDigitIndex] = useState<number | null>(null);
  const [hoverDigitIndex, setHoverDigitIndex] = useState<number | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [menuOpenedViaKeyboard, setMenuOpenedViaKeyboard] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const digitRefsMap = useRef<Map<number, HTMLSpanElement>>(new Map());
  useTimeCodeSubmenuPosition(containerRef, showMenu);


  const segments = formatTimeToSegments(value, format, sampleRate, frameRate, musicalMap);
  const segmentsRef = useRef(segments);
  const textEntry = useTimeCodeText({ value, format, sampleRate, disabled, ariaLabel, onChange, onCommit, containerRef });

  // Keep segmentsRef up to date
  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  const handleDigitClick = (digitGlobalIndex: number) => {
    if (disabled) return;
    setIsEditing(true);
    setEditingDigitIndex(digitGlobalIndex);
  };

  const handleDigitChange = useCallback((digitGlobalIndex: number, newDigitValue: string, autoAdvance = true, stepBack = false) => {
    if (!onChange) return;

    let targetSegmentIndex = -1;
    let targetDigitPosition = -1;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment.type !== 'unit') continue;

      const segmentLength = segment.value.length;
      for (let j = 0; j < segmentLength; j++) {
        const thisGlobalIndex = i * 100 + j;
        if (thisGlobalIndex === digitGlobalIndex) {
          targetSegmentIndex = i;
          targetDigitPosition = j;
          break;
        }
      }
      if (targetSegmentIndex !== -1) break;
    }

    if (targetSegmentIndex === -1) return;

    const newSegments = [...segments];
    const targetSegment = newSegments[targetSegmentIndex];
    const newValue =
      targetSegment.value.substring(0, targetDigitPosition) +
      newDigitValue +
      targetSegment.value.substring(targetDigitPosition + 1);

    newSegments[targetSegmentIndex] = { ...targetSegment, value: newValue };

    const newSeconds = stepBack && format === 'beats:bars' && targetSegmentIndex === 1
      && Number(targetSegment.value) === 1 && targetDigitPosition === targetSegment.value.length - 1
      ? timeCodePreviousMusicalBeat(value, musicalMap)
      : value + segmentsToSeconds(newSegments, format, sampleRate, frameRate, musicalMap)
        - segmentsToSeconds(segments, format, sampleRate, frameRate, musicalMap);
    onChange(newSeconds);

    if (autoAdvance) {
      const nextDigitIndex = findNextEditableDigit(digitGlobalIndex, segments);
      if (nextDigitIndex !== null) {
        const nextDigitElement = digitRefsMap.current.get(nextDigitIndex);
        if (nextDigitElement) {
          nextDigitElement.focus();
        }
        setEditingDigitIndex(nextDigitIndex);
      }
    }
  }, [onChange, value, segments, format, sampleRate, frameRate, musicalMap]);

  const handleFormatSelect = (newFormat: TimeCodeFormat) => {
    onFormatChange?.(newFormat);
    setShowMenu(false);
  };

  const openMenu = useCallback((viaKeyboard = false) => {
    if (disabled || !containerRef.current) return;
    setIsEditing(false);
    setEditingDigitIndex(null);

    const rect = (buttonRef.current ?? containerRef.current).getBoundingClientRect();
    setMenuPosition({
      x: rect.left,
      y: rect.bottom + 4,
    });

    setMenuOpenedViaKeyboard(viaKeyboard);
    setShowMenu(!showMenu);
  }, [disabled, showMenu]);

  const handleMenuButtonClick = () => {
    openMenu(false);
  };

  // Handle keyboard input for editing digits
  useEffect(() => {
    if (!isEditing || editingDigitIndex === null || disabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!containerRef.current?.contains(document.activeElement?.closest('.timecode-digit') ?? null)) return;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Tab') {
        setIsEditing(false);
        setEditingDigitIndex(null);
        containerRef.current?.focus();
        return;
      }

      // Number keys (0-9)
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        e.stopPropagation();
        handleDigitChange(editingDigitIndex, e.key);
      }
      // Arrow Up/Down: Increment/decrement digit value
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();

        // Use segmentsRef to get the latest segments value
        const currentSegments = segmentsRef.current;

        // Find the current digit's segment and value
        let targetSegmentIndex = -1;
        let targetDigitPosition = -1;

        for (let i = 0; i < currentSegments.length; i++) {
          const segment = currentSegments[i];
          if (segment.type !== 'unit') continue;

          for (let j = 0; j < segment.value.length; j++) {
            const globalIndex = i * 100 + j;
            if (globalIndex === editingDigitIndex) {
              targetSegmentIndex = i;
              targetDigitPosition = j;
              break;
            }
          }
          if (targetSegmentIndex !== -1) break;
        }

        if (targetSegmentIndex !== -1) {
          const targetSegment = currentSegments[targetSegmentIndex];
          const currentDigitValue = parseInt(targetSegment.value[targetDigitPosition], 10);

          // Increment or decrement with wrapping 0-9
          let newDigitValue: number;
          if (e.key === 'ArrowUp') {
            newDigitValue = (currentDigitValue + 1) % 10;
          } else {
            newDigitValue = (currentDigitValue - 1 + 10) % 10;
          }

          // Don't auto-advance when using up/down arrows
          handleDigitChange(editingDigitIndex, newDigitValue.toString(), false, e.key === 'ArrowDown');
        }
      }
      // Arrow Right: Move to next digit, wrap to first
      else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        const currentSegments = segmentsRef.current;
        let nextIndex = findNextEditableDigit(editingDigitIndex, currentSegments);
        // Wrap around to first digit if at the end
        if (nextIndex === null) {
          nextIndex = findNextEditableDigit(-1, currentSegments);
        }
        if (nextIndex !== null) {
          const nextDigitElement = digitRefsMap.current.get(nextIndex);
          if (nextDigitElement) {
            nextDigitElement.focus();
            setEditingDigitIndex(nextIndex);
          }
        }
      }
      // Arrow Left: Move to previous digit, wrap to last
      else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        const currentSegments = segmentsRef.current;
        let prevIndex = findPreviousEditableDigit(editingDigitIndex, currentSegments);
        // Wrap around to last digit if at the beginning
        if (prevIndex === null) {
          prevIndex = findLastEditableDigit(currentSegments);
        }
        if (prevIndex !== null) {
          const prevDigitElement = digitRefsMap.current.get(prevIndex);
          if (prevDigitElement) {
            prevDigitElement.focus();
            setEditingDigitIndex(prevIndex);
          }
        }
      }
      // Shift+F10: Open format dropdown menu while editing
      else if (e.key === 'F10' && e.shiftKey && showFormatSelector) {
        e.preventDefault();
        e.stopPropagation();
        openMenu(true);
      }
      // Escape to exit editing and return focus to container
      else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsEditing(false);
        setEditingDigitIndex(null);
        containerRef.current?.focus();
      }
      // Enter to confirm and exit, return focus to container
      else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        setIsEditing(false);
        setEditingDigitIndex(null);
        containerRef.current?.focus();
        onCommit?.();
      }
    };

    const handleClick = (e: MouseEvent) => {
      // Click outside to exit editing
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsEditing(false);
        setEditingDigitIndex(null);
      }
    };

    // Use capture phase to intercept Tab before browser navigation
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('click', handleClick);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('click', handleClick);
    };
  }, [isEditing, editingDigitIndex, disabled, segments, handleDigitChange, onCommit, openMenu, showFormatSelector]);


  const caretColor = variant === 'light' ? theme.foreground.text.primary : '#f4f5f9';

  const style = {
    // Dark-variant chip background is theme-aware: #212433 in the light app
    // theme (unchanged) and #171F25 in dark. The light variant (label editor)
    // stays white.
    '--timecode-bg': variant === 'light' ? '#FFFFFF' : theme.background.control.timecode.idle,
    '--timecode-text': variant === 'light' ? theme.foreground.text.primary : '#f4f5f9',
    '--timecode-hover': variant === 'light' ? 'rgba(0, 0, 0, 0.05)' : '#4a5068',
    '--timecode-border': variant === 'light' ? '#D4D5D9' : 'transparent',
    '--timecode-unit-bg': variant === 'light' ? '#FFFFFF' : theme.background.control.timecode.idle,
    '--timecode-unit-text': variant === 'light' ? theme.foreground.text.primary : '#c5c6cd',
    '--timecode-unit-hover-bg': variant === 'light' ? 'rgba(0, 0, 0, 0.05)' : '#4a5068',
    '--timecode-unit-hover-text': variant === 'light' ? theme.foreground.text.primary : '#f4f5f9',
  } as React.CSSProperties;

  // Handle arrow key navigation within TimeCode
  const handleContainerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;

    // Only handle keys when the container itself is focused (not bubbling from children)
    if (e.target !== e.currentTarget) return;

    // Space/Enter: Enter first digit for editing
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const currentSegments = segmentsRef.current;
      const firstDigitIndex = findNextEditableDigit(-1, currentSegments);
      if (firstDigitIndex !== null) {
        const firstDigitElement = digitRefsMap.current.get(firstDigitIndex);
        if (firstDigitElement) {
          firstDigitElement.focus();
          setIsEditing(true);
          setEditingDigitIndex(firstDigitIndex);
        }
      }
    }
    // Shift+F10: Open format dropdown menu
    else if (e.key === 'F10' && e.shiftKey && showFormatSelector) {
      e.preventDefault();
      e.stopPropagation();
      openMenu(true);
    }
    // Let arrow keys bubble up to Toolbar for navigation between toolbar items
    // (Don't preventDefault on arrow keys here - let Toolbar handle them)
  };

  return (
    <div
      ref={containerRef}
      className={`timecode timecode--${variant} ${disabled ? 'timecode--disabled' : ''} ${className}`}
      style={style}
      role="group"
      aria-label={ariaLabel}
      aria-disabled={disabled}
      aria-description={ariaDescription}
      aria-describedby={ariaDescribedBy}
      tabIndex={disabled ? -1 : 0}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); openMenu(true); }}
      onKeyDown={handleContainerKeyDown} onClickCapture={(event) => { if ((event.target as Element | null)?.tagName !== 'INPUT') event.preventDefault(); }}
    >
      <div className="timecode__display" onDoubleClick={textEntry.begin}>
        {textEntry.input ?? segments.map((segment, index) => (
          <React.Fragment key={index}>
            {segment.type === 'unit' ? (
              // Render each digit character separately for proper styling
              segment.value.split('').map((digit, digitIndex) => {
                const digitGlobalIndex = index * 100 + digitIndex; // Unique index for each digit
                const digitState =
                  editingDigitIndex === digitGlobalIndex ? 'active' :
                  hoverDigitIndex === digitGlobalIndex && !disabled ? 'hover' :
                  'default';

                return (
                  <TimeCodeDigit
                    key={digitGlobalIndex}
                    ref={(el) => {
                      if (el && segment.editable) {
                        digitRefsMap.current.set(digitGlobalIndex, el);
                      }
                    }}
                    value={digit}
                    state={digitState}
                    editable={segment.editable && !disabled}
                    onClick={() => handleDigitClick(digitGlobalIndex)}
                    onMouseEnter={() => setHoverDigitIndex(digitGlobalIndex)}
                    onMouseLeave={() => setHoverDigitIndex(null)}
                    tabIndex={-1}
                  />
                );
              })
            ) : segment.type === 'label' && segment.unitType ? (
              <TimeCodeUnit unit={segment.unitType} />
            ) : (
              <span className="timecode__separator">{segment.value}</span>
            )}
          </React.Fragment>
        ))}
      </div>

      <>
          {showFormatSelector && <button
            type="button"
            ref={buttonRef}
            className="timecode__format-button"
            onClick={handleMenuButtonClick}
            disabled={disabled}
            tabIndex={-1}
            aria-label={formatAriaLabel}
          >
            <Icon name="caret-down" size={16} color={caretColor} />
          </button>}

          <ContextMenu
            isOpen={showMenu}
            onClose={() => {
              setShowMenu(false);
              // When closing menu, restore focus to TimeCode container
              if (menuOpenedViaKeyboard && containerRef.current) {
                setTimeout(() => {
                  // Restore tabIndex to 0 so Toolbar's roving tabindex works
                  if (containerRef.current) {
                    containerRef.current.tabIndex = 0;
                    containerRef.current.focus();
                  }
                }, 0);
              }
              setMenuOpenedViaKeyboard(false);
            }}
            x={menuPosition.x}
            y={menuPosition.y}
            autoFocus={menuOpenedViaKeyboard}
          >
            {onChange && <ContextMenuItem label="Enter value…" onClick={textEntry.begin} onClose={() => setShowMenu(false)} />}
            <TimeCodeFormatMenuItems options={formatOptions} format={format} onSelect={handleFormatSelect} />
          </ContextMenu>
        </>
    </div>
  );
}

// Helper function to find the next editable digit
function findNextEditableDigit(currentIndex: number, segments: TimeCodeSegment[]): number | null {
  // Special case: -1 means find the first editable digit
  if (currentIndex === -1) {
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment.type !== 'unit' || !segment.editable) continue;

      for (let j = 0; j < segment.value.length; j++) {
        return i * 100 + j;
      }
    }
    return null;
  }

  let foundCurrent = false;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.type !== 'unit' || !segment.editable) continue;

    for (let j = 0; j < segment.value.length; j++) {
      const globalIndex = i * 100 + j;

      if (foundCurrent) {
        return globalIndex;
      }

      if (globalIndex === currentIndex) {
        foundCurrent = true;
      }
    }
  }

  return null;
}

// Helper function to find the previous editable digit
function findPreviousEditableDigit(currentIndex: number, segments: TimeCodeSegment[]): number | null {
  let previousIndex: number | null = null;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.type !== 'unit' || !segment.editable) continue;

    for (let j = 0; j < segment.value.length; j++) {
      const globalIndex = i * 100 + j;

      if (globalIndex === currentIndex) {
        return previousIndex;
      }

      previousIndex = globalIndex;
    }
  }

  return null;
}

// Helper function to find the last editable digit
function findLastEditableDigit(segments: TimeCodeSegment[]): number | null {
  let lastIndex: number | null = null;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.type !== 'unit' || !segment.editable) continue;

    for (let j = 0; j < segment.value.length; j++) {
      lastIndex = i * 100 + j;
    }
  }

  return lastIndex;
}
