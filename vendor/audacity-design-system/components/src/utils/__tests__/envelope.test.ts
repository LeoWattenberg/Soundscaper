import { describe, it, expect } from 'vitest';
import { dbToYNonLinear, yToDbNonLinear, getEnvelopeGainAtTime } from '../envelope';
import type { EnvelopePointData } from '../envelope';

describe('dbToYNonLinear', () => {
  const y = 0;
  const height = 100;

  it('maps -Infinity to bottom of usable area', () => {
    // usableHeight = 100 - 3 (BOTTOM_MARGIN) = 97
    expect(dbToYNonLinear(-Infinity, y, height)).toBe(97);
  });

  it('maps +12dB (max) to top of clip', () => {
    // normalized = ((12 - (-60)) / 72)^3 = 1^3 = 1
    // result = 0 + 97 - 1 * 97 = 0
    expect(dbToYNonLinear(12, y, height)).toBeCloseTo(0);
  });

  it('maps -60dB (min) to bottom of usable area', () => {
    // normalized = ((−60 − (−60)) / 72)^3 = 0
    // result = 0 + 97 − 0 = 97
    expect(dbToYNonLinear(-60, y, height)).toBeCloseTo(97);
  });

  it('places 0dB in the lower portion of the clip', () => {
    const zeroDbY = dbToYNonLinear(0, y, height);
    // 0dB with cubic curve: linear = 60/72 = 0.833, normalized = 0.833^3 ≈ 0.579
    // So 0dB is at about 40% from top — in lower half
    expect(zeroDbY).toBeGreaterThan(height * 0.3);
    expect(zeroDbY).toBeLessThan(height * 0.6);
  });

  it('clamps values beyond +12dB', () => {
    expect(dbToYNonLinear(20, y, height)).toBeCloseTo(dbToYNonLinear(12, y, height));
  });

  it('accounts for y offset', () => {
    const yOffset = 50;
    const result = dbToYNonLinear(0, yOffset, height);
    expect(result).toBeGreaterThan(yOffset);
  });
});

describe('yToDbNonLinear', () => {
  const y = 0;
  const height = 100;

  it('is the inverse of dbToYNonLinear', () => {
    const testDbs = [-50, -30, -10, 0, 6, 12];
    for (const db of testDbs) {
      const yPos = dbToYNonLinear(db, y, height);
      const recovered = yToDbNonLinear(yPos, y, height);
      expect(recovered).toBeCloseTo(db, 1);
    }
  });

  it('returns -Infinity at bottom of usable area', () => {
    // usableHeight = 97, so y + 97 triggers -Infinity
    expect(yToDbNonLinear(97, y, height)).toBe(-Infinity);
  });

  it('returns +12dB at top', () => {
    expect(yToDbNonLinear(0, y, height)).toBeCloseTo(12);
  });

  it('clamps within -60 to +12 range', () => {
    const db = yToDbNonLinear(96, y, height); // near bottom but above threshold
    expect(db).toBeGreaterThanOrEqual(-60);
    expect(db).toBeLessThanOrEqual(12);
  });
});

describe('getEnvelopeGainAtTime', () => {
  it('returns unity gain (1.0) when no points exist', () => {
    expect(getEnvelopeGainAtTime(0.5, [], 1.0)).toBe(1.0);
  });

  it('returns correct gain at 0dB', () => {
    const points: EnvelopePointData[] = [{ time: 0, db: 0 }];
    expect(getEnvelopeGainAtTime(0, points, 1.0)).toBeCloseTo(1.0);
  });

  it('returns correct gain at -6dB', () => {
    const points: EnvelopePointData[] = [{ time: 0, db: -6 }];
    // 10^(-6/20) ≈ 0.5012
    expect(getEnvelopeGainAtTime(0, points, 1.0)).toBeCloseTo(0.5012, 3);
  });

  it('interpolates linearly between two points in dB space', () => {
    const points: EnvelopePointData[] = [
      { time: 0, db: 0 },
      { time: 1, db: -12 },
    ];
    // At time 0.5: dB = 0 + 0.5 * (-12 - 0) = -6
    const gain = getEnvelopeGainAtTime(0.5, points, 1.0);
    expect(gain).toBeCloseTo(Math.pow(10, -6 / 20), 3);
  });

  it('uses first point value before first point', () => {
    const points: EnvelopePointData[] = [{ time: 0.5, db: -6 }];
    const gain = getEnvelopeGainAtTime(0, points, 1.0);
    expect(gain).toBeCloseTo(Math.pow(10, -6 / 20), 3);
  });

  it('uses last point value after last point', () => {
    const points: EnvelopePointData[] = [{ time: 0, db: -6 }];
    const gain = getEnvelopeGainAtTime(0.9, points, 1.0);
    expect(gain).toBeCloseTo(Math.pow(10, -6 / 20), 3);
  });
});
