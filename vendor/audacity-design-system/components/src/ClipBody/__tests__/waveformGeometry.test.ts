import { describe, it, expect } from 'vitest';
import { computeWaveformGeometry, makeSelectionColorFns } from '../waveformGeometry';

describe('computeWaveformGeometry', () => {
  it('derives sample rate from full duration and computes samples per pixel', () => {
    // 50_000 samples/sec over 2s = 100_000 samples; 100 px/s, no stretch
    const g = computeWaveformGeometry({
      dataLength: 100_000,
      clipFullDuration: 2,
      clipTrimStart: 0,
      clipDuration: 2,
      pixelsPerSecond: 100,
      clipStretchFactor: 1,
    });
    expect(g.samplesPerPixel).toBeCloseTo(500); // 50_000 / 100
    expect(g.trimStartSample).toBe(0);
  });

  it('falls back to trimStart + duration when clipFullDuration is undefined', () => {
    const g = computeWaveformGeometry({
      dataLength: 150_000,
      clipFullDuration: undefined,
      clipTrimStart: 1,
      clipDuration: 2, // fullDuration = 3 → rate 50_000
      pixelsPerSecond: 100,
      clipStretchFactor: 1,
    });
    expect(g.samplesPerPixel).toBeCloseTo(500);
    expect(g.trimStartSample).toBe(50_000); // floor(1 * 50_000)
  });

  it('divides samples per pixel by the stretch factor', () => {
    const g = computeWaveformGeometry({
      dataLength: 100_000,
      clipFullDuration: 2,
      clipTrimStart: 0.5,
      clipDuration: 1.5,
      pixelsPerSecond: 100,
      clipStretchFactor: 2,
    });
    expect(g.samplesPerPixel).toBeCloseTo(250);
    expect(g.trimStartSample).toBe(25_000);
  });
});

describe('makeSelectionColorFns', () => {
  const style = {
    getPropertyValue: (name: string) => `var(${name})`,
  };
  const base = {
    computedStyle: style,
    colorPrefix: 'blue',
    clipStartTime: 10,
    clipDuration: 4,
    pixelsPerSecond: 100,
  };

  it('returns selection colors inside the selection pixel range and normal outside', () => {
    // selection 11s–12s over a clip starting at 10s → px 100..200
    const fns = makeSelectionColorFns({
      ...base,
      inTimeSelection: true,
      timeSelectionRange: { startTime: 11, endTime: 12 },
    });
    expect(fns.getWaveColor(150)).not.toBe(fns.getWaveColor(50));
    expect(fns.getWaveColor(50)).toBe(fns.getWaveColor(250));
    expect(fns.getWaveColor(150)).toBe('var(--clip-blue-time-selection-waveform)');
    expect(fns.getWaveColor(50)).toBe('var(--clip-blue-waveform)');
    expect(fns.getRmsColor(150)).toBe('var(--clip-blue-time-selection-waveform-rms)');
    expect(fns.getRmsColor(50)).toBe('var(--clip-blue-waveform-rms)');
    // boundaries: inclusive at start, exclusive at end
    expect(fns.getWaveColor(100)).toBe('var(--clip-blue-time-selection-waveform)');
    expect(fns.getWaveColor(200)).toBe('var(--clip-blue-waveform)');
  });

  it('returns constant colors when there is no time selection', () => {
    const fns = makeSelectionColorFns({
      ...base,
      inTimeSelection: false,
      timeSelectionRange: null,
    });
    expect(fns.getWaveColor(0)).toBe(fns.getWaveColor(999));
    expect(fns.getWaveColor(0)).toBe('var(--clip-blue-waveform)');
    expect(fns.getRmsColor(0)).toBe('var(--clip-blue-waveform-rms)');
  });

  it('returns constant colors when the time selection does not overlap the clip', () => {
    // clip spans 10s–14s; selection is entirely before it
    const fns = makeSelectionColorFns({
      ...base,
      inTimeSelection: true,
      timeSelectionRange: { startTime: 0, endTime: 5 },
    });
    expect(fns.getWaveColor(0)).toBe('var(--clip-blue-waveform)');
    expect(fns.getWaveColor(399)).toBe('var(--clip-blue-waveform)');
  });
});
