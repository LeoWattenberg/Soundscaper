/** Playback-speed UI selectively ported from upstream 20ce5547; host guards and labels retained. */
import React from 'react';
import { useTheme } from '../ThemeProvider';
import { Slider } from '../Slider';
import { useValueContextMenu } from '../hooks/useValueContextMenu';
import { ManualValueDialog } from '../ManualValueDialog/ManualValueDialog';
import './VarispeedControl.css';

/** AU3's range: SPEED_SLIDER 0.01..3.0 */
export const VARISPEED_MIN = 0.01;
export const VARISPEED_MAX = 3;
/** What a switch would turn on to before the user has set a speed — the
 *  transcriber's half speed (the chip days; kept for hosts) */
export const VARISPEED_DEFAULT_SPEED = 0.5;
export const VARISPEED_PRESETS: ReadonlyArray<{ label: string; speed: number }> = [
  { label: '½×', speed: 0.5 },
  { label: '1×', speed: 1 },
  { label: '2×', speed: 2 },
];

const clampSpeed = (speed: number) => Math.max(VARISPEED_MIN, Math.min(VARISPEED_MAX, speed));
/** The slider is linear in hundredths of a speed (1–300) — whole percents */
export const speedToSlider = (speed: number) => Math.round(clampSpeed(speed) * 100);
export const sliderToSpeed = (v: number) => clampSpeed(v / 100);
/** Where 1× sits along the track, as a fraction (the mark that stood there is gone, 2026-10-15) */
export const VARISPEED_UNITY_FRACTION = (1 - VARISPEED_MIN) / (VARISPEED_MAX - VARISPEED_MIN);
/** The readout: whole percents — "100%", "87%", "300%" (2026-10-15) */
export const formatVarispeedPercent = (speed: number) => `${speedToSlider(speed)}%`;
/** AU3's "%.3fx" form, for hosts that still say it in × */
export const formatVarispeed = (speed: number) => `${speed.toFixed(3)}×`;
/** The digits alone of the × form */
export const formatVarispeedDigits = (speed: number) => speed.toFixed(3);
/** A typed value: "0.875", "0,875", "0.875×", "87.5%" — null when it is not a number */
export const parseVarispeed = (text: string): number | null => {
  const t = text.trim();
  if (t === '') return null;
  const percent = /%\s*$/.test(t);
  const n = Number(t.replace(',', '.').replace(/\s*[×x%]\s*$/i, ''));
  return Number.isFinite(n) ? clampSpeed(percent ? n / 100 : n) : null;
};

/** The speed one arrow step away: a tenth of a speed, on the tenths grid */
export const stepVarispeed = (speed: number, notches: number) => clampSpeed((Math.round(speed * 10) + notches) / 10);
/** The fine step (Shift+arrow): a hundredth of a speed per step, on the hundredths grid */
export const stepVarispeedFine = (speed: number, notches: number) => clampSpeed((Math.round(speed * 100) + notches) / 100);
/** The detent: a mouse drag this close to 1× lands on 1× (the 0.9–1.1 band) */
export const DETENT_SPEED = 0.1;

export interface VarispeedControlProps {
  /** The speed the engine runs at — what the readout reads */
  speed: number;
  disabled?: boolean;
  label?: string;
  title?: string;
  /** Whether play-at-speed is on — the host derives it: the speed is not 1× */
  enabled: boolean;
  /** A speed SET — the slider, a typed value; 1× is off */
  onChange: (speed: number) => void;
  /** A speed turned to by the arrow keys — the same value; a separate
   *  name from the chip days, hosts may pass onChange */
  onDial: (speed: number) => void;
}

export function VarispeedControl({ speed, enabled, disabled = false, label = 'Speed', title = 'Playback speed', onChange, onDial }: VarispeedControlProps) {
  const { theme } = useTheme();
  const draggingRef = React.useRef(false);
  // Right-click anywhere on the control: "Enter value…" (ManualValueDialog,
  // %, the range) / "Reset to 100%" (2026-10-15)
  const [manualOpen, setManualOpen] = React.useState(false);
  const valueMenu = useValueContextMenu({ disabled, onEnterValue: () => setManualOpen(true), onReset: () => onChange(1), resetLabel: '100%' });

  const style = {
    '--focus-color': theme.border.focus,
    '--varispeed-text': theme.foreground.text.primary,
  } as React.CSSProperties;
  const percent = formatVarispeedPercent(speed);
  return (
    <span
      className="varispeed"
      style={style}
      data-varispeed
      data-varispeed-active={enabled ? 'true' : undefined}
      onContextMenu={valueMenu.onContextMenu}
    >
      {valueMenu.menu}
      <ManualValueDialog
        isOpen={manualOpen && !disabled}
        title={title}
        label={label}
        value={speedToSlider(speed)}
        unit="%"
        min={1}
        max={300}
        step={1}
        decimals={0}
        hint="1% to 300%; 100% is normal"
        onApply={(v) => onChange(sliderToSpeed(v))}
        onClose={() => setManualOpen(false)}
      />
      {/* A CAPTION, NOT A BUTTON, NOT A STATE: the word names the readout;
          the slider and the readout are the controls */}
      <span className="varispeed__label" data-varispeed-label aria-hidden="true">{label}</span>
      {/* THE SLIDER WITH A DETENT: AU3's linear 0.01–3 track, unmarked; a
          mouse drag within DETENT_SPEED of 1× snaps to it (drag only —
          the keys step through), so letting go near normal lands on
          normal, which is off. */}
      <span
        className="varispeed__track"
        data-varispeed-track
        onPointerDownCapture={() => { draggingRef.current = true; }}
        onPointerUpCapture={() => { draggingRef.current = false; }}
        onPointerCancelCapture={() => { draggingRef.current = false; }}
        // A DOUBLE-CLICK ON THE SLIDER RESETS TO 100% (2026-10-15, "double
        // click the slider to reset to default value" — REAPER's Rate
        // slider does the same)
        onDoubleClick={() => { if (!disabled) onChange(1); }}
      >
        <Slider
          disabled={disabled}
          value={speedToSlider(speed)}
          min={1}
          max={300}
          ariaLabel={`${title} ${percent}`}
          className="varispeed__slider"
          onChange={(v) => {
            const next = sliderToSpeed(v);
            onChange(draggingRef.current && Math.abs(next - 1) <= DETENT_SPEED ? 1 : next);
          }}
        />
      </span>
      {/* THE READOUT: percent, plain text, fixed width (the Figma third row) */}
      <span
        className="varispeed__readout"
        data-varispeed-display
        role="spinbutton"
        aria-valuemin={1}
        aria-valuemax={300}
        aria-valuenow={speedToSlider(speed)}
        aria-valuetext={percent}
        aria-label={`${title} ${percent}`}
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        onKeyDown={(e) => {
          if (disabled || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            const step = e.shiftKey ? stepVarispeedFine : stepVarispeed;
            onDial(step(speed, e.key === 'ArrowUp' ? 1 : -1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            setManualOpen(true);
          }
        }}
        onDoubleClick={() => { if (!disabled) setManualOpen(true); }}
      >
        {percent}
      </span>
    </span>
  );
}
