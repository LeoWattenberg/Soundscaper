import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  generateSpeechWaveform,
  generateSineWave,
  generateDecayingSineWave,
} from '../waveform';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateSpeechWaveform', () => {
  it('defaults to 1000 samples per second', () => {
    expect(generateSpeechWaveform(2)).toHaveLength(2000);
  });

  it('respects an explicit samplesPerSecond', () => {
    expect(generateSpeechWaveform(2, 500)).toHaveLength(1000);
  });

  it('stays within the normalized -1..1 range', () => {
    const waveform = generateSpeechWaveform(1);
    expect(waveform.every((v) => v >= -1 && v <= 1)).toBe(true);
  });

  it('produces identical output for the same seed', () => {
    const a = generateSpeechWaveform(1, 1000, { seed: 42 });
    const b = generateSpeechWaveform(1, 1000, { seed: 42 });
    expect(a).toEqual(b);
  });

  it('produces different output for different seeds', () => {
    const a = generateSpeechWaveform(1, 1000, { seed: 1 });
    const b = generateSpeechWaveform(1, 1000, { seed: 2 });
    expect(a).not.toEqual(b);
  });
});

describe('generateSineWave', () => {
  it('defaults to 1000 samples per second', () => {
    expect(generateSineWave(3)).toHaveLength(3000);
  });

  it('respects an explicit samplesPerSecond', () => {
    expect(generateSineWave(1, 440, 200)).toHaveLength(200);
  });
});

describe('generateDecayingSineWave', () => {
  it('keeps its 2000 samples-per-second default', () => {
    expect(generateDecayingSineWave(1)).toHaveLength(2000);
  });
});

describe('oversized-waveform dev warning', () => {
  it('warns when a generated waveform exceeds 100k samples', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    generateSpeechWaveform(3, 50000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('samplesPerSecond');
  });

  it('does not warn at the default density', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    generateSpeechWaveform(10);
    generateSineWave(10);
    expect(warn).not.toHaveBeenCalled();
  });
});
