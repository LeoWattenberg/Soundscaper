import { describe, it, expect } from 'vitest';
import {
  pixelsToTime,
  timeToPixels,
  getTrackHeight,
  clampTrackIndex,
  getTrackRange,
  yToTrackIndex,
  trackIndexToY,
} from '../coordinates';
import type { Track } from '../../types';

describe('pixelsToTime', () => {
  it('converts pixels to time at 100px/s', () => {
    expect(pixelsToTime(200, 100)).toBe(2);
  });

  it('returns 0 for pixel position 0', () => {
    expect(pixelsToTime(0, 100)).toBe(0);
  });

  it('accounts for left padding', () => {
    expect(pixelsToTime(150, 100, 50)).toBe(1);
  });

  it('returns negative time for pixels before padding', () => {
    expect(pixelsToTime(0, 100, 50)).toBe(-0.5);
  });
});

describe('timeToPixels', () => {
  it('converts time to pixels at 100px/s', () => {
    expect(timeToPixels(2, 100)).toBe(200);
  });

  it('returns 0 for time 0', () => {
    expect(timeToPixels(0, 100)).toBe(0);
  });

  it('accounts for left padding', () => {
    expect(timeToPixels(1, 100, 50)).toBe(150);
  });

  it('is the inverse of pixelsToTime', () => {
    const pps = 120;
    const time = 3.5;
    expect(pixelsToTime(timeToPixels(time, pps), pps)).toBeCloseTo(time);
  });
});

describe('getTrackHeight', () => {
  it('returns custom height when set', () => {
    const track = { id: 0, name: 't', clips: [], height: 200 } satisfies Track;
    expect(getTrackHeight(track, 114)).toBe(200);
  });

  it('returns default height when height is undefined', () => {
    const track = { id: 0, name: 't', clips: [] } satisfies Track;
    expect(getTrackHeight(track, 114)).toBe(114);
  });
});

describe('clampTrackIndex', () => {
  const tracks: Track[] = [
    { id: 0, name: 'a', clips: [] },
    { id: 1, name: 'b', clips: [] },
    { id: 2, name: 'c', clips: [] },
  ];

  it('clamps negative index to 0', () => {
    expect(clampTrackIndex(-5, tracks)).toBe(0);
  });

  it('clamps index beyond length to last index', () => {
    expect(clampTrackIndex(10, tracks)).toBe(2);
  });

  it('leaves valid index unchanged', () => {
    expect(clampTrackIndex(1, tracks)).toBe(1);
  });
});

describe('getTrackRange', () => {
  it('returns inclusive range in ascending order', () => {
    expect(getTrackRange(1, 3)).toEqual([1, 2, 3]);
  });

  it('works when start > end (auto-sorts)', () => {
    expect(getTrackRange(3, 1)).toEqual([1, 2, 3]);
  });

  it('returns single element when start === end', () => {
    expect(getTrackRange(2, 2)).toEqual([2]);
  });
});

describe('yToTrackIndex', () => {
  const tracks: Track[] = [
    { id: 0, name: 'a', clips: [], height: 100 },
    { id: 1, name: 'b', clips: [], height: 150 },
    { id: 2, name: 'c', clips: [] },
  ];

  it('returns 0 for Y inside first track', () => {
    // initialGap=10, first track starts at y=10, height=100
    expect(yToTrackIndex(50, tracks, 10, 5, 114)).toBe(0);
  });

  it('returns 1 for Y inside second track', () => {
    // first track: 10..110, gap 5, second track: 115..265
    expect(yToTrackIndex(120, tracks, 10, 5, 114)).toBe(1);
  });
});

describe('trackIndexToY', () => {
  const tracks: Track[] = [
    { id: 0, name: 'a', clips: [], height: 100 },
    { id: 1, name: 'b', clips: [], height: 150 },
    { id: 2, name: 'c', clips: [] },
  ];

  it('returns initialGap for track 0', () => {
    expect(trackIndexToY(0, tracks, 10, 5, 114)).toBe(10);
  });

  it('returns correct offset for track 1', () => {
    // initialGap=10 + track0 height(100) + gap(5) = 115
    expect(trackIndexToY(1, tracks, 10, 5, 114)).toBe(115);
  });

  it('returns correct offset for track 2', () => {
    // 10 + 100 + 5 + 150 + 5 = 270
    expect(trackIndexToY(2, tracks, 10, 5, 114)).toBe(270);
  });
});
