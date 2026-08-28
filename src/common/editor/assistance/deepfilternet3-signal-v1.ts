/* SPDX-License-Identifier: AGPL-3.0-only */

/** Owned DeepFilterNet3 analysis, feature normalization, filtering, and synthesis. */

export const ASSISTANCE_DEEPFILTER_SAMPLE_RATE = 48_000;
export const ASSISTANCE_DEEPFILTER_FFT_SIZE = 960;
export const ASSISTANCE_DEEPFILTER_HOP_FRAMES = 480;
export const ASSISTANCE_DEEPFILTER_FREQUENCY_BINS = 481;
export const ASSISTANCE_DEEPFILTER_ERB_BANDS = 32;
export const ASSISTANCE_DEEPFILTER_BINS = 96;
export const ASSISTANCE_DEEPFILTER_ORDER = 5;

const LOOKAHEAD = 2;
const MAXIMUM_ANALYSIS_BYTES = 3 * 1024 ** 3;
const AUXILIARY_FLOATS = ASSISTANCE_DEEPFILTER_FREQUENCY_BINS
	* ASSISTANCE_DEEPFILTER_ERB_BANDS * 2 + ASSISTANCE_DEEPFILTER_FFT_SIZE;
const ERB_WIDTHS = Object.freeze(createErbWidths());
const WINDOW = createVorbisWindow();
const FFT_PLAN = createBluesteinPlan(ASSISTANCE_DEEPFILTER_FFT_SIZE);

export interface AssistanceDeepFilterAnalysisV1 {
	readonly sampleCount: number;
	readonly frameCount: number;
	readonly spectrumReal: Float32Array;
	readonly spectrumImaginary: Float32Array;
	readonly erbFeatures: Float32Array;
	readonly spectrumFeatures: Float32Array;
}

export function reviewAssistanceDeepFilterAuxiliaryV1(value: Uint8Array): void {
	if (!(value instanceof Uint8Array)
		|| value.byteLength !== AUXILIARY_FLOATS * Float32Array.BYTES_PER_ELEMENT) {
		throw new RangeError('The DeepFilterNet3 auxiliary artifact has invalid geometry.');
	}
	const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
	let frequencyStart = 0;
	for (let band = 0; band < ERB_WIDTHS.length; band += 1) {
		const width = ERB_WIDTHS[band]!;
		for (let frequency = 0; frequency < ASSISTANCE_DEEPFILTER_FREQUENCY_BINS;
			frequency += 1) {
			const inBand = frequency >= frequencyStart && frequency < frequencyStart + width;
			const forward = view.getFloat32(
				(frequency * ASSISTANCE_DEEPFILTER_ERB_BANDS + band) * 4, true);
			const inverseOffset = ASSISTANCE_DEEPFILTER_FREQUENCY_BINS
				* ASSISTANCE_DEEPFILTER_ERB_BANDS;
			const inverse = view.getFloat32(
				(inverseOffset + band * ASSISTANCE_DEEPFILTER_FREQUENCY_BINS + frequency) * 4, true);
			if (!near(forward, inBand ? 1 / width : 0)
				|| !near(inverse, inBand ? 1 : 0)) {
				throw new TypeError('The DeepFilterNet3 auxiliary ERB matrices are not canonical.');
			}
		}
		frequencyStart += width;
	}
	const windowOffset = ASSISTANCE_DEEPFILTER_FREQUENCY_BINS
		* ASSISTANCE_DEEPFILTER_ERB_BANDS * 2;
	for (let frame = 0; frame < WINDOW.length; frame += 1) {
		if (!near(view.getFloat32((windowOffset + frame) * 4, true), WINDOW[frame]!)) {
			throw new TypeError('The DeepFilterNet3 auxiliary Vorbis window is not canonical.');
		}
	}
}

