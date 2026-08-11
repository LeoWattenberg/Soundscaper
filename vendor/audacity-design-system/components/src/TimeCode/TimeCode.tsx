import React, { useState, useRef, useEffect, useCallback } from 'react';
import { TimeCodeDigit } from './TimeCodeDigit';
import { TimeCodeUnit } from './TimeCodeUnit';
import type { TimeCodeUnitType } from './TimeCodeUnit';
import { Icon } from '../Icon';
import { ContextMenu } from '../ContextMenu';
import { ContextMenuItem } from '../ContextMenuItem';
import { useTheme } from '../ThemeProvider';
import './TimeCode.css';
import './TimeCodeDigit.css';
import './TimeCodeUnit.css';

export type TimeCodeFormat =
  | 'dd:hh:mm:ss'
  | 'hh:mm:ss'
  | 'hh:mm:ss+hundredths'
  | 'hh:mm:ss+milliseconds'
  | 'hh:mm:ss+samples'
  | 'hh:mm:ss+frames'
  | 'samples'
  | 'seconds'
  | 'seconds+milliseconds'
  | 'film-frames'
  | 'beats:bars'
  | 'Hz';

export interface TimeCodeUnit {
  value: string;
  maxLength: number;
  max: number;
  label?: string;
}

export interface TimeCodeProps {
  /**
   * Current time value in seconds
   */
  value: number;
  /**
   * Format to display the timecode
   * @default 'hh:mm:ss'
   */
  format?: TimeCodeFormat;
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

interface TimeCodeSegment {
  value: string;
  type: 'unit' | 'separator' | 'label';
  unitType?: TimeCodeUnitType;
  maxLength?: number;
  max?: number;
  editable?: boolean;
}

/**
 * TimeCode component - Displays and edits time in various formats
 * Supports multiple time formats including SMPTE, samples, Hz, etc.
 */
export function TimeCode({
  value,
  format = 'hh:mm:ss',
  sampleRate = 44100,
  frameRate = 24,
  onChange,
  onFormatChange,
  showFormatSelector = true,
  disabled = false,
  variant = 'dark',
  className = '',
}: TimeCodeProps) {
  const { theme } = useTheme();
  const [isEditing, setIsEditing] = useState(false);
  const [editingDigitIndex, setEditingDigitIndex] = useState<number | null>(null);
  const [hoverDigitIndex, setHoverDigitIndex] = useState<number | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [menuOpenedViaKeyboard, setMenuOpenedViaKeyboard] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const digitRefsMap = useRef<Map<number, HTMLSpanElement>>(new Map());


  const segments = formatTimeToSegments(value, format, sampleRate, frameRate);
  const segmentsRef = useRef(segments);

  // Keep segmentsRef up to date
  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  const handleDigitClick = (digitGlobalIndex: number) => {
    if (disabled) return;
    setIsEditing(true);
    setEditingDigitIndex(digitGlobalIndex);
  };

  const handleDigitChange = useCallback((digitGlobalIndex: number, newDigitValue: string, autoAdvance = true) => {
    if (!onChange) return;

    // Find which segment and digit position this corresponds to
    let currentGlobalIndex = 0;
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

    // Create new segments with the updated digit
    const newSegments = [...segments];
    const targetSegment = newSegments[targetSegmentIndex];
    const newValue =
      targetSegment.value.substring(0, targetDigitPosition) +
      newDigitValue +
      targetSegment.value.substring(targetDigitPosition + 1);

    newSegments[targetSegmentIndex] = { ...targetSegment, value: newValue };

    // Convert segments back to seconds
    const newSeconds = segmentsToSeconds(newSegments, format, sampleRate, frameRate);
    onChange(newSeconds);

    // Move to next digit (only if autoAdvance is true)
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
  }, [onChange, segments, format, sampleRate, frameRate]);

  const handleFormatSelect = (newFormat: TimeCodeFormat) => {
    onFormatChange?.(newFormat);
    setShowMenu(false);
  };

  const openMenu = (viaKeyboard = false) => {
    if (disabled || !buttonRef.current) return;

    const rect = buttonRef.current.getBoundingClientRect();
    setMenuPosition({
      x: rect.left,
      y: rect.bottom + 4,
    });

    setMenuOpenedViaKeyboard(viaKeyboard);
    setShowMenu(!showMenu);
  };

  const handleMenuButtonClick = () => {
    openMenu(false);
  };

  // Handle keyboard input for editing digits
  useEffect(() => {
    if (!isEditing || editingDigitIndex === null || disabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Tab (with or without Shift): Exit edit mode and move to next/prev tab group
      if (e.key === 'Tab') {
        setIsEditing(false);
        setEditingDigitIndex(null);
        containerRef.current?.focus();
        // Don't preventDefault - let the browser handle Tab naturally
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
          handleDigitChange(editingDigitIndex, newDigitValue.toString(), false);
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
        setIsEditing(false);
        setEditingDigitIndex(null);
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
  }, [isEditing, editingDigitIndex, disabled, segments, handleDigitChange]);


  const caretColor = variant === 'light' ? theme.foreground.text.primary : '#f4f5f9';

  const style = {
    '--timecode-bg': variant === 'light' ? '#FFFFFF' : '#212433',
    '--timecode-text': variant === 'light' ? theme.foreground.text.primary : '#f4f5f9',
    '--timecode-hover': variant === 'light' ? 'rgba(0, 0, 0, 0.05)' : '#4a5068',
    '--timecode-border': variant === 'light' ? '#D4D5D9' : 'transparent',
    '--timecode-unit-bg': variant === 'light' ? '#FFFFFF' : '#212433',
    '--timecode-unit-text': variant === 'light' ? theme.foreground.text.primary : '#c5c6cd',
    '--timecode-unit-hover-bg': variant === 'light' ? 'rgba(0, 0, 0, 0.05)' : '#4a5068',
    '--timecode-unit-hover-text': variant === 'light' ? theme.foreground.text.primary : '#f4f5f9',
  } as React.CSSProperties;

  // Handle arrow key navigation within TimeCode
  const handleContainerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

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
      aria-label="Time code"
      tabIndex={0}
      onKeyDown={handleContainerKeyDown}
    >
      <div className="timecode__display">
        {segments.map((segment, index) => (
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

      {showFormatSelector && (
        <>
          <button
            ref={buttonRef}
            className="timecode__format-button"
            onClick={handleMenuButtonClick}
            disabled={disabled}
            tabIndex={-1}
          >
            <Icon name="caret-down" size={16} color={caretColor} />
          </button>

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
            <ContextMenuItem
              label="dd:hh:mm:ss"
              checked={format === 'dd:hh:mm:ss'}
              onClick={() => handleFormatSelect('dd:hh:mm:ss')}
            />
            <ContextMenuItem
              label="hh:mm:ss"
              checked={format === 'hh:mm:ss'}
              onClick={() => handleFormatSelect('hh:mm:ss')}
            />
            <ContextMenuItem
              label="hh:mm:ss + hundredths"
              checked={format === 'hh:mm:ss+hundredths'}
              onClick={() => handleFormatSelect('hh:mm:ss+hundredths')}
            />
            <ContextMenuItem
              label="hh:mm:ss + milliseconds"
              checked={format === 'hh:mm:ss+milliseconds'}
              onClick={() => handleFormatSelect('hh:mm:ss+milliseconds')}
            />
            <ContextMenuItem
              label="hh:mm:ss + samples"
              checked={format === 'hh:mm:ss+samples'}
              onClick={() => handleFormatSelect('hh:mm:ss+samples')}
            />
            <ContextMenuItem
              label="hh:mm:ss + frames (24fps)"
              checked={format === 'hh:mm:ss+frames'}
              onClick={() => handleFormatSelect('hh:mm:ss+frames')}
            />
            <ContextMenuItem
              label="samples"
              checked={format === 'samples'}
              onClick={() => handleFormatSelect('samples')}
            />
            <ContextMenuItem
              label="seconds"
              checked={format === 'seconds'}
              onClick={() => handleFormatSelect('seconds')}
            />
            <ContextMenuItem
              label="seconds + milliseconds"
              checked={format === 'seconds+milliseconds'}
              onClick={() => handleFormatSelect('seconds+milliseconds')}
            />
            <ContextMenuItem
              label="film frames (24fps)"
              checked={format === 'film-frames'}
              onClick={() => handleFormatSelect('film-frames')}
            />
            <ContextMenuItem
              label="beats:bars"
              checked={format === 'beats:bars'}
              onClick={() => handleFormatSelect('beats:bars')}
            />
            <ContextMenuItem
              label="Hz"
              checked={format === 'Hz'}
              onClick={() => handleFormatSelect('Hz')}
            />
          </ContextMenu>
        </>
      )}
    </div>
  );
}

function formatTimeToSegments(
  seconds: number,
  format: TimeCodeFormat,
  sampleRate: number,
  frameRate: number
): TimeCodeSegment[] {
  switch (format) {
    case 'dd:hh:mm:ss':
      return formatDDHHMMSS(seconds);
    case 'hh:mm:ss':
      return formatHHMMSS(seconds);
    case 'hh:mm:ss+hundredths':
      return formatHHMMSSHundredths(seconds);
    case 'hh:mm:ss+milliseconds':
      return formatHHMMSSMilliseconds(seconds);
    case 'hh:mm:ss+samples':
      return formatHHMMSSSamples(seconds, sampleRate);
    case 'hh:mm:ss+frames':
      return formatHHMMSSFrames(seconds, frameRate);
    case 'samples':
      return formatSamples(seconds, sampleRate);
    case 'seconds':
      return formatSeconds(seconds);
    case 'seconds+milliseconds':
      return formatSecondsMilliseconds(seconds);
    case 'film-frames':
      return formatFilmFrames(seconds, frameRate);
    case 'beats:bars':
      return formatBeatsBar(seconds);
    case 'Hz':
      return formatHz(seconds);
    default:
      return formatHHMMSS(seconds);
  }
}

function pad(num: number, length: number): string {
  return num.toString().padStart(length, '0');
}

function formatDDHHMMSS(seconds: number): TimeCodeSegment[] {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return [
    { value: pad(days, 2), type: 'unit', maxLength: 2, max: 99, editable: true },
    { value: 'd', type: 'label', unitType: 'days' },
    { value: pad(hours, 2), type: 'unit', maxLength: 2, max: 23, editable: true },
    { value: 'h', type: 'label', unitType: 'hours' },
    { value: pad(minutes, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 'm', type: 'label', unitType: 'minutes' },
    { value: pad(secs, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 's', type: 'label', unitType: 'seconds' },
  ];
}

function formatHHMMSS(seconds: number): TimeCodeSegment[] {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return [
    { value: pad(hours, 2), type: 'unit', maxLength: 2, max: 99, editable: true },
    { value: 'h', type: 'label', unitType: 'hours' },
    { value: pad(minutes, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 'm', type: 'label', unitType: 'minutes' },
    { value: pad(secs, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 's', type: 'label', unitType: 'seconds' },
  ];
}

function formatHHMMSSHundredths(seconds: number): TimeCodeSegment[] {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const hundredths = Math.floor((seconds % 1) * 100);

  return [
    { value: pad(hours, 2), type: 'unit', maxLength: 2, max: 99, editable: true },
    { value: 'h', type: 'label', unitType: 'hours' },
    { value: pad(minutes, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 'm', type: 'label', unitType: 'minutes' },
    { value: pad(secs, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: '.', type: 'separator' },
    { value: pad(hundredths, 2), type: 'unit', maxLength: 2, max: 99, editable: true },
    { value: 's', type: 'label', unitType: 'seconds' },
  ];
}

function formatHHMMSSMilliseconds(seconds: number): TimeCodeSegment[] {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);

  return [
    { value: pad(hours, 2), type: 'unit', maxLength: 2, max: 99, editable: true },
    { value: 'h', type: 'label', unitType: 'hours' },
    { value: pad(minutes, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 'm', type: 'label', unitType: 'minutes' },
    { value: pad(secs, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: '.', type: 'separator' },
    { value: pad(milliseconds, 3), type: 'unit', maxLength: 3, max: 999, editable: true },
    { value: 's', type: 'label', unitType: 'seconds' },
  ];
}

function formatHHMMSSSamples(seconds: number, sampleRate: number): TimeCodeSegment[] {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const samples = Math.floor((seconds % 1) * sampleRate);

  return [
    { value: pad(hours, 2), type: 'unit', maxLength: 2, max: 99, editable: true },
    { value: 'h', type: 'label', unitType: 'hours' },
    { value: pad(minutes, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 'm', type: 'label', unitType: 'minutes' },
    { value: pad(secs, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 's', type: 'label', unitType: 'seconds' },
    { value: pad(samples, 5), type: 'unit', maxLength: 5, max: sampleRate - 1, editable: true },
    { value: 'samples', type: 'label', unitType: 'samples' },
  ];
}

function formatHHMMSSFrames(seconds: number, frameRate: number): TimeCodeSegment[] {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const frames = Math.floor((seconds % 1) * frameRate);

  return [
    { value: pad(hours, 2), type: 'unit', maxLength: 2, max: 99, editable: true },
    { value: 'h', type: 'label', unitType: 'hours' },
    { value: pad(minutes, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 'm', type: 'label', unitType: 'minutes' },
    { value: pad(secs, 2), type: 'unit', maxLength: 2, max: 59, editable: true },
    { value: 's', type: 'label', unitType: 'seconds' },
    { value: pad(frames, 2), type: 'unit', maxLength: 2, max: frameRate - 1, editable: true },
    { value: 'frames', type: 'label', unitType: 'frames' },
  ];
}

function formatSamples(seconds: number, sampleRate: number): TimeCodeSegment[] {
  const totalSamples = Math.floor(seconds * sampleRate);
  const samplesStr = totalSamples.toString();

  // Add commas for thousands separators
  const parts: TimeCodeSegment[] = [];
  const groups = [];

  for (let i = samplesStr.length - 1, group = ''; i >= 0; i--) {
    group = samplesStr[i] + group;
    if (group.length === 3 || i === 0) {
      groups.unshift(group);
      group = '';
    }
  }

  groups.forEach((group, index) => {
    parts.push({ value: group, type: 'unit', editable: true });
    if (index < groups.length - 1) {
      parts.push({ value: ',', type: 'separator' });
    }
  });

  parts.push({ value: 'samples', type: 'label', unitType: 'samples' });

  return parts.length ? parts : [{ value: '0', type: 'unit', editable: true }, { value: 'samples', type: 'label', unitType: 'samples' }];
}

function formatSeconds(seconds: number): TimeCodeSegment[] {
  const totalSeconds = Math.floor(seconds);
  // Pad to at least 6 digits (000,000)
  const secondsStr = totalSeconds.toString().padStart(6, '0');

  // Add commas for thousands separators
  const parts: TimeCodeSegment[] = [];
  const groups = [];

  for (let i = secondsStr.length - 1, group = ''; i >= 0; i--) {
    group = secondsStr[i] + group;
    if (group.length === 3 || i === 0) {
      groups.unshift(group);
      group = '';
    }
  }

  groups.forEach((group, index) => {
    parts.push({ value: group, type: 'unit', editable: true });
    if (index < groups.length - 1) {
      parts.push({ value: ',', type: 'separator' });
    }
  });

  parts.push({ value: 'seconds', type: 'label', unitType: 'seconds' });

  return parts;
}

function formatSecondsMilliseconds(seconds: number): TimeCodeSegment[] {
  const totalSeconds = Math.floor(seconds);
  const milliseconds = Math.floor((seconds % 1) * 1000);
  const secondsStr = totalSeconds.toString();

  // Add commas for thousands separators
  const parts: TimeCodeSegment[] = [];
  const groups = [];

  for (let i = secondsStr.length - 1, group = ''; i >= 0; i--) {
    group = secondsStr[i] + group;
    if (group.length === 3 || i === 0) {
      groups.unshift(group);
      group = '';
    }
  }

  groups.forEach((group, index) => {
    parts.push({ value: group, type: 'unit', editable: true });
    if (index < groups.length - 1) {
      parts.push({ value: ',', type: 'separator' });
    }
  });

  parts.push({ value: '.', type: 'separator' });
  parts.push({ value: pad(milliseconds, 3), type: 'unit', maxLength: 3, max: 999, editable: true });
  parts.push({ value: 'seconds', type: 'label', unitType: 'seconds' });

  return parts;
}

function formatFilmFrames(seconds: number, frameRate: number): TimeCodeSegment[] {
  const totalFrames = Math.floor(seconds * frameRate);
  const framesStr = totalFrames.toString();

  // Add commas for thousands separators
  const parts: TimeCodeSegment[] = [];
  const groups = [];

  for (let i = framesStr.length - 1, group = ''; i >= 0; i--) {
    group = framesStr[i] + group;
    if (group.length === 3 || i === 0) {
      groups.unshift(group);
      group = '';
    }
  }

  groups.forEach((group, index) => {
    parts.push({ value: group, type: 'unit', editable: true });
    if (index < groups.length - 1) {
      parts.push({ value: ',', type: 'separator' });
    }
  });

  return parts.length ? parts : [{ value: '0', type: 'unit', editable: true }];
}

function formatBeatsBar(seconds: number): TimeCodeSegment[] {
  // Assuming 120 BPM and 4/4 time signature for now
  const bpm = 120;
  const beatsPerBar = 4;
  const secondsPerBeat = 60 / bpm;

  const totalBeats = Math.floor(seconds / secondsPerBeat);
  const bars = Math.floor(totalBeats / beatsPerBar);
  const beats = totalBeats % beatsPerBar;

  return [
    { value: pad(bars, 3), type: 'unit', maxLength: 3, max: 999, editable: true },
    { value: (beats + 1).toString(), type: 'unit', maxLength: 1, max: beatsPerBar, editable: true },
  ];
}

function formatHz(seconds: number): TimeCodeSegment[] {
  // This is a placeholder - actual Hz calculation would depend on the context
  const frequency = seconds > 0 ? 1 / seconds : 0;
  const hz = frequency.toFixed(2);
  const [intPart, decPart] = hz.split('.');

  return [
    { value: intPart, type: 'unit', editable: true },
    { value: '.', type: 'separator' },
    { value: decPart, type: 'unit', editable: true },
    { value: ' Hz', type: 'separator' },
  ];
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

// Helper function to convert segments back to seconds
function segmentsToSeconds(
  segments: TimeCodeSegment[],
  format: TimeCodeFormat,
  sampleRate: number,
  frameRate: number
): number {
  // Extract unit values from segments
  const unitValues: number[] = [];
  for (const segment of segments) {
    if (segment.type === 'unit') {
      unitValues.push(parseInt(segment.value, 10) || 0);
    }
  }

  switch (format) {
    case 'dd:hh:mm:ss': {
      const [days, hours, minutes, seconds] = unitValues;
      return (days || 0) * 86400 + (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0);
    }
    case 'hh:mm:ss': {
      const [hours, minutes, seconds] = unitValues;
      return (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0);
    }
    case 'hh:mm:ss+hundredths': {
      const [hours, minutes, seconds, hundredths] = unitValues;
      return (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0) + (hundredths || 0) / 100;
    }
    case 'hh:mm:ss+milliseconds': {
      const [hours, minutes, seconds, milliseconds] = unitValues;
      return (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0) + (milliseconds || 0) / 1000;
    }
    case 'hh:mm:ss+samples': {
      const [hours, minutes, seconds, samples] = unitValues;
      return (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0) + (samples || 0) / sampleRate;
    }
    case 'hh:mm:ss+frames': {
      const [hours, minutes, seconds, frames] = unitValues;
      return (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0) + (frames || 0) / frameRate;
    }
    case 'samples': {
      // Sum all unit values (handling comma-separated groups)
      const totalSamples = unitValues.reduce((sum, val) => sum * 1000 + val, 0);
      return totalSamples / sampleRate;
    }
    case 'seconds': {
      // Sum all unit values (handling comma-separated groups)
      return unitValues.reduce((sum, val) => sum * 1000 + val, 0);
    }
    case 'seconds+milliseconds': {
      // All but last value are seconds groups, last is milliseconds
      const milliseconds = unitValues.pop() || 0;
      const seconds = unitValues.reduce((sum, val) => sum * 1000 + val, 0);
      return seconds + milliseconds / 1000;
    }
    case 'film-frames': {
      const totalFrames = unitValues.reduce((sum, val) => sum * 1000 + val, 0);
      return totalFrames / frameRate;
    }
    case 'beats:bars': {
      const [bars, beats] = unitValues;
      const bpm = 120;
      const beatsPerBar = 4;
      const secondsPerBeat = 60 / bpm;
      return ((bars || 0) * beatsPerBar + (beats || 1) - 1) * secondsPerBeat;
    }
    case 'Hz': {
      const [intPart, decPart] = unitValues;
      const frequency = parseFloat(`${intPart || 0}.${decPart || 0}`);
      return frequency > 0 ? 1 / frequency : 0;
    }
    default:
      return 0;
  }
}
