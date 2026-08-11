import { describe, it, expect } from 'vitest';
import { fft, getPowerSpectrum, applyHannWindow, getFrequencyBandEnergy } from '../audio';

describe('fft', () => {
  it('handles single-sample input', () => {
    const result = fft([1]);
    expect(result.real).toEqual([1]);
    expect(result.imag).toEqual([0]);
  });

  it('computes FFT of DC signal (all ones)', () => {
    const samples = [1, 1, 1, 1];
    const result = fft(samples);
    // DC bin should equal N=4, all other bins should be ~0
    expect(result.real[0]).toBeCloseTo(4);
    expect(result.imag[0]).toBeCloseTo(0);
    expect(result.real[1]).toBeCloseTo(0);
    expect(result.real[2]).toBeCloseTo(0);
  });

  it('computes FFT of alternating signal', () => {
    // [1, -1, 1, -1] should have energy at Nyquist (bin N/2)
    const samples = [1, -1, 1, -1];
    const result = fft(samples);
    expect(result.real[0]).toBeCloseTo(0); // DC = 0
    expect(result.real[2]).toBeCloseTo(4); // Nyquist bin
  });

  it('preserves Parseval theorem (energy conservation)', () => {
    const samples = [0.5, -0.3, 0.8, -0.1];
    const result = fft(samples);
    const timeEnergy = samples.reduce((sum, s) => sum + s * s, 0);
    const freqEnergy = result.real.reduce(
      (sum, r, i) => sum + r * r + result.imag[i] * result.imag[i],
      0
    ) / samples.length;
    expect(freqEnergy).toBeCloseTo(timeEnergy, 5);
  });
});

describe('getPowerSpectrum', () => {
  it('returns half the length of the FFT', () => {
    const result = fft([1, 0, 0, 0]);
    const power = getPowerSpectrum(result);
    expect(power.length).toBe(2);
  });

  it('computes magnitude correctly', () => {
    // For a known FFT result, check magnitude = sqrt(real^2 + imag^2)
    const power = getPowerSpectrum({ real: [3, 0, 1, 0], imag: [0, 4, 0, 0] });
    expect(power[0]).toBeCloseTo(3); // sqrt(9+0)
    expect(power[1]).toBeCloseTo(4); // sqrt(0+16)
  });
});

describe('applyHannWindow', () => {
  it('zeros out the first and last samples', () => {
    const windowed = applyHannWindow([1, 1, 1, 1]);
    expect(windowed[0]).toBeCloseTo(0);
    expect(windowed[3]).toBeCloseTo(0);
  });

  it('preserves length', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(applyHannWindow(input).length).toBe(8);
  });

  it('has maximum near center', () => {
    const input = new Array(64).fill(1);
    const windowed = applyHannWindow(input);
    const maxIdx = windowed.indexOf(Math.max(...windowed));
    // Max should be near the center
    expect(maxIdx).toBeGreaterThan(20);
    expect(maxIdx).toBeLessThan(44);
  });
});

describe('getFrequencyBandEnergy', () => {
  it('returns the requested number of bands', () => {
    const samples = new Array(256).fill(0).map(() => Math.random() * 2 - 1);
    const bands = getFrequencyBandEnergy(samples, 0, 256, 4);
    expect(bands.length).toBe(4);
  });

  it('returns non-negative energies', () => {
    const samples = new Array(64).fill(0).map(() => Math.random() * 2 - 1);
    const bands = getFrequencyBandEnergy(samples, 0, 64, 8);
    bands.forEach((e) => expect(e).toBeGreaterThanOrEqual(0));
  });

  it('handles zero-padded window when startIdx + windowSize > samples.length', () => {
    const samples = [0.5, -0.5, 0.5, -0.5];
    // Window of 8 but only 4 samples — rest padded with 0
    const bands = getFrequencyBandEnergy(samples, 0, 8, 2);
    expect(bands.length).toBe(2);
    bands.forEach((e) => expect(e).toBeGreaterThanOrEqual(0));
  });
});