export function analyzeAssistanceDeepFilterChannelV1(
	value: Float32Array,
	signal?: AbortSignal,
): AssistanceDeepFilterAnalysisV1 {
	if (!(value instanceof Float32Array) || value.length < 1) {
		throw new TypeError('DeepFilterNet3 requires one non-empty Float32 channel.');
	}
	for (let index = 0; index < value.length; index += 1) {
		if ((index & 65_535) === 0) signal?.throwIfAborted();
		if (!Number.isFinite(value[index])) {
			throw new RangeError('DeepFilterNet3 input samples must be finite.');
		}
	}
	const frameCount = Math.floor((value.length + ASSISTANCE_DEEPFILTER_FFT_SIZE)
		/ ASSISTANCE_DEEPFILTER_HOP_FRAMES);
	preflight(frameCount);
	const spectrumLength = frameCount * ASSISTANCE_DEEPFILTER_FREQUENCY_BINS;
	const spectrumReal = new Float32Array(spectrumLength);
	const spectrumImaginary = new Float32Array(spectrumLength);
	const history = ASSISTANCE_DEEPFILTER_FFT_SIZE - ASSISTANCE_DEEPFILTER_HOP_FRAMES;
	const padded = new Float32Array(history + value.length + ASSISTANCE_DEEPFILTER_FFT_SIZE);
	padded.set(value, history);
	const frameReal = new Float64Array(ASSISTANCE_DEEPFILTER_FFT_SIZE);
	const frameImaginary = new Float64Array(ASSISTANCE_DEEPFILTER_FFT_SIZE);
	for (let frame = 0; frame < frameCount; frame += 1) {
		if ((frame & 63) === 0) signal?.throwIfAborted();
		const sourceStart = frame * ASSISTANCE_DEEPFILTER_HOP_FRAMES;
		for (let index = 0; index < ASSISTANCE_DEEPFILTER_FFT_SIZE; index += 1) {
			frameReal[index] = padded[sourceStart + index]! * WINDOW[index]!;
			frameImaginary[index] = 0;
		}
		transformBluestein(frameReal, frameImaginary, false);
		for (let frequency = 0; frequency < ASSISTANCE_DEEPFILTER_FREQUENCY_BINS;
			frequency += 1) {
			const output = frame * ASSISTANCE_DEEPFILTER_FREQUENCY_BINS + frequency;
			spectrumReal[output] = frameReal[frequency]! / ASSISTANCE_DEEPFILTER_FFT_SIZE;
			spectrumImaginary[output] = frameImaginary[frequency]!
				/ ASSISTANCE_DEEPFILTER_FFT_SIZE;
		}
	}
	const features = computeFeatures(spectrumReal, spectrumImaginary, frameCount, signal);
	return Object.freeze({ sampleCount: value.length, frameCount, spectrumReal,
		spectrumImaginary, erbFeatures: features.erb, spectrumFeatures: features.spectrum });
}

