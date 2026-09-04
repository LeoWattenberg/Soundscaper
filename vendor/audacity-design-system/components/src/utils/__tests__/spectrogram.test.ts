import { describe, expect, it } from 'vitest';
import { getSpectrogramColor } from '../spectrogram';

describe('getSpectrogramColor', () => {
  it('uses the Roseus colour map endpoints', () => {
    expect(getSpectrogramColor(0)).toBe('#010101');
    expect(getSpectrogramColor(1)).toBe('#fefbf9');
  });

  it('clamps intensities outside the normalized range', () => {
    expect(getSpectrogramColor(-1)).toBe('#010101');
    expect(getSpectrogramColor(2)).toBe('#fefbf9');
  });
});
