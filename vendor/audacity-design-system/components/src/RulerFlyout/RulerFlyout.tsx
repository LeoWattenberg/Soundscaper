import React from 'react';
import { Icon } from '../Icon';
import { LabeledRadio } from '../LabeledRadio';
import { LabeledCheckbox } from '../LabeledCheckbox';
import { NumberStepper } from '../NumberStepper';
import { useTheme } from '../ThemeProvider';
import type { SpectrogramScale } from '../VerticalRuler/FrequencyRuler';
import './RulerFlyout.css';

/**
 * NumberStepper wrapper with local draft state.
 * Lets the user type freely; only validates + commits on blur, Enter,
 * or arrow-button clicks.
 */
function FreqStepper({ value, onCommit, min, max, step, width, className }: {
  value: number;
  onCommit: (n: number) => void;
  min: number;
  max: number;
  step: number;
  width?: number;
  className?: string;
}) {
  const [draft, setDraft] = React.useState(String(value));
  const ref = React.useRef<HTMLInputElement>(null);

  // Sync draft when external value changes (e.g. from arrow buttons on the other field)
  React.useEffect(() => { setDraft(String(value)); }, [value]);

  const tryCommit = (raw: string) => {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= min && n <= max) {
      onCommit(n);
    } else {
      setDraft(String(value)); // revert
    }
  };

  return (
    <div
      onBlur={() => tryCommit(draft)}
      onKeyDown={(e) => { if (e.key === 'Enter') tryCommit(draft); }}
    >
      <NumberStepper
        ref={ref}
        value={draft}
        onChange={(val) => {
          // Arrow buttons produce a clean integer — commit immediately
          const n = parseInt(val, 10);
          if (!isNaN(n) && n >= min && n <= max && /^-?\d+$/.test(val.trim())) {
            onCommit(n);
          }
          setDraft(val);
        }}
        min={min}
        max={max}
        step={step}
        width={width}
        className={className}
      />
    </div>
  );
}

export type WaveformRulerFormat = 'linear-amp' | 'logarithmic-db' | 'linear-db';

export interface RulerFlyoutProps {
  /** Whether the flyout is open */
  isOpen: boolean;
  /** Callback when flyout should close */
  onClose: () => void;
  /** X position in pixels */
  x: number;
  /** Y position in pixels */
  y: number;
  /** Ruler mode determines which options are shown */
  mode: 'waveform' | 'spectrogram';
  /** Current waveform ruler format (used when mode='waveform') */
  rulerFormat?: WaveformRulerFormat;
  /** Callback when waveform ruler format changes */
  onRulerFormatChange?: (format: WaveformRulerFormat) => void;
  /** Whether half wave display is enabled (used when mode='waveform') */
  halfWave?: boolean;
  /** Callback when half wave changes */
  onHalfWaveChange?: (enabled: boolean) => void;
  /** Current spectrogram scale (used when mode='spectrogram') */
  spectrogramScale?: SpectrogramScale;
  /** Callback when spectrogram scale changes */
  onSpectrogramScaleChange?: (scale: SpectrogramScale) => void;
  /** Minimum frequency in Hz (used when mode='spectrogram') */
  minFreq?: number;
  /** Callback when minimum frequency changes */
  onMinFreqChange?: (freq: number) => void;
  /** Maximum frequency in Hz (used when mode='spectrogram') */
  maxFreq?: number;
  /** Callback when maximum frequency changes */
  onMaxFreqChange?: (freq: number) => void;
  /** Callback for zoom in */
  onZoomIn?: () => void;
  /** Callback for zoom out */
  onZoomOut?: () => void;
  /** Callback for reset */
  onReset?: () => void;
  /** Ref to trigger element for focus restoration */
  triggerRef?: React.RefObject<HTMLElement>;
  /** Additional CSS class */
  className?: string;
}

const WAVEFORM_OPTIONS: { value: WaveformRulerFormat; label: string }[] = [
  { value: 'linear-amp', label: 'Linear (amp)' },
  { value: 'logarithmic-db', label: 'Logarithmic (dB)' },
  { value: 'linear-db', label: 'Linear (dB)' },
];

const SPECTROGRAM_OPTIONS: { value: SpectrogramScale; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'logarithmic', label: 'Logarithmic' },
  { value: 'mel', label: 'Mel' },
  { value: 'bark', label: 'Bark' },
  { value: 'erb', label: 'ERB' },
  { value: 'period', label: 'Period' },
];