export function synthesizeAssistanceDeepFilterChannelV1(
	analysis: AssistanceDeepFilterAnalysisV1,
	erbMask: Float32Array,
	dfCoefficients: Float32Array,
	signal?: AbortSignal,
): Float32Array {
	const { frameCount } = analysis;
	assertAnalysis(analysis);
	finiteTensor(erbMask, frameCount * ASSISTANCE_DEEPFILTER_ERB_BANDS,
		'DeepFilterNet3 ERB mask', true);
	finiteTensor(dfCoefficients, ASSISTANCE_DEEPFILTER_ORDER * frameCount
		* ASSISTANCE_DEEPFILTER_BINS * 2, 'DeepFilterNet3 coefficients', false);
	const enhancedReal = new Float32Array(analysis.spectrumReal.length);
	const enhancedImaginary = new Float32Array(analysis.spectrumImaginary.length);
	for (let frame = 0; frame < frameCount; frame += 1) {
		if ((frame & 255) === 0) signal?.throwIfAborted();
		const base = frame * ASSISTANCE_DEEPFILTER_FREQUENCY_BINS;
		let frequency = 0;
		for (let band = 0; band < ASSISTANCE_DEEPFILTER_ERB_BANDS; band += 1) {
			const gain = erbMask[frame * ASSISTANCE_DEEPFILTER_ERB_BANDS + band]!;
			for (let offset = 0; offset < ERB_WIDTHS[band]!; offset += 1, frequency += 1) {
				enhancedReal[base + frequency] = analysis.spectrumReal[base + frequency]! * gain;
				enhancedImaginary[base + frequency] =
					analysis.spectrumImaginary[base + frequency]! * gain;
			}
		}
		for (frequency = 0; frequency < ASSISTANCE_DEEPFILTER_BINS; frequency += 1) {
			let outputReal = 0;
			let outputImaginary = 0;
			for (let tap = 0; tap < ASSISTANCE_DEEPFILTER_ORDER; tap += 1) {
				const sourceFrame = frame + tap - (ASSISTANCE_DEEPFILTER_ORDER - 1 - LOOKAHEAD);
				if (sourceFrame < 0 || sourceFrame >= frameCount) continue;
				const source = sourceFrame * ASSISTANCE_DEEPFILTER_FREQUENCY_BINS + frequency;
				const coefficient = ((tap * frameCount + frame)
					* ASSISTANCE_DEEPFILTER_BINS + frequency) * 2;
				const sourceReal = analysis.spectrumReal[source]!;
				const sourceImaginary = analysis.spectrumImaginary[source]!;
				const coefficientReal = dfCoefficients[coefficient]!;
				const coefficientImaginary = dfCoefficients[coefficient + 1]!;
				outputReal += sourceReal * coefficientReal - sourceImaginary * coefficientImaginary;
				outputImaginary += sourceReal * coefficientImaginary
					+ sourceImaginary * coefficientReal;
			}
			enhancedReal[base + frequency] = outputReal;
			enhancedImaginary[base + frequency] = outputImaginary;
		}
	}
	return synthesize(enhancedReal, enhancedImaginary, frameCount, analysis.sampleCount, signal);
}

function computeFeatures(
	real: Float32Array,
	imaginary: Float32Array,
	frameCount: number,
	signal?: AbortSignal,
): Readonly<{ erb: Float32Array; spectrum: Float32Array }> {
	const erb = new Float32Array(frameCount * ASSISTANCE_DEEPFILTER_ERB_BANDS);
	const spectrum = new Float32Array(2 * frameCount * ASSISTANCE_DEEPFILTER_BINS);
	const means = Float32Array.from({ length: ASSISTANCE_DEEPFILTER_ERB_BANDS },
		(_value, band) => -60 - 30 * band / (ASSISTANCE_DEEPFILTER_ERB_BANDS - 1));
	const units = Float32Array.from({ length: ASSISTANCE_DEEPFILTER_BINS },
		(_value, frequency) => 0.001 - 0.0009 * frequency / (ASSISTANCE_DEEPFILTER_BINS - 1));
	const channelStride = frameCount * ASSISTANCE_DEEPFILTER_BINS;
	for (let frame = 0; frame < frameCount; frame += 1) {
		if ((frame & 1_023) === 0) signal?.throwIfAborted();
		const base = frame * ASSISTANCE_DEEPFILTER_FREQUENCY_BINS;
		let frequency = 0;
		for (let band = 0; band < ERB_WIDTHS.length; band += 1) {
			const width = ERB_WIDTHS[band]!;
			let power = 0;
			for (let offset = 0; offset < width; offset += 1, frequency += 1) {
				power += real[base + frequency]! ** 2 + imaginary[base + frequency]! ** 2;
			}
			const decibels = 10 * Math.log10(power / width + 1e-10);
			means[band] = Math.fround(decibels * 0.01 + means[band]! * 0.99);
			erb[frame * ASSISTANCE_DEEPFILTER_ERB_BANDS + band] =
				Math.fround((decibels - means[band]!) / 40);
		}
		for (frequency = 0; frequency < ASSISTANCE_DEEPFILTER_BINS; frequency += 1) {
			const source = base + frequency;
			const magnitude = Math.hypot(real[source]!, imaginary[source]!);
			units[frequency] = Math.fround(magnitude * 0.01 + units[frequency]! * 0.99);
			const divisor = Math.sqrt(units[frequency]!);
			const target = frame * ASSISTANCE_DEEPFILTER_BINS + frequency;
			spectrum[target] = Math.fround(real[source]! / divisor);
			spectrum[channelStride + target] = Math.fround(imaginary[source]! / divisor);
		}
	}
	return Object.freeze({ erb, spectrum });
}

