/*
 * PFFFT-backed spectrogram analysis for the timeline canvas.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const listeners = new Set();
const hammingWindows = new Map();
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
	const window = hammingWindow(fftWindowSize);
	const { real, imaginary } = fftScratch(fftWindowSize);
	const columns = [];
	for (let pixel = 0; pixel < width; pixel += pixelSkip) {
		const sampleIndex = Math.floor(pixel * samplesPerPixel);
		if (sampleIndex >= waveformData.length) break;
		imaginary.fill(0);
		for (let index = 0; index < fftWindowSize; index += 1) {
			const sample = Number(waveformData[sampleIndex + index]) || 0;
			real[index] = sample * window[index];
		}
		runtime.fft(real, imaginary, false);
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
	const rowSpans = spectrogramRowSpans(
		height,
		frequencyBands,
		scale,
		minimumFrequency,
		maximumFrequency,
	);
	for (let column = 0; column < columns.length; column += 1) {
		const bandEnergies = columns[column];
		const columnX = column * pixelSkip;
		const columnWidth = Math.min(pixelSkip, width - columnX);
		if (!(columnWidth > 0)) break;
		let maximumEnergy = 1e-4;
		for (const energy of bandEnergies) maximumEnergy = Math.max(maximumEnergy, energy);
		for (const span of rowSpans) {
			const intensity = Math.min(1, Math.sqrt(bandEnergies[span.band] / maximumEnergy) * intensityMultiplier);
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

function hammingWindow(size) {
	const cached = hammingWindows.get(size);
	if (cached) return cached;
	const window = Float32Array.from({ length: size }, (_, index) => (
		0.54 - 0.46 * Math.cos(2 * Math.PI * index / (size - 1))
	));
	hammingWindows.set(size, window);
	return window;
}

function spectrogramRowSpans(height, frequencyBands, scale, minimumFrequency, maximumFrequency) {
	if (!(height > 0) || !(frequencyBands > 0)) return [];
	const key = [height, frequencyBands, scale, minimumFrequency, maximumFrequency].join('|');
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
			Math.floor(frequency / maximumFrequency * frequencyBands)));
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
	const key = `${red}|${green}|${blue}`;
	const cached = colorCache.get(key);
	if (cached) return cached;
	const color = `rgb(${red}, ${green}, ${blue})`;
	colorCache.set(key, color);
	if (colorCache.size > MAXIMUM_COLOR_CACHE_ENTRIES) colorCache.delete(colorCache.keys().next().value);
	return color;
}

function normalizeWindowSize(value) {
	const size = Math.max(32, Math.min(4096, Math.floor(Number(value) || 64)));
	if ((size & (size - 1)) !== 0) throw new RangeError('PFFFT window size must be a power of two.');
	return size;
}

function normalizeBandCount(value, fftWindowSize = 64) {
	return Math.max(1, Math.min(Math.floor(normalizeWindowSize(fftWindowSize) / 2), Math.floor(Number(value) || 16)));
}