/** Query focusable items within a group container */
function getGroupItems(group: HTMLElement): HTMLElement[] {
  return Array.from(
    group.querySelectorAll<HTMLElement>('button, input, [role="radio"], [role="checkbox"]')
  );
}

export const RulerFlyout: React.FC<RulerFlyoutProps> = ({
  isOpen,
  onClose,
  x,
  y,
  mode,
  rulerFormat = 'linear-amp',
  onRulerFormatChange,
  halfWave = false,
  onHalfWaveChange,
  spectrogramScale = 'mel',
  onSpectrogramScaleChange,
  minFreq = 10,
  onMinFreqChange,
  maxFreq = 22050,
  onMaxFreqChange,
  onZoomIn,
  onZoomOut,
  onReset,
  triggerRef,
  className = '',
}) => {
  const { theme } = useTheme();
  const flyoutRef = React.useRef<HTMLDivElement>(null);
  const zoomGroupRef = React.useRef<HTMLDivElement>(null);
  const radioGroupRef = React.useRef<HTMLDivElement>(null);
  const lastGroupRef = React.useRef<HTMLDivElement>(null);

  // Collect visible group refs
  const getGroups = React.useCallback((): HTMLDivElement[] => {
    return [zoomGroupRef.current, radioGroupRef.current, lastGroupRef.current]
      .filter((ref): ref is HTMLDivElement => ref !== null);
  }, []);

  // Click outside to close
  React.useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (flyoutRef.current && !flyoutRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  // Set up roving tabindex and focus first item when opened
  React.useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      const groups = getGroups();
      // Set roving tabindex: first item in first group gets 0, all others -1
      groups.forEach((group, groupIdx) => {
        const items = getGroupItems(group);
        items.forEach((item, itemIdx) => {
          if (groupIdx === 0 && itemIdx === 0) {
            item.setAttribute('tabindex', '0');
          } else if (itemIdx === 0 && groupIdx > 0) {
            // First item in non-first groups: tabbable but not initially focused
            item.setAttribute('tabindex', '0');
          } else {
            item.setAttribute('tabindex', '-1');
          }
        });
      });
      // Focus the active item in the radio group if it exists, otherwise first zoom button
      const radioGroup = radioGroupRef.current;
      if (radioGroup) {
        const checkedRadio = radioGroup.querySelector('[role="radio"][aria-checked="true"]') as HTMLElement;
        if (checkedRadio) {
          // Make checked radio the active item in its group
          const radios = getGroupItems(radioGroup);
          radios.forEach(r => r.setAttribute('tabindex', r === checkedRadio ? '0' : '-1'));
        }
      }
      // Focus first item in zoom group
      const firstGroup = groups[0];
      if (firstGroup) {
        const items = getGroupItems(firstGroup);
        items[0]?.focus();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen, getGroups]);

  // Escape to close
  React.useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        if (triggerRef?.current) {
          setTimeout(() => triggerRef.current?.focus(), 0);
        }
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose, triggerRef]);

  // Keyboard handler for tab group navigation
  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const groups = getGroups();

    // Find which group the target is in
    const currentGroupIndex = groups.findIndex(g => g.contains(target));
    if (currentGroupIndex === -1) return;

    const currentGroup = groups[currentGroupIndex];
    const items = getGroupItems(currentGroup);
    const currentItemIndex = items.indexOf(target);

    // Arrow keys: navigate within group
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (items.length <= 1) return;

      const direction = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
      const nextIndex = (currentItemIndex + direction + items.length) % items.length;

      // Update roving tabindex
      items[currentItemIndex].setAttribute('tabindex', '-1');
      items[nextIndex].setAttribute('tabindex', '0');
      items[nextIndex].focus();
      return;
    }

    // Tab / Shift+Tab: move between groups
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      const direction = e.shiftKey ? -1 : 1;
      const nextGroupIndex = (currentGroupIndex + direction + groups.length) % groups.length;
      const nextGroup = groups[nextGroupIndex];
      const nextItems = getGroupItems(nextGroup);

      // Focus the active (tabindex=0) item in the next group
      const activeItem = nextItems.find(el => el.getAttribute('tabindex') === '0') || nextItems[0];
      activeItem?.focus();
    }
  }, [getGroups]);

  if (!isOpen) return null;

  const style = {
    '--ruler-flyout-bg': theme.background.surface.default,
    '--ruler-flyout-border': theme.border.default,
    '--ruler-flyout-label': theme.foreground.text.primary,
    '--ruler-flyout-btn-color': theme.foreground.text.primary,
    '--ruler-flyout-recess-bg': theme.background.surface.elevated,
    '--ruler-flyout-recess-border': theme.border.default,
  } as React.CSSProperties;

  const triangleFill = theme.background.surface.default;

  // Determine which radio options to show
  const radioOptions = mode === 'waveform' ? WAVEFORM_OPTIONS : SPECTROGRAM_OPTIONS;
  const checkedValue = mode === 'waveform' ? rulerFormat : spectrogramScale;

  return (
    <div
      ref={flyoutRef}
      className={`ruler-flyout ${className}`}
      style={{
        ...style,
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        zIndex: 10000,
      }}
      onKeyDown={handleKeyDown}
    >
      {/* Triangle pointer (right side) */}
      <svg className="ruler-flyout__triangle" width="16" height="9" viewBox="0 0 16 9" fill="none">
        <path d="M8 0L16 9H0L8 0Z" fill={triangleFill} />
      </svg>

      <div className="ruler-flyout__content">
        {/* Group 1: Zoom controls */}
        <div ref={zoomGroupRef} className="ruler-flyout__toolbar" role="toolbar" aria-label="Zoom controls">
          <div className="ruler-flyout__toolbar-zoom">
            <button
              className="ruler-flyout__btn"
              aria-label="Zoom in"
              onClick={onZoomIn}
              tabIndex={-1}
            >
              <Icon name="zoom-in" size={16} />
            </button>
            <button
              className="ruler-flyout__btn"
              aria-label="Zoom out"
              onClick={onZoomOut}
              tabIndex={-1}
            >
              <Icon name="zoom-out" size={16} />
            </button>
          </div>
          <button
            className="ruler-flyout__btn ruler-flyout__btn--reset"
            aria-label="Reset zoom"
            onClick={onReset}
            tabIndex={-1}
          >
            <Icon name="refresh" size={16} />
            <span className="ruler-flyout__btn-label">Reset</span>
          </button>
        </div>

        {/* Group 2: Ruler format radio group */}
        <div className="ruler-flyout__format-section">
          <div className="ruler-flyout__section-label">Ruler format</div>
          <div ref={radioGroupRef} className="ruler-flyout__radio-group" role="radiogroup" aria-label="Ruler format">
            {radioOptions.map((opt) => (
              <LabeledRadio
                key={opt.value}
                label={opt.label}
                name="ruler-format"
                value={opt.value}
                checked={checkedValue === opt.value}
                onChange={() =>
                  mode === 'waveform'
                    ? onRulerFormatChange?.(opt.value as WaveformRulerFormat)
                    : onSpectrogramScaleChange?.(opt.value as SpectrogramScale)
                }
                tabIndex={-1}
              />
            ))}
          </div>
        </div>

        {/* Group 3: Mode-specific options */}
        {mode === 'spectrogram' ? (
          <div ref={lastGroupRef} className="ruler-flyout__freq-section">
            <div className="ruler-flyout__section-label">Frequency range</div>
            <div className="ruler-flyout__freq-row">
              <label className="ruler-flyout__freq-label">Min</label>
              <FreqStepper
                value={minFreq}
                onCommit={(n) => onMinFreqChange?.(n)}
                min={0}
                max={maxFreq - 1}
                step={10}
                width={80}
                className="ruler-flyout__freq-input"
              />
              <span className="ruler-flyout__freq-unit">Hz</span>
            </div>
            <div className="ruler-flyout__freq-row">
              <label className="ruler-flyout__freq-label">Max</label>
              <FreqStepper
                value={maxFreq}
                onCommit={(n) => onMaxFreqChange?.(n)}
                min={minFreq + 1}
                max={22050}
                step={100}
                width={80}
                className="ruler-flyout__freq-input"
              />
              <span className="ruler-flyout__freq-unit">Hz</span>
            </div>
          </div>
        ) : (
          <div ref={lastGroupRef} className="ruler-flyout__checkbox-section">
            <LabeledCheckbox
              label="Half wave"
              checked={halfWave}
              onChange={onHalfWaveChange}
              tabIndex={-1}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default RulerFlyout;