function synthesize(
	real: Float32Array,
	imaginary: Float32Array,
	frameCount: number,
	sampleCount: number,
	signal?: AbortSignal,
): Float32Array {
	const output = new Float32Array(sampleCount);
	const memory = new Float64Array(ASSISTANCE_DEEPFILTER_FFT_SIZE
		- ASSISTANCE_DEEPFILTER_HOP_FRAMES);
	const frameReal = new Float64Array(ASSISTANCE_DEEPFILTER_FFT_SIZE);
	const frameImaginary = new Float64Array(ASSISTANCE_DEEPFILTER_FFT_SIZE);
	const delay = ASSISTANCE_DEEPFILTER_FFT_SIZE - ASSISTANCE_DEEPFILTER_HOP_FRAMES;
	for (let frame = 0; frame < frameCount; frame += 1) {
		if ((frame & 63) === 0) signal?.throwIfAborted();
		const base = frame * ASSISTANCE_DEEPFILTER_FREQUENCY_BINS;
		for (let frequency = 0; frequency < ASSISTANCE_DEEPFILTER_FREQUENCY_BINS;
			frequency += 1) {
			frameReal[frequency] = real[base + frequency]!;
			frameImaginary[frequency] = imaginary[base + frequency]!;
		}
		for (let frequency = 1; frequency < ASSISTANCE_DEEPFILTER_FREQUENCY_BINS - 1;
			frequency += 1) {
			frameReal[ASSISTANCE_DEEPFILTER_FFT_SIZE - frequency] = frameReal[frequency]!;
			frameImaginary[ASSISTANCE_DEEPFILTER_FFT_SIZE - frequency] = -frameImaginary[frequency]!;
		}
		transformBluestein(frameReal, frameImaginary, true);
		const rawStart = frame * ASSISTANCE_DEEPFILTER_HOP_FRAMES;
		for (let index = 0; index < ASSISTANCE_DEEPFILTER_HOP_FRAMES; index += 1) {
			const sample = frameReal[index]! * ASSISTANCE_DEEPFILTER_FFT_SIZE * WINDOW[index]!
				+ memory[index]!;
			const rawIndex = rawStart + index;
			if (rawIndex >= delay && rawIndex < delay + sampleCount) {
				output[rawIndex - delay] = sample;
			}
			memory[index] = frameReal[index + ASSISTANCE_DEEPFILTER_HOP_FRAMES]!
				* ASSISTANCE_DEEPFILTER_FFT_SIZE
				* WINDOW[index + ASSISTANCE_DEEPFILTER_HOP_FRAMES]!;
		}
	}
	return output;
}

interface BluesteinPlan {
	readonly size: number;
	readonly convolutionSize: number;
	readonly cosine: Float64Array;
	readonly sine: Float64Array;
	readonly kernelReal: Float64Array;
	readonly kernelImaginary: Float64Array;
}

function createBluesteinPlan(size: number): BluesteinPlan {
	let convolutionSize = 1;
	while (convolutionSize < size * 2 - 1) convolutionSize *= 2;
	const cosine = new Float64Array(size);
	const sine = new Float64Array(size);
	const kernelReal = new Float64Array(convolutionSize);
	const kernelImaginary = new Float64Array(convolutionSize);
	for (let index = 0; index < size; index += 1) {
		const angle = Math.PI * (index * index % (size * 2)) / size;
		cosine[index] = Math.cos(angle);
		sine[index] = Math.sin(angle);
		kernelReal[index] = cosine[index]!;
		kernelImaginary[index] = sine[index]!;
		if (index !== 0) {
			kernelReal[convolutionSize - index] = cosine[index]!;
			kernelImaginary[convolutionSize - index] = sine[index]!;
		}
	}
	fftRadixTwo(kernelReal, kernelImaginary, false);
	return { size, convolutionSize, cosine, sine, kernelReal, kernelImaginary };
}

