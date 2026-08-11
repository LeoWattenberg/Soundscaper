import { describe, it, expect } from 'vitest';
import {
  freqToNorm,
  normToFreq,
  normToY,
  freqToY,
  getScaleMinFreq,
  getTicksForScale,
} from '../spectrogramScales';
import type { SpectrogramScale } from '../spectrogramScales';

const SCALES: SpectrogramScale[] = ['linear', 'logarithmic', 'mel', 'bark', 'erb', 'period'];

describe('freqToNorm / normToFreq roundtrip', () => {
  const minFreq = 20;
  const maxFreq = 20000;

  for (const scale of SCALES) {
    it(`roundtrips for ${scale} scale`, () => {
      const testFreqs = [100, 440, 1000, 5000, 10000];
      for (const hz of testFreqs) {
        const norm = freqToNorm(hz, minFreq, maxFreq, scale);
        const recovered = normToFreq(norm, minFreq, maxFreq, scale);
        expect(recovered).toBeCloseTo(hz, 0);
      }
    });
  }
});

describe('freqToNorm', () => {
  it('returns 0 for minFreq', () => {
    expect(freqToNorm(20, 20, 20000, 'linear')).toBeCloseTo(0);
  });

  it('returns 1 for maxFreq', () => {
    expect(freqToNorm(20000, 20, 20000, 'linear')).toBeCloseTo(1);
  });

  it('returns ~0.5 at midpoint for linear scale', () => {
    expect(freqToNorm(10010, 20, 20000, 'linear')).toBeCloseTo(0.5, 1);
  });

  it('returns value between 0 and 1 for intermediate frequency', () => {
    for (const scale of SCALES) {
      const norm = freqToNorm(1000, 20, 20000, scale);
      expect(norm).toBeGreaterThan(0);
      expect(norm).toBeLessThan(1);
    }
  });
});

describe('normToY', () => {
  it('maps norm=0 (low freq) to bottom of canvas', () => {
    expect(normToY(0, 500)).toBe(500);
  });

  it('maps norm=1 (high freq) to top of canvas', () => {
    expect(normToY(1, 500)).toBe(0);
  });

  it('maps norm=0.5 to middle', () => {
    expect(normToY(0.5, 500)).toBe(250);
  });
});

describe('freqToY', () => {
  it('maps maxFreq to top (y=0)', () => {
    expect(freqToY(20000, 20, 20000, 500, 'linear')).toBeCloseTo(0);
  });

  it('maps minFreq to bottom (y=height)', () => {
    expect(freqToY(20, 20, 20000, 500, 'linear')).toBeCloseTo(500);
  });
});

describe('getScaleMinFreq', () => {
  it('returns 1 for logarithmic scale', () => {
    expect(getScaleMinFreq('logarithmic')).toBe(1);
  });

  it('returns 10 for other scales', () => {
    expect(getScaleMinFreq('linear')).toBe(10);
    expect(getScaleMinFreq('mel')).toBe(10);
    expect(getScaleMinFreq('bark')).toBe(10);
    expect(getScaleMinFreq('erb')).toBe(10);
    expect(getScaleMinFreq('period')).toBe(10);
  });
});

describe('getTicksForScale', () => {
  for (const scale of SCALES) {
    it(`returns non-empty ticks for ${scale}`, () => {
      const ticks = getTicksForScale(scale);
      expect(ticks.length).toBeGreaterThan(0);
    });

    it(`all ticks for ${scale} have required fields`, () => {
      const ticks = getTicksForScale(scale);
      for (const tick of ticks) {
        expect(tick).toHaveProperty('value');
        expect(tick).toHaveProperty('label');
        expect(tick).toHaveProperty('isMajor');
        expect(typeof tick.value).toBe('number');
        expect(typeof tick.label).toBe('string');
        expect(typeof tick.isMajor).toBe('boolean');
      }
    });
  }
});
