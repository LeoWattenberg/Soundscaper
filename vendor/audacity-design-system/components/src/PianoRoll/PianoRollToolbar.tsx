import React from 'react';
import { useTheme } from '../ThemeProvider/ThemeProvider';
import { Toolbar, ToolbarButtonGroup, ToolbarDivider } from '../Toolbar/Toolbar';
import { ToolButton } from '../ToolButton/ToolButton';
import { ToggleToolButton } from '../ToggleToolButton/ToggleToolButton';
import { Dropdown } from '../Dropdown/Dropdown';
import { Checkbox } from '../Checkbox/Checkbox';
import { TOOLBAR_HEIGHT, MIN_PPS, MAX_PPS } from './constants';
import type { SnapGrid } from '@audacity-ui/core';


export interface PianoRollToolbarProps {
  /** Current horizontal zoom level */
  pixelsPerSecond: number;
  /** Called when zoom changes */
  onPixelsPerSecondChange?: (pps: number) => void;
  /** Whether MIDI playback on note placement is enabled */
  midiPlayback: boolean;
  /** Called when MIDI playback is toggled */
  onMidiPlaybackChange: (enabled: boolean) => void;
  /** Current snap grid */
  snap: SnapGrid;
  /** Called when snap grid changes */
  onSnapChange: (snap: SnapGrid) => void;
  /** Default note length subdivision for drawing new notes */
  defaultNoteDuration: number;
  /** Called when default note length changes */
  onDefaultNoteDurationChange: (subdivision: number) => void;
  /** Whether computer keyboard input is enabled */
  keyboardEnabled: boolean;
  /** Called when user toggles computer keyboard input */
  onKeyboardEnabledChange: (enabled: boolean) => void;
  /** Current computer keyboard octave (e.g. 3 = C3–C4) */
  keyboardOctave: number;
  /** Called when user changes the keyboard octave */
  onKeyboardOctaveChange: (octave: number) => void;
  /** Whether the recessed background is active */
  recessedBackground?: boolean;
  /** Called when the recessed background toggle is changed */
  onRecessedBackgroundChange?: (enabled: boolean) => void;
}

const SNAP_OPTIONS = [
  { value: '1', label: '1/1' },
  { value: '2', label: '1/2' },
  { value: '4', label: '1/4' },
  { value: '8', label: '1/8' },
  { value: '16', label: '1/16' },
  { value: '32', label: '1/32' },
  { value: '64', label: '1/64' },
];

const NOTE_LENGTH_OPTIONS = [
  { value: '1', label: '1/1' },
  { value: '2', label: '1/2' },
  { value: '4', label: '1/4' },
  { value: '8', label: '1/8' },
  { value: '16', label: '1/16' },
  { value: '32', label: '1/32' },
  { value: '64', label: '1/64' },
];

const ZOOM_FACTOR = 1.25;