function transformBluestein(real: Float64Array, imaginary: Float64Array, inverse: boolean): void {
	if (inverse) {
		for (let index = 0; index < imaginary.length; index += 1) {
			imaginary[index] = (imaginary[index] ?? 0) * -1;
		}
		transformBluestein(real, imaginary, false);
		for (let index = 0; index < imaginary.length; index += 1) {
			real[index] = (real[index] ?? 0) / FFT_PLAN.size;
			imaginary[index] = -imaginary[index]! / FFT_PLAN.size;
		}
		return;
	}
	const workReal = new Float64Array(FFT_PLAN.convolutionSize);
	const workImaginary = new Float64Array(FFT_PLAN.convolutionSize);
	for (let index = 0; index < FFT_PLAN.size; index += 1) {
		const cosine = FFT_PLAN.cosine[index]!;
		const sine = FFT_PLAN.sine[index]!;
		workReal[index] = real[index]! * cosine + imaginary[index]! * sine;
		workImaginary[index] = imaginary[index]! * cosine - real[index]! * sine;
	}
	fftRadixTwo(workReal, workImaginary, false);
	for (let index = 0; index < workReal.length; index += 1) {
		const candidateReal = workReal[index]! * FFT_PLAN.kernelReal[index]!
			- workImaginary[index]! * FFT_PLAN.kernelImaginary[index]!;
		workImaginary[index] = workReal[index]! * FFT_PLAN.kernelImaginary[index]!
			+ workImaginary[index]! * FFT_PLAN.kernelReal[index]!;
		workReal[index] = candidateReal;
	}
	fftRadixTwo(workReal, workImaginary, true);
	for (let index = 0; index < FFT_PLAN.size; index += 1) {
		const cosine = FFT_PLAN.cosine[index]!;
		const sine = FFT_PLAN.sine[index]!;
		real[index] = workReal[index]! * cosine + workImaginary[index]! * sine;
		imaginary[index] = workImaginary[index]! * cosine - workReal[index]! * sine;
	}
}

function fftRadixTwo(real: Float64Array, imaginary: Float64Array, inverse: boolean): void {
	for (let source = 1, destination = 0; source < real.length; source += 1) {
		let bit = real.length >> 1;
		for (; destination & bit; bit >>= 1) destination ^= bit;
		destination ^= bit;
		if (source < destination) {
			[real[source], real[destination]] = [real[destination]!, real[source]!];
			[imaginary[source], imaginary[destination]] = [imaginary[destination]!, imaginary[source]!];
		}
	}
	for (let length = 2; length <= real.length; length *= 2) {
		const angle = (inverse ? 2 : -2) * Math.PI / length;
		const rootReal = Math.cos(angle);
		const rootImaginary = Math.sin(angle);
		for (let start = 0; start < real.length; start += length) {
			let factorReal = 1;
			let factorImaginary = 0;
			for (let index = 0; index < length / 2; index += 1) {
				const even = start + index;
				const odd = even + length / 2;
				const oddReal = real[odd]! * factorReal - imaginary[odd]! * factorImaginary;
				const oddImaginary = real[odd]! * factorImaginary + imaginary[odd]! * factorReal;
				real[odd] = real[even]! - oddReal;
				imaginary[odd] = imaginary[even]! - oddImaginary;
				real[even] = (real[even] ?? 0) + oddReal;
				imaginary[even] = (imaginary[even] ?? 0) + oddImaginary;
				const nextReal = factorReal * rootReal - factorImaginary * rootImaginary;
				factorImaginary = factorReal * rootImaginary + factorImaginary * rootReal;
				factorReal = nextReal;
			}
		}
	}
	if (inverse) {
		for (let index = 0; index < real.length; index += 1) {
			real[index] = (real[index] ?? 0) / real.length;
			imaginary[index] = (imaginary[index] ?? 0) / real.length;
		}
	}
}

