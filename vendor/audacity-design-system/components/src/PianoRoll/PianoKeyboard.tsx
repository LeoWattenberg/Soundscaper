import React, { useState, useMemo } from 'react';
import { useTheme } from '../ThemeProvider/ThemeProvider';
import { PIANO_KEY_WIDTH, TOTAL_PITCHES, NOTE_HEIGHT, RULER_HEIGHT, CLIP_STRIP_HEIGHT } from './constants';
import type { PianoKeyboardProps } from './types';

/**
 * White key layout within one octave (top = highest pitch, bottom = lowest).
 * Heights per octave: B(24) + A(32) + G(32) + F(24) + E(24) + D(32) + C(24) = 192px = 12×16
 */
const WHITE_KEY_LAYOUT = [
  { pitchClass: 11, offset: 0,   height: 24, name: 'B' },
  { pitchClass: 9,  offset: 24,  height: 32, name: 'A' },
  { pitchClass: 7,  offset: 56,  height: 32, name: 'G' },
  { pitchClass: 5,  offset: 88,  height: 24, name: 'F' },
  { pitchClass: 4,  offset: 112, height: 24, name: 'E' },
  { pitchClass: 2,  offset: 136, height: 32, name: 'D' },
  { pitchClass: 0,  offset: 168, height: 24, name: 'C' },
];

/** Black key positions within one octave — offset is the centre Y from octave top */
const BLACK_KEY_LAYOUT = [
  { pitchClass: 10, offset: 24,  name: 'A#' }, // between B and A
  { pitchClass: 8,  offset: 56,  name: 'G#' }, // between A and G
  { pitchClass: 6,  offset: 88,  name: 'F#' }, // between G and F
  { pitchClass: 3,  offset: 136, name: 'D#' }, // between E and D
  { pitchClass: 1,  offset: 168, name: 'C#' }, // between D and C
];

const BLACK_KEY_WIDTH = 54;
const BLACK_KEY_HEIGHT = 16;
const OCTAVE_HEIGHT = 12 * NOTE_HEIGHT; // 192px

// Colors
const KEY_BG = '#212433';
const KEY_BORDER = '#14151a';
const WHITE_KEY_FACE = '#f8f8f9';
const WHITE_KEY_HOVER = '#e8e8ed';
const WHITE_KEY_ACTIVE = '#d0e8e8';
const BLACK_KEY_FACE = '#2c2e3a';
const BLACK_KEY_HIGHLIGHT = '#3e4050';
const BLACK_KEY_HOVER = '#464858';
const BLACK_KEY_ACTIVE = '#3a5858';
const LABEL_COLOR = 'rgba(20,21,26,0.5)';

