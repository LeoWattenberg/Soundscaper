/*
 * PFFFT-backed spectrogram analysis for the timeline canvas.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const listeners = new Set();
const analysisWindows = new Map();
const fftScratchBuffers = new Map();
const rowSpanCache = new Map();
const colorCache = new Map();
const MAXIMUM_ROW_SPAN_CACHE_ENTRIES = 32;
const MAXIMUM_COLOR_CACHE_ENTRIES = 512;
let revision = 0;
let preparation = null;
let runtime = null;
let scratchAllocations = 0;

export function subscribePffftSpectrogram(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function pffftSpectrogramRevision() {
	return revision;
}

export function pffftSpectrogramCacheSnapshot() {
	return Object.freeze({ scratchAllocations, scratchBufferSets: fftScratchBuffers.size });
}

export function preparePffftSpectrogram(fftWindowSize) {
	normalizeWindowSize(fftWindowSize);
	if (!preparation) {
		preparation = import('./pffft.js').then(async (module) => {
			await module.initializePffft();
			runtime = module;
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
	if (!runtime?.isPffftReady()) return null;
	const fftWindowSize = normalizeWindowSize(options.fftWindowSize);
	const frequencyBands = normalizeBandCount(options.frequencyBands, fftWindowSize);
	const pixelSkip = Math.max(1, Math.floor(Number(options.pixelSkip) || 1));
	const samplesPerPixel = waveformData.length / Math.max(1, width);
	const window = spectrogramWindow(fftWindowSize, options.windowType);
	const { real, imaginary } = fftScratch(fftWindowSize);
	const columns = [];
	for (let pixel = 0; pixel < width; pixel += pixelSkip) {
		const sampleIndex = Math.floor(pixel * samplesPerPixel);
		if (sampleIndex >= waveformData.length) break;
		imaginary.fill(0);
		for (let index = 0; index < fftWindowSize; index += 1) {
			const sample = Number(waveformData[sampleIndex + index]) || 0;
			real[index] = sample * window.values[index];
		}
		runtime.fft(real, imaginary, false);
		columns.push(groupComplexMagnitudes(
			real,
			imaginary,
			frequencyBands,
			2 / (fftWindowSize * window.coherentGain),
		));
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
	const scale = normalizeScale(options.scale);
	const minimumFrequency = nonNegativeFinite(options.minFreq, 10);
	const requestedMaximum = positiveFinite(options.maxFreq, 22_050);
	const sampleRate = positiveFiniteOrNull(options.sampleRate);
	const nyquistFrequency = positiveFinite(
		options.nyquistFrequency,
		sampleRate === null ? requestedMaximum : sampleRate / 2,
	);
	const maximumFrequency = Math.max(
		minimumFrequency + Number.EPSILON,
		Math.min(requestedMaximum, nyquistFrequency),
	);
	const gainDb = finiteOrNull(options.gainDb);
	const rangeDb = positiveFiniteOrNull(options.rangeDb);
	const rowSpans = spectrogramRowSpans(
		height,
		frequencyBands,
		scale,
		minimumFrequency,
		maximumFrequency,
		nyquistFrequency,
	);
	for (let column = 0; column < columns.length; column += 1) {
		const bandEnergies = columns[column];
		const columnX = column * pixelSkip;
		const columnWidth = Math.min(pixelSkip, width - columnX);
		if (!(columnWidth > 0)) break;
		let maximumEnergy = 1e-4;
		if (gainDb === null || rangeDb === null) {
			for (const energy of bandEnergies) maximumEnergy = Math.max(maximumEnergy, energy);
		}
		for (const span of rowSpans) {
			const energy = Math.max(0, Number(bandEnergies[span.band]) || 0);
			const intensity = gainDb !== null && rangeDb !== null
				? decibelIntensity(energy, gainDb, rangeDb)
				: Math.min(1, Math.sqrt(energy / maximumEnergy) * intensityMultiplier);
			context.fillStyle = spectrogramColor(intensity);
			context.fillRect(x + columnX, y + span.start, columnWidth, span.height);
		}
	}
}

function fftScratch(size) {
	const cached = fftScratchBuffers.get(size);
	if (cached) return cached;
	const buffers = Object.freeze({
		real: new Float32Array(size),
		imaginary: new Float32Array(size),
	});
	fftScratchBuffers.set(size, buffers);
	scratchAllocations += 1;
	return buffers;
}

function spectrogramWindow(size, value) {
	const type = normalizeWindowType(value);
	const key = `${type}:${size}`;
	const cached = analysisWindows.get(key);
	if (cached) return cached;
	const denominator = Math.max(1, size - 1);
	const window = Float32Array.from({ length: size }, (_, index) => {
		const phase = 2 * Math.PI * index / denominator;
		if (type === 'hann') return 0.5 - 0.5 * Math.cos(phase);
		if (type === 'blackman') return 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(phase * 2);
		return 0.54 - 0.46 * Math.cos(phase);
	});
	const coherentGain = Math.max(Number.EPSILON,
		window.reduce((sum, coefficient) => sum + coefficient, 0) / size);
	const result = Object.freeze({ values: window, coherentGain });
	analysisWindows.set(key, result);
	return result;
}

function normalizeWindowType(value) {
	const type = String(value || 'hamming').toLowerCase();
	return type === 'hann' || type === 'blackman' ? type : 'hamming';
}

function decibelIntensity(energy, gainDb, rangeDb) {
	const decibels = 20 * Math.log10(Math.max(Number.MIN_VALUE, energy));
	return Math.max(0, Math.min(1, (decibels + gainDb + rangeDb) / rangeDb));
}

function finiteOrNull(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function positiveFiniteOrNull(value) {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegativeFinite(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function positiveFinite(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? number : fallback;
}

function spectrogramRowSpans(
	height,
	frequencyBands,
	scale,
	minimumFrequency,
	maximumFrequency,
	nyquistFrequency,
) {
	if (!(height > 0) || !(frequencyBands > 0)) return [];
	const key = [
		height, frequencyBands, scale, minimumFrequency, maximumFrequency, nyquistFrequency,
	].join('|');
	const cached = rowSpanCache.get(key);
	if (cached) {
		rowSpanCache.delete(key);
		rowSpanCache.set(key, cached);
		return cached;
	}
	const spans = [];
	let active = null;
	for (let pixelY = 0; pixelY < height; pixelY += 1) {
		const normalized = 1 - pixelY / height;
		const frequency = normalizedToFrequency(normalized, minimumFrequency, maximumFrequency, scale);
		const band = Math.max(0, Math.min(frequencyBands - 1,
			Math.floor(frequency / nyquistFrequency * frequencyBands)));
		if (active?.band === band) {
			active.end = pixelY + 1;
			continue;
		}
		if (active) spans.push(active);
		active = { band, start: pixelY, end: pixelY + 1 };
	}
	if (active) spans.push(active);
	const bounded = spans.map((span) => Object.freeze({
		band: span.band,
		start: span.start,
		height: Math.min(height, span.end) - span.start,
	})).filter((span) => span.height > 0);
	rowSpanCache.set(key, bounded);
	if (rowSpanCache.size > MAXIMUM_ROW_SPAN_CACHE_ENTRIES) {
		rowSpanCache.delete(rowSpanCache.keys().next().value);
	}
	return bounded;
}

function groupComplexMagnitudes(real, imaginary, frequencyBands, magnitudeScale = 1) {
	const bandEnergies = new Array(frequencyBands).fill(0);
	const spectrumLength = real.length / 2;
	for (let band = 0; band < frequencyBands; band += 1) {
		const start = Math.floor(band * spectrumLength / frequencyBands);
		const end = Math.max(start + 1,
			Math.floor((band + 1) * spectrumLength / frequencyBands));
		let sum = 0;
		for (let index = start; index < end; index += 1) sum += Math.hypot(real[index], imaginary[index]);
		bandEnergies[band] = sum / Math.max(1, end - start) * magnitudeScale;
	}
	return bandEnergies;
}

function normalizedToFrequency(value, minimum, maximum, scale) {
	if (value <= 0) return minimum;
	if (value >= 1) return maximum;
	if (scale === 'linear') return minimum + value * (maximum - minimum);
	const minimumScaled = scaleFrequency(minimum, scale);
	const maximumScaled = scaleFrequency(maximum, scale);
	const target = minimumScaled + value * (maximumScaled - minimumScaled);
	let low = minimum;
	let high = maximum;
	for (let iteration = 0; iteration < 32; iteration += 1) {
		const midpoint = (low + high) / 2;
		if (scaleFrequency(midpoint, scale) < target) low = midpoint;
		else high = midpoint;
	}
	return (low + high) / 2;
}

function normalizeScale(value) {
	const scale = String(value || 'mel').toLowerCase();
	if (scale === 'log') return 'logarithmic';
	return ['linear', 'logarithmic', 'mel', 'bark', 'erb', 'period'].includes(scale)
		? scale
		: 'mel';
}

function scaleFrequency(value, scale) {
	const frequency = Math.max(0, Number(value) || 0);
	if (scale === 'linear') return frequency;
	if (scale === 'logarithmic') return Math.log1p(frequency);
	if (scale === 'bark') {
		return 13 * Math.atan(0.00076 * frequency)
			+ 3.5 * Math.atan((frequency / 7_500) ** 2);
	}
	if (scale === 'erb') return 21.4 * Math.log10(1 + 0.00437 * frequency);
	if (scale === 'period') return frequency / (frequency + 1_000);
	return 2_595 * Math.log10(1 + frequency / 700);
}

function spectrogramColor(intensity) {
	const red = Math.round(255 * Math.min(1, intensity * 1.7));
	const green = Math.round(255 * Math.max(0, Math.min(1, intensity * 1.7 - 0.45)));
	const blue = Math.round(255 * Math.max(0.02, 1 - intensity * 1.35));
	const key = `${red}|${green}|${blue}`;
	const cached = colorCache.get(key);
	if (cached) return cached;
	const color = `rgb(${red}, ${green}, ${blue})`;
	colorCache.set(key, color);
	if (colorCache.size > MAXIMUM_COLOR_CACHE_ENTRIES) colorCache.delete(colorCache.keys().next().value);
	return color;
}

function normalizeWindowSize(value) {
	const size = Math.max(32, Math.min(8192, Math.floor(Number(value) || 64)));
	if ((size & (size - 1)) !== 0) throw new RangeError('PFFFT window size must be a power of two.');
	return size;
}

function normalizeBandCount(value, fftWindowSize = 64) {
	return Math.max(1, Math.min(Math.floor(normalizeWindowSize(fftWindowSize) / 2), Math.floor(Number(value) || 16)));
}