function createErbWidths(): number[] {
	const toErb = (frequency: number) => 9.265 * Math.log1p(frequency / (24.7 * 9.265));
	const toFrequency = (erb: number) => 24.7 * 9.265 * Math.expm1(erb / 9.265);
	const maximum = toErb(ASSISTANCE_DEEPFILTER_SAMPLE_RATE / 2);
	const binWidth = ASSISTANCE_DEEPFILTER_SAMPLE_RATE / ASSISTANCE_DEEPFILTER_FFT_SIZE;
	const widths: number[] = [];
	let previous = 0;
	let carried = 0;
	for (let band = 1; band <= ASSISTANCE_DEEPFILTER_ERB_BANDS; band += 1) {
		const boundary = Math.round(toFrequency(maximum * band / ASSISTANCE_DEEPFILTER_ERB_BANDS)
			/ binWidth);
		let width = boundary - previous - carried;
		if (width < 2) { carried = 2 - width; width = 2; } else carried = 0;
		widths.push(width);
		previous = boundary;
	}
	widths[widths.length - 1]! += 1;
	widths[widths.length - 1]! -= widths.reduce((total, width) => total + width, 0)
		- ASSISTANCE_DEEPFILTER_FREQUENCY_BINS;
	return widths;
}

function createVorbisWindow(): Float32Array {
	return Float32Array.from({ length: ASSISTANCE_DEEPFILTER_FFT_SIZE }, (_value, frame) => {
		const inner = Math.sin(Math.PI * (frame + 0.5) / ASSISTANCE_DEEPFILTER_FFT_SIZE);
		return Math.sin(0.5 * Math.PI * inner * inner);
	});
}

function assertAnalysis(value: AssistanceDeepFilterAnalysisV1): void {
	const spectrumLength = value.frameCount * ASSISTANCE_DEEPFILTER_FREQUENCY_BINS;
	if (!Number.isSafeInteger(value.sampleCount) || value.sampleCount < 1
		|| !Number.isSafeInteger(value.frameCount) || value.frameCount < 1
		|| value.spectrumReal.length !== spectrumLength
		|| value.spectrumImaginary.length !== spectrumLength
		|| value.erbFeatures.length !== value.frameCount * ASSISTANCE_DEEPFILTER_ERB_BANDS
		|| value.spectrumFeatures.length !== 2 * value.frameCount * ASSISTANCE_DEEPFILTER_BINS) {
		throw new RangeError('DeepFilterNet3 analysis geometry is invalid.');
	}
}

function finiteTensor(value: Float32Array, length: number, label: string, unit: boolean): void {
	if (!(value instanceof Float32Array) || value.length !== length) {
		throw new RangeError(`${label} tensor geometry is invalid.`);
	}
	for (const candidate of value) {
		if (!Number.isFinite(candidate) || unit && (candidate < 0 || candidate > 1)) {
			throw new RangeError(`${label} must contain only finite${unit ? ' unit-range' : ''} values.`);
		}
	}
}

function preflight(frameCount: number): void {
	const floatCount = frameCount * (ASSISTANCE_DEEPFILTER_FREQUENCY_BINS * 4
		+ ASSISTANCE_DEEPFILTER_ERB_BANDS * 2 + ASSISTANCE_DEEPFILTER_BINS * 12);
	if (!Number.isSafeInteger(frameCount) || frameCount < 1
		|| !Number.isSafeInteger(floatCount) || floatCount * 4 > MAXIMUM_ANALYSIS_BYTES) {
		throw new RangeError('DeepFilterNet3 analysis exceeds its admitted CPU memory capacity.');
	}
}

function near(left: number, right: number): boolean {
	return Number.isFinite(left) && Math.abs(left - right) <= 1e-5;
}
