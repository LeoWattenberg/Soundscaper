/*
 * PFFFT-backed spectrogram analysis for the timeline canvas.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const runners = new Map();
const listeners = new Set();
let revision = 0;

export function subscribePffftSpectrogram(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function pffftSpectrogramRevision() {
	return revision;
}

export function preparePffftSpectrogram(fftWindowSize) {
	const size = normalizeWindowSize(fftWindowSize);
	const existing = runners.get(size);
	if (existing) return existing.promise;
	const entry = { runner: null, error: null, promise: null };
	entry.promise = import('pretty-fast-fft')
		.then(({ createRunner }) => createRunner(size, size))
		.then((runner) => {
			entry.runner = runner;
			revision += 1;
			for (const listener of listeners) listener(revision);
			return runner;
		})
		.catch((error) => {
			entry.error = error;
			throw error;
		});
	runners.set(size, entry);
	return entry.promise;
}

export function pffftSpectrogramBandEnergies(waveformData, width, options = {}) {
	const fftWindowSize = normalizeWindowSize(options.fftWindowSize);
	const frequencyBands = normalizeBandCount(options.frequencyBands, fftWindowSize);
	const pixelSkip = Math.max(1, Math.floor(Number(options.pixelSkip) || 1));
	const columnCount = Math.max(0, Math.ceil(Math.max(0, width) / pixelSkip));
	const entry = runners.get(fftWindowSize);
	if (!entry?.runner || !columnCount) {
		if (!entry) void preparePffftSpectrogram(fftWindowSize).catch(() => {});
		return null;
	}

	const samples = packAnalysisWindows(waveformData, width, columnCount, pixelSkip, fftWindowSize);
	const magnitudes = entry.runner.processAudio(samples);
	return magnitudes.slice(0, columnCount).map((spectrum) => groupMagnitudes(spectrum, frequencyBands));
}

export function javascriptSpectrogramBandEnergies(waveformData, width, options = {}) {
	const fftWindowSize = normalizeWindowSize(options.fftWindowSize);
	const frequencyBands = normalizeBandCount(options.frequencyBands, fftWindowSize);
	const pixelSkip = Math.max(1, Math.floor(Number(options.pixelSkip) || 1));
	const samplesPerPixel = waveformData.length / Math.max(1, width);
	const columns = [];
	for (let pixel = 0; pixel < width; pixel += pixelSkip) {
		const sampleIndex = Math.floor(pixel * samplesPerPixel);
		if (sampleIndex >= waveformData.length) break;
		const window = new Array(fftWindowSize);
		for (let index = 0; index < fftWindowSize; index += 1) {
			const sample = Number(waveformData[sampleIndex + index]) || 0;
			window[index] = sample * (0.54 - 0.46 * Math.cos(2 * Math.PI * index / (fftWindowSize - 1)));
		}
		columns.push(groupMagnitudes(powerMagnitudes(fft(window)), frequencyBands));
	}
	return columns;
}

export function renderPffftSpectrogram(context, waveformData, x, y, width, height, options = {}) {
	const pffftColumns = pffftSpectrogramBandEnergies(waveformData, width, options);
	const columns = pffftColumns || javascriptSpectrogramBandEnergies(waveformData, width, options);
	paintSpectrogram(context, columns, x, y, width, height, options);
	return Boolean(pffftColumns);
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

function packAnalysisWindows(waveformData, width, columnCount, pixelSkip, fftWindowSize) {
	// PFFFT's runner advances by one complete block. Packing the requested
	// windows back-to-back preserves the legacy renderer's exact pixel-to-sample
	// projection, including fractional samples-per-pixel and zero padding.
	const packed = new Float32Array((columnCount + 1) * fftWindowSize);
	const samplesPerPixel = waveformData.length / Math.max(1, width);
	for (let column = 0; column < columnCount; column += 1) {
		const sourceStart = Math.floor(column * pixelSkip * samplesPerPixel);
		const available = Math.max(0, Math.min(fftWindowSize, waveformData.length - sourceStart));
		if (available <= 0) continue;
		const targetStart = column * fftWindowSize;
		for (let index = 0; index < available; index += 1) {
			packed[targetStart + index] = Number(waveformData[sourceStart + index]) || 0;
		}
	}
	return packed;
}

function groupMagnitudes(spectrum, frequencyBands) {
	const bandEnergies = new Array(frequencyBands).fill(0);
	const binsPerBand = Math.max(1, Math.floor(spectrum.length / frequencyBands));
	for (let band = 0; band < frequencyBands; band += 1) {
		const start = band * binsPerBand;
		const end = Math.min(spectrum.length, start + binsPerBand);
		let sum = 0;
		for (let index = start; index < end; index += 1) sum += Math.sqrt(Math.max(0, spectrum[index]));
		bandEnergies[band] = sum / Math.max(1, end - start);
	}
	return bandEnergies;
}

function fft(samples) {
	const count = samples.length;
	if (count <= 1) return { real: [...samples], imaginary: new Array(count).fill(0) };
	const even = fft(samples.filter((_, index) => index % 2 === 0));
	const odd = fft(samples.filter((_, index) => index % 2 === 1));
	const real = new Array(count);
	const imaginary = new Array(count);
	for (let index = 0; index < count / 2; index += 1) {
		const angle = -2 * Math.PI * index / count;
		const twiddleReal = Math.cos(angle) * odd.real[index] - Math.sin(angle) * odd.imaginary[index];
		const twiddleImaginary = Math.cos(angle) * odd.imaginary[index] + Math.sin(angle) * odd.real[index];
		real[index] = even.real[index] + twiddleReal;
		imaginary[index] = even.imaginary[index] + twiddleImaginary;
		real[index + count / 2] = even.real[index] - twiddleReal;
		imaginary[index + count / 2] = even.imaginary[index] - twiddleImaginary;
	}
	return { real, imaginary };
}

function powerMagnitudes(result) {
	return Array.from({ length: result.real.length / 2 }, (_, index) =>
		result.real[index] ** 2 + result.imaginary[index] ** 2);
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