export const PianoRollToolbar: React.FC<PianoRollToolbarProps> = ({
  pixelsPerSecond,
  onPixelsPerSecondChange,
  midiPlayback,
  onMidiPlaybackChange,
  snap,
  onSnapChange,
  defaultNoteDuration,
  onDefaultNoteDurationChange,
  keyboardEnabled,
  onKeyboardEnabledChange,
  keyboardOctave,
  onKeyboardOctaveChange,
  recessedBackground,
  onRecessedBackgroundChange,
}) => {
  const { theme } = useTheme();

  const handleZoomIn = () => {
    const newPps = Math.min(MAX_PPS, pixelsPerSecond * ZOOM_FACTOR);
    onPixelsPerSecondChange?.(newPps);
  };

  const handleZoomOut = () => {
    const newPps = Math.max(MIN_PPS, pixelsPerSecond / ZOOM_FACTOR);
    onPixelsPerSecondChange?.(newPps);
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontFamily: 'Inter, sans-serif',
    fontWeight: 500,
    color: theme.foreground.text.secondary,
    whiteSpace: 'nowrap',
    userSelect: 'none',
  };

  return (
    <Toolbar height={TOOLBAR_HEIGHT} tabGroupId="piano-roll-toolbar" enableTabGroup={false}>
      {/* Zoom controls */}
      <ToolbarButtonGroup gap={2}>
        <ToolButton icon="zoom-in" size="small" ariaLabel="Zoom in" onClick={handleZoomIn} />
        <ToolButton icon="zoom-out" size="small" ariaLabel="Zoom out" onClick={handleZoomOut} />
      </ToolbarButtonGroup>

      <ToolbarDivider />

      {/* MIDI sound toggle */}
      <ToolbarButtonGroup gap={4}>
        <ToggleToolButton
          icon="volume"
          isActive={midiPlayback}
          onClick={() => onMidiPlaybackChange(!midiPlayback)}
          ariaLabel="MIDI playback when placing notes"
        />
      </ToolbarButtonGroup>

      <ToolbarDivider />

      {/* Snap grid */}
      <ToolbarButtonGroup gap={4}>
        <span style={labelStyle}>Snap</span>
        <Dropdown
          options={SNAP_OPTIONS}
          value={String(snap.subdivision)}
          onChange={(val) => onSnapChange({ ...snap, subdivision: Number(val) as SnapGrid['subdivision'] })}
          width="64px"
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 11, fontFamily: 'Inter, sans-serif', fontWeight: 500, color: theme.foreground.text.secondary, userSelect: 'none', whiteSpace: 'nowrap' }}>
          <Checkbox
            checked={snap.triplet ?? false}
            onChange={(checked) => onSnapChange({ ...snap, triplet: checked })}
            aria-label="Triplet snap"
          />
          T
        </label>
      </ToolbarButtonGroup>

      <ToolbarDivider />

      {/* Note length */}
      <ToolbarButtonGroup gap={4}>
        <span style={labelStyle}>Length</span>
        <Dropdown
          options={NOTE_LENGTH_OPTIONS}
          value={String(defaultNoteDuration)}
          onChange={(val) => onDefaultNoteDurationChange(Number(val))}
          width="64px"
        />
      </ToolbarButtonGroup>

      <ToolbarDivider />

      {/* Computer keyboard toggle + octave */}
      <ToolbarButtonGroup gap={4}>
        <button
          onClick={() => onKeyboardEnabledChange(!keyboardEnabled)}
          title="Enable computer keyboard (play notes with A-L keys)"
          style={{
            width: 28,
            height: 28,
            border: `1px solid ${keyboardEnabled ? theme.foreground.text.link : theme.border.default}`,
            borderRadius: 2,
            background: keyboardEnabled ? theme.foreground.text.link : theme.background.control.button.secondary.idle,
            color: keyboardEnabled ? '#ffffff' : theme.foreground.text.secondary,
            fontSize: 16,
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          }}
          aria-pressed={keyboardEnabled}
          aria-label="Computer keyboard input"
        >
          ⌨
        </button>
        <button
          onClick={() => keyboardEnabled && onKeyboardOctaveChange(Math.max(-1, keyboardOctave - 1))}
          disabled={!keyboardEnabled || keyboardOctave <= -1}
          title="Octave down (Z)"
          style={{
            width: 20,
            height: 20,
            border: `1px solid ${theme.border.default}`,
            borderRadius: 2,
            background: theme.background.control.button.secondary.idle,
            color: !keyboardEnabled || keyboardOctave <= -1 ? theme.foreground.text.tertiary : theme.foreground.text.primary,
            fontSize: 13,
            fontFamily: 'Inter, sans-serif',
            cursor: !keyboardEnabled || keyboardOctave <= -1 ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            lineHeight: 1,
          }}
          aria-label="Octave down"
        >
          −
        </button>
        <span style={{ ...labelStyle, minWidth: 24, textAlign: 'center', color: keyboardEnabled ? theme.foreground.text.primary : theme.foreground.text.tertiary, fontWeight: 600 }}>
          C{keyboardOctave}
        </span>
        <button
          onClick={() => keyboardEnabled && onKeyboardOctaveChange(Math.min(8, keyboardOctave + 1))}
          disabled={!keyboardEnabled || keyboardOctave >= 8}
          title="Octave up (X)"
          style={{
            width: 20,
            height: 20,
            border: `1px solid ${theme.border.default}`,
            borderRadius: 2,
            background: theme.background.control.button.secondary.idle,
            color: !keyboardEnabled || keyboardOctave >= 8 ? theme.foreground.text.tertiary : theme.foreground.text.primary,
            fontSize: 13,
            fontFamily: 'Inter, sans-serif',
            cursor: !keyboardEnabled || keyboardOctave >= 8 ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            lineHeight: 1,
          }}
          aria-label="Octave up"
        >
          +
        </button>
      </ToolbarButtonGroup>

      <ToolbarDivider />

      {/* Background toggle */}
      <ToolbarButtonGroup gap={4}>
        <ToggleToolButton
          icon="brush"
          isActive={recessedBackground ?? false}
          onClick={() => onRecessedBackgroundChange?.(!recessedBackground)}
          ariaLabel="Toggle recessed background"
        />
      </ToolbarButtonGroup>
    </Toolbar>
  );
};