export const PianoKeyboard: React.FC<PianoKeyboardProps> = ({
  scrollY,
  noteHeight,
  height,
  highlightedPitch,
  onKeyClick,
  onHoverKey,
  clipStripVisible = true,
}) => {
  const { theme } = useTheme();
  const [hoveredPitch, setHoveredPitch] = useState<number | null>(null);

  const setHover = (pitch: number | null) => {
    setHoveredPitch(pitch);
    onHoverKey?.(pitch);
  };

  const topOffset = RULER_HEIGHT + (clipStripVisible ? CLIP_STRIP_HEIGHT : 0);
  const gridHeight = height - topOffset;

  const keyElements = useMemo(() => {
    const whiteKeys: React.ReactNode[] = [];
    const blackKeys: React.ReactNode[] = [];

    for (let octave = 10; octave >= 0; octave--) {
      const octaveBasePitch = octave * 12;
      const octaveTopY = (TOTAL_PITCHES - 1 - (octaveBasePitch + 11)) * noteHeight - scrollY;

      // Skip entire octave if not visible
      if (octaveTopY + OCTAVE_HEIGHT < 0 || octaveTopY > gridHeight) continue;

      // White keys
      for (const key of WHITE_KEY_LAYOUT) {
        const pitch = octaveBasePitch + key.pitchClass;
        if (pitch > 127 || pitch < 0) continue;

        const y = octaveTopY + key.offset;
        if (y + key.height < -8 || y > gridHeight + 8) continue;

        const isHovered = hoveredPitch === pitch;
        const isActive = highlightedPitch === pitch;
        const isC = key.pitchClass === 0;
        const displayOctave = octave - 1;

        const faceColor = isActive
          ? WHITE_KEY_ACTIVE
          : isHovered
            ? WHITE_KEY_HOVER
            : WHITE_KEY_FACE;

        const noteName = `${key.name}${displayOctave}`;

        whiteKeys.push(
          <div
            key={pitch}
            style={{
              position: 'absolute',
              left: 0,
              top: y,
              width: PIANO_KEY_WIDTH,
              height: key.height,
              background: KEY_BG,
              borderBottom: `0.5px solid ${KEY_BORDER}`,
              borderTop: `0.5px solid ${KEY_BORDER}`,
              cursor: 'pointer',
            }}
            onMouseEnter={() => setHover(pitch)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onKeyClick?.(pitch)}
          >
            {/* White key face */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: PIANO_KEY_WIDTH - 1,
                background: faceColor,
                borderRadius: '0 2px 2px 0',
                pointerEvents: 'none',
              }}
            />

            {/* Note label — always show for C, show others on hover */}
            {(isC || isHovered) && (
              <span
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: 11,
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: 400,
                  color: LABEL_COLOR,
                  pointerEvents: 'none',
                  lineHeight: 1,
                }}
              >
                {noteName}
              </span>
            )}
          </div>
        );
      }

      // Black keys — solid elements rendered on top
      for (const bk of BLACK_KEY_LAYOUT) {
        const pitch = octaveBasePitch + bk.pitchClass;
        if (pitch > 127 || pitch < 0) continue;

        const y = octaveTopY + bk.offset - BLACK_KEY_HEIGHT / 2;
        if (y + BLACK_KEY_HEIGHT < -8 || y > gridHeight + 8) continue;

        const isHovered = hoveredPitch === pitch;
        const isActive = highlightedPitch === pitch;
        const displayOctave = octave - 1;
        const noteName = `${bk.name}${displayOctave}`;

        const faceColor = isActive
          ? BLACK_KEY_ACTIVE
          : isHovered
            ? BLACK_KEY_HOVER
            : BLACK_KEY_FACE;

        blackKeys.push(
          <div
            key={pitch}
            style={{
              position: 'absolute',
              left: 0,
              top: y,
              width: BLACK_KEY_WIDTH,
              height: BLACK_KEY_HEIGHT,
              background: KEY_BG,
              cursor: 'pointer',
              zIndex: 2,
              borderRadius: '0 2px 2px 0',
              overflow: 'hidden',
            }}
            onMouseEnter={() => setHover(pitch)}
            onMouseLeave={() => setHover(null)}
            onClick={(e) => { e.stopPropagation(); onKeyClick?.(pitch); }}
          >
            {/* Black key face with gradient */}
            <div
              style={{
                position: 'absolute',
                left: 3,
                top: 2,
                width: BLACK_KEY_WIDTH - 10,
                height: BLACK_KEY_HEIGHT - 4,
                background: `linear-gradient(to right, ${faceColor}, ${BLACK_KEY_HIGHLIGHT})`,
                borderRadius: '0 1px 1px 0',
                pointerEvents: 'none',
              }}
            />
            {/* Right edge highlight */}
            <div
              style={{
                position: 'absolute',
                right: 2,
                top: 2,
                width: 6,
                height: BLACK_KEY_HEIGHT - 4,
                background: `linear-gradient(to right, ${BLACK_KEY_HIGHLIGHT}, ${KEY_BG})`,
                borderRadius: '1px',
                pointerEvents: 'none',
              }}
            />

            {/* Note label on hover */}
            {isHovered && (
              <span
                style={{
                  position: 'absolute',
                  left: BLACK_KEY_WIDTH + 4,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: 10,
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: 500,
                  color: theme.foreground.text.secondary,
                  pointerEvents: 'none',
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                  zIndex: 3,
                }}
              >
                {noteName}
              </span>
            )}
          </div>
        );
      }
    }

    return [...whiteKeys, ...blackKeys];
  }, [scrollY, noteHeight, gridHeight, hoveredPitch, highlightedPitch, onKeyClick, onHoverKey]);

  return (
    <div
      style={{
        width: PIANO_KEY_WIDTH,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: KEY_BG,
        borderRight: `1px solid ${KEY_BORDER}`,
      }}
    >
      {/* Empty top area aligned with ruler (+ clip strip when visible) */}
      <div
        style={{
          height: topOffset,
          flexShrink: 0,
          background: theme.background.surface.elevated,
          borderBottom: `1px solid ${theme.border.onElevated}`,
        }}
      />

      {/* Piano keys */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          overflow: 'hidden',
        }}
      >
        {keyElements}
      </div>
    </div>
  );
};
