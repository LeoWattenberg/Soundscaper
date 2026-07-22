/*
 * PFFFT-backed spectrogram analysis for the timeline canvas.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { fft, initializePffft, isPffftReady } from './pffft.js';

const listeners = new Set();
let revision = 0;
let preparation = null;

export function subscribePffftSpectrogram(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function pffftSpectrogramRevision() {
	return revision;
}

export function preparePffftSpectrogram(fftWindowSize) {
	normalizeWindowSize(fftWindowSize);
	if (!preparation) {
		preparation = initializePffft().then(() => {
			revision += 1;
			for (const listener of listeners) listener(revision);
		}).catch((error) => {
			preparation = null;
			throw error;
		});
	}
	return preparation;
}

export function pffftSpectrogramBandEnergies(waveformData, width, options = {}) {
	if (!isPffftReady()) return null;
	const fftWindowSize = normalizeWindowSize(options.fftWindowSize);
	const frequencyBands = normalizeBandCount(options.frequencyBands, fftWindowSize);
	const pixelSkip = Math.max(1, Math.floor(Number(options.pixelSkip) || 1));
	const samplesPerPixel = waveformData.length / Math.max(1, width);
	const columns = [];
	for (let pixel = 0; pixel < width; pixel += pixelSkip) {
		const sampleIndex = Math.floor(pixel * samplesPerPixel);
		if (sampleIndex >= waveformData.length) break;
		const real = new Float32Array(fftWindowSize);
		const imaginary = new Float32Array(fftWindowSize);
		for (let index = 0; index < fftWindowSize; index += 1) {
			const sample = Number(waveformData[sampleIndex + index]) || 0;
			real[index] = sample * (0.54 - 0.46 * Math.cos(2 * Math.PI * index / (fftWindowSize - 1)));
		}
		fft(real, imaginary, false);
		columns.push(groupComplexMagnitudes(real, imaginary, frequencyBands));
	}
	return columns;
}

export function renderPffftSpectrogram(context, waveformData, x, y, width, height, options = {}) {
	const columns = pffftSpectrogramBandEnergies(waveformData, width, options);
	if (!columns) return false;
	paintSpectrogram(context, columns, x, y, width, height, options);
	return true;
}

export function paintSpectrogram(context, columns, x, y, width, height, options = {}) {
	const frequencyBands = columns[0]?.length || normalizeBandCount(options.frequencyBands, options.fftWindowSize);
	const pixelSkip = Math.max(1, Math.floor(Number(options.pixelSkip) || 1));
	const intensityMultiplier = Number(options.intensityMultiplier) || 1.5;
	const scale = options.scale || 'mel';
	const minimumFrequency = Number(options.minFreq) || 10;
	const maximumFrequency = Number(options.maxFreq) || 22_050;
	for (let column = 0; column < columns.length; column += 1) {
		const bandEnergies = columns[column];
		const maximumEnergy = Math.max(...bandEnergies, 1e-4);
		for (let pixelY = 0; pixelY < height; pixelY += 1) {
			const normalized = 1 - pixelY / height;
			const frequency = normalizedToFrequency(normalized, minimumFrequency, maximumFrequency, scale);
			const band = Math.max(0, Math.min(frequencyBands - 1,
				Math.floor(frequency / maximumFrequency * frequencyBands)));
			const intensity = Math.min(1, Math.sqrt(bandEnergies[band] / maximumEnergy) * intensityMultiplier);
			context.fillStyle = spectrogramColor(intensity);
			context.fillRect(x + column * pixelSkip, y + pixelY, pixelSkip, 1);
		}
	}
}

function groupComplexMagnitudes(real, imaginary, frequencyBands) {
	const bandEnergies = new Array(frequencyBands).fill(0);
	const spectrumLength = real.length / 2;
	const binsPerBand = Math.max(1, Math.floor(spectrumLength / frequencyBands));
	for (let band = 0; band < frequencyBands; band += 1) {
		const start = band * binsPerBand;
		const end = Math.min(spectrumLength, start + binsPerBand);
		let sum = 0;
		for (let index = start; index < end; index += 1) sum += Math.hypot(real[index], imaginary[index]);
		bandEnergies[band] = sum / Math.max(1, end - start);
	}
	return bandEnergies;
}

function normalizedToFrequency(value, minimum, maximum, scale) {
	if (scale === 'linear') return minimum + value * (maximum - minimum);
	if (scale === 'log') return minimum * (maximum / minimum) ** value;
	const minimumMel = 2595 * Math.log10(1 + minimum / 700);
	const maximumMel = 2595 * Math.log10(1 + maximum / 700);
	return 700 * (10 ** ((minimumMel + value * (maximumMel - minimumMel)) / 2595) - 1);
}

function spectrogramColor(intensity) {
	const red = Math.round(255 * Math.min(1, intensity * 1.7));
	const green = Math.round(255 * Math.max(0, Math.min(1, intensity * 1.7 - 0.45)));
	const blue = Math.round(255 * Math.max(0.02, 1 - intensity * 1.35));
	return `rgb(${red}, ${green}, ${blue})`;
}

function normalizeWindowSize(value) {
	const size = Math.max(32, Math.min(4096, Math.floor(Number(value) || 64)));
	if ((size & (size - 1)) !== 0) throw new RangeError('PFFFT window size must be a power of two.');
	return size;
}

function normalizeBandCount(value, fftWindowSize = 64) {
	return Math.max(1, Math.min(Math.floor(normalizeWindowSize(fftWindowSize) / 2), Math.floor(Number(value) || 16)));
}
