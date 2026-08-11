import React from 'react';
import { useTheme } from '../ThemeProvider/ThemeProvider';
import { Dropdown } from '../Dropdown/Dropdown';
import { Button } from '../Button/Button';
import { SIDEBAR_WIDTH } from './constants';
import type { PianoRollSidebarProps } from './types';

export const PianoRollSidebar: React.FC<PianoRollSidebarProps> = ({
  snap,
  onSnapChange,
  keyboardOctave = 3,
  onKeyboardOctaveChange,
  keyboardEnabled = false,
  onKeyboardEnabledChange,
  instruments,
  instrument,
  onInstrumentChange,
}) => {
  const { theme } = useTheme();

  return (
    <div
      style={{
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        background: theme.background.surface.subtle,
        borderRight: `1px solid ${theme.border.onElevated}`,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        overflow: 'hidden',
      }}
    >
      {/* Instrument selector */}
      {instruments && instruments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label
            style={{
              color: theme.foreground.text.primary,
              fontSize: 12,
              fontFamily: 'Inter, sans-serif',
              fontWeight: 400,
            }}
          >
            Instrument
          </label>
          <Dropdown
            options={instruments.map(i => ({ label: i.label, value: i.id }))}
            value={instrument ?? instruments[0].id}
            onChange={(val) => onInstrumentChange?.(val)}
          />
        </div>
      )}

      {/* Edit note velocity button */}
      <Button variant="secondary" size="small">
        Edit note velocity
      </Button>

      {/* Computer keyboard input */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={() => onKeyboardEnabledChange?.(!keyboardEnabled)}
          style={{
            height: 28,
            border: `1px solid ${keyboardEnabled ? theme.foreground.text.link : theme.border.onElevated}`,
            borderRadius: 4,
            background: keyboardEnabled ? theme.foreground.text.link : theme.background.surface.elevated,
            color: keyboardEnabled ? '#ffffff' : theme.foreground.text.primary,
            fontSize: 12,
            fontFamily: 'Inter, sans-serif',
            fontWeight: 500,
            cursor: 'pointer',
            padding: '0 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <span style={{ fontSize: 14 }}>⌨</span>
          Computer keyboard
        </button>

        {/* Octave controls — visible when keyboard enabled */}
        {keyboardEnabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={() => onKeyboardOctaveChange?.(Math.max(-1, keyboardOctave - 1))}
                disabled={keyboardOctave <= -1}
                style={{
                  width: 24,
                  height: 24,
                  border: `1px solid ${theme.border.onElevated}`,
                  borderRadius: 4,
                  background: theme.background.surface.elevated,
                  color: keyboardOctave <= -1 ? theme.foreground.text.tertiary : theme.foreground.text.primary,
                  fontSize: 14,
                  fontFamily: 'Inter, sans-serif',
                  cursor: keyboardOctave <= -1 ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  lineHeight: 1,
                }}
                title="Octave down (Z)"
              >
                −
              </button>
              <span
                style={{
                  color: theme.foreground.text.primary,
                  fontSize: 13,
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: 500,
                  minWidth: 40,
                  textAlign: 'center',
                  userSelect: 'none',
                }}
              >
                C{keyboardOctave}
              </span>
              <button
                onClick={() => onKeyboardOctaveChange?.(Math.min(8, keyboardOctave + 1))}
                disabled={keyboardOctave >= 8}
                style={{
                  width: 24,
                  height: 24,
                  border: `1px solid ${theme.border.onElevated}`,
                  borderRadius: 4,
                  background: theme.background.surface.elevated,
                  color: keyboardOctave >= 8 ? theme.foreground.text.tertiary : theme.foreground.text.primary,
                  fontSize: 14,
                  fontFamily: 'Inter, sans-serif',
                  cursor: keyboardOctave >= 8 ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  lineHeight: 1,
                }}
                title="Octave up (X)"
              >
                +
              </button>
            </div>
            <span
              style={{
                color: theme.foreground.text.tertiary,
                fontSize: 10,
                fontFamily: 'Inter, sans-serif',
              }}
            >
              Z/X to shift octave
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
