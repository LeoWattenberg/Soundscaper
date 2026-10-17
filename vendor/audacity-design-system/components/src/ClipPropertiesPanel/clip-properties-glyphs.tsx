/* SPDX-License-Identifier: GPL-3.0-only
 * Selective port from audacity-design-system 20ce5547. Split for module ownership. */
import React from 'react';
import { fadeCurvePath, type FadeShape } from '../utils/clipCrossfades';
const Glyph = ({ children, title }: { children: React.ReactNode; title: string }) => (
  <svg className="clip-properties__glyph" viewBox="0 0 16 16" width={16} height={16} aria-hidden="true" data-glyph={title}>
    {children}
  </svg>
);

export const StartGlyph = () => (
  <Glyph title="Start"><path d="M3 2v12M13 8H6M9 5 6 8l3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></Glyph>
);
export const EndGlyph = () => (
  <Glyph title="End"><path d="M13 2v12M3 8h7M7 5l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></Glyph>
);
export const LengthGlyph = () => (
  <Glyph title="Length"><path d="M2 8h12M5 5 2 8l3 3M11 5l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></Glyph>
);
export const TrimStartGlyph = () => (
  <Glyph title="Trim start"><path d="M3 2v12M13 2v12M3 8h5M6 5.5 8.5 8 6 10.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 2h2M3 14h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></Glyph>
);
export const TrimEndGlyph = () => (
  <Glyph title="Trim end"><path d="M3 2v12M13 2v12M13 8H8M10 5.5 7.5 8l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M11 2h2M11 14h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></Glyph>
);
export const SpanGlyph = () => (
  <Glyph title="Span"><path d="M2 3v10M14 3v10M2 8h12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></Glyph>
);
export const PitchGlyph = () => (
  <Glyph title="Pitch"><path d="M9.5 2.5v8.2a2.3 2.3 0 1 1-1.5-2.2V4l4-1v2.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></Glyph>
);
export const SpeedGlyph = () => (
  <Glyph title="Speed"><circle cx="8" cy="9" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 6.5V9l2 1.5M6 2h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></Glyph>
);
export const ExportGlyph = () => (
  <Glyph title="Format"><path d="M8 2v8M5 7l3 3 3-3M3 11v3h10v-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></Glyph>
);
export const SampleRateGlyph = () => (
  <Glyph title="Sample rate"><path d="M2 8h2l1.5-4 2 8 2-6 1.5 2H14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></Glyph>
);
export const TrackGlyph = () => (
  <Glyph title="Track"><path d="M2 4h12M2 8h12M2 12h12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><path d="M5 6.5v3M8 5.5v5M11 6.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></Glyph>
);
export const ReverseGlyph = () => (
  <Glyph title="Reverse"><path d="M13 5H5M8 2 5 5l3 3M3 11h8M8 8l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></Glyph>
);
export const CountGlyph = () => (
  <Glyph title="Selected clips"><path d="M2 5h8v8H2zM5 2h9v9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></Glyph>
);

/** A fade's curve, drawn small — the thumbnail by its field and the
 *  picker's preset glyphs. The curve path is the canvas's own. */
export function FadeGlyph({ side, shape, title, dim }: { side: 'in' | 'out'; shape: FadeShape | undefined; title: string; dim?: boolean }) {
  const resolved: FadeShape = shape ?? 2; // the quick fade's default S-curve
  return (
    <svg className="clip-properties__glyph clip-properties__glyph--fade" viewBox="0 0 100 100" preserveAspectRatio="none" width={22} height={14} aria-hidden="true" data-glyph={title} data-side={side}>
      <path d={`${fadeCurvePath(side, 32, resolved)} L ${side === 'in' ? '100,100' : '0,100'} Z`} fill="currentColor" opacity={dim ? 0.12 : 0.22} stroke="none" />
      <path d={fadeCurvePath(side, 32, resolved)} fill="none" stroke="currentColor" strokeWidth={10} vectorEffect="non-scaling-stroke" style={{ strokeWidth: 1.5 }} />
    </svg>
  );
}

