/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Owned deterministic signal geometry for the pinned dereverb-room reference.
 *
 * Reproduces, exactly, the DSP that surrounds the converted BS-RoFormer neural
 * core: the MSST generic demix chunking (384000-frame chunks, 192000-frame
 * step, border reflection padding, linear fade overlap weights) and the
 * PyTorch-compatible centered periodic-Hann STFT/ISTFT pair the parity
 * evidence validates. The model is mono; every function here operates on one
 * channel plane, and callers dispatch stereo per channel.
 */

export const ASSISTANCE_DEREVERB_ROOM_SAMPLE_RATE = 44_100;
export const ASSISTANCE_DEREVERB_ROOM_FFT_SIZE = 2_048;
export const ASSISTANCE_DEREVERB_ROOM_STFT_HOP_FRAMES = 512;
export const ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES = 384_000;
export const ASSISTANCE_DEREVERB_ROOM_CHUNK_STEP_FRAMES = 192_000;
export const ASSISTANCE_DEREVERB_ROOM_BORDER_FRAMES = 192_000;
export const ASSISTANCE_DEREVERB_ROOM_FADE_FRAMES = 38_400;

const CENTER_PADDING_FRAMES = ASSISTANCE_DEREVERB_ROOM_FFT_SIZE / 2;
const FREQUENCY_BIN_COUNT = ASSISTANCE_DEREVERB_ROOM_FFT_SIZE / 2 + 1;
const MAXIMUM_SOURCE_FRAMES = 24 * 60 * 60 * ASSISTANCE_DEREVERB_ROOM_SAMPLE_RATE;
const MAXIMUM_CHUNKS = 100_000;
const HALF_CHUNK_FRAMES = ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES / 2;

const PLAN_REQUEST_FIELDS = Object.freeze(['schemaVersion', 'sourceFrameCount'] as const);
const PLAN_FIELDS = Object.freeze([
	'schemaVersion', 'sourceFrameCount', 'borderFrames', 'paddedFrameCount', 'chunks',
] as const);
const CHUNK_FIELDS = Object.freeze([
	'chunkIndex', 'paddedStartFrame', 'availableFrameCount', 'tailPadMode',
	'fadeIn', 'fadeOut',
] as const);
const EXTRACT_FIELDS = Object.freeze([
	'schemaVersion', 'plan', 'chunkIndex', 'channel',
] as const);
const MERGE_FIELDS = Object.freeze(['schemaVersion', 'plan', 'chunks'] as const);
const MERGE_CHUNK_FIELDS = Object.freeze(['chunkIndex', 'channel'] as const);
const STFT_FIELDS = Object.freeze(['schemaVersion', 'sampleRate', 'channel'] as const);
const ISTFT_FIELDS = Object.freeze(['schemaVersion', 'spectrum', 'sourceFrameCount'] as const);
const SPECTRUM_FIELDS = Object.freeze([
	'schemaVersion', 'sampleRate', 'fftSize', 'hopFrames', 'frequencyBinCount',
	'timeFrameCount', 'real', 'imaginary',
] as const);

export interface DereverbRoomChunkV1 {
	readonly chunkIndex: number;
	readonly paddedStartFrame: number;
	readonly availableFrameCount: number;
	readonly tailPadMode: 'none' | 'reflect' | 'zero';
	readonly fadeIn: boolean;
	readonly fadeOut: boolean;
}

export interface DereverbRoomChunkPlanV1 {
	readonly schemaVersion: 1;
	readonly sourceFrameCount: number;
	readonly borderFrames: number;
	readonly paddedFrameCount: number;
	readonly chunks: readonly DereverbRoomChunkV1[];
}

export interface DereverbRoomSpectrumV1 {
	readonly schemaVersion: 1;
	readonly sampleRate: typeof ASSISTANCE_DEREVERB_ROOM_SAMPLE_RATE;
	readonly fftSize: typeof ASSISTANCE_DEREVERB_ROOM_FFT_SIZE;
	readonly hopFrames: typeof ASSISTANCE_DEREVERB_ROOM_STFT_HOP_FRAMES;
	readonly frequencyBinCount: typeof FREQUENCY_BIN_COUNT;
	readonly timeFrameCount: number;
	readonly real: Float32Array;
	readonly imaginary: Float32Array;
}

/** Reproduce the MSST generic-demix chunk inventory for one mono signal. */
export function createDereverbRoomChunkPlanV1(value: unknown): DereverbRoomChunkPlanV1 {
	const row = exactRecord(value, PLAN_REQUEST_FIELDS, 'dereverb-room chunk-plan request');
	version(row.schemaVersion, 'dereverb-room chunk plan');
	const sourceFrameCount = integer(row.sourceFrameCount, 1, MAXIMUM_SOURCE_FRAMES,
		'dereverb-room source frame count');
	const borderFrames = sourceFrameCount > 2 * ASSISTANCE_DEREVERB_ROOM_BORDER_FRAMES
		? ASSISTANCE_DEREVERB_ROOM_BORDER_FRAMES : 0;
	const paddedFrameCount = sourceFrameCount + 2 * borderFrames;
	const chunks: DereverbRoomChunkV1[] = [];
	for (let start = 0; start < paddedFrameCount;
		start += ASSISTANCE_DEREVERB_ROOM_CHUNK_STEP_FRAMES) {
		if (chunks.length >= MAXIMUM_CHUNKS) {
			throw new RangeError('The dereverb-room chunk inventory exceeds its exact bound.');
		}
		const availableFrameCount = Math.min(ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES,
			paddedFrameCount - start);
		chunks.push(Object.freeze({
			chunkIndex: chunks.length,
			paddedStartFrame: start,
			availableFrameCount,
			tailPadMode: availableFrameCount === ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES
				? 'none' as const
				: availableFrameCount > HALF_CHUNK_FRAMES ? 'reflect' as const : 'zero' as const,
			fadeIn: start !== 0,
			fadeOut: start + ASSISTANCE_DEREVERB_ROOM_CHUNK_STEP_FRAMES < paddedFrameCount,
		}));
	}
	return Object.freeze({
		schemaVersion: 1, sourceFrameCount, borderFrames, paddedFrameCount,
		chunks: Object.freeze(chunks),
	});
}

/** Materialize one border-reflected, tail-padded mono model session. */
export function extractDereverbRoomChunkV1(value: unknown): Float32Array {
	const row = exactRecord(value, EXTRACT_FIELDS, 'dereverb-room chunk extraction');
	version(row.schemaVersion, 'dereverb-room chunk extraction');
	const plan = validatePlan(row.plan);
	const chunkIndex = integer(row.chunkIndex, 0, plan.chunks.length - 1,
		'dereverb-room chunk index');
	const channel = finitePlane(row.channel, plan.sourceFrameCount, 'dereverb-room source');
	const chunk = plan.chunks[chunkIndex]!;
	const output = new Float32Array(ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES);
	for (let frame = 0; frame < chunk.availableFrameCount; frame += 1) {
		output[frame] = plan.borderFrames === 0
			? channel[chunk.paddedStartFrame + frame]!
			: reflectedSample(channel, chunk.paddedStartFrame + frame - plan.borderFrames);
	}
	if (chunk.tailPadMode === 'reflect') {
		for (let frame = chunk.availableFrameCount;
			frame < ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES; frame += 1) {
			output[frame] = output[2 * chunk.availableFrameCount - 2 - frame]!;
		}
	}
	return output;
}

/** Merge every model session with the reference's linear fade overlap weights. */
export function mergeDereverbRoomChunksV1(value: unknown): Float32Array {
	const row = exactRecord(value, MERGE_FIELDS, 'dereverb-room chunk merge');
	version(row.schemaVersion, 'dereverb-room chunk merge');
	const plan = validatePlan(row.plan);
	const chunks = boundedArray(row.chunks, plan.chunks.length, plan.chunks.length,
		'dereverb-room output chunk inventory');
	const accumulator = new Float64Array(plan.paddedFrameCount);
	const weights = new Float64Array(plan.paddedFrameCount);
	for (let index = 0; index < chunks.length; index += 1) {
		const record = exactRecord(chunks[index], MERGE_CHUNK_FIELDS,
			`dereverb-room output chunk ${String(index)}`);
		if (record.chunkIndex !== index) {
			throw new TypeError('The dereverb-room output chunk inventory must be complete and ordered.');
		}
		const plane = finitePlane(record.channel, ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES,
			`dereverb-room output chunk ${String(index)}`);
		const chunk = plan.chunks[index]!;
		for (let frame = 0; frame < chunk.availableFrameCount; frame += 1) {
			const weight = fadeWeight(frame, chunk.fadeIn, chunk.fadeOut);
			accumulator[chunk.paddedStartFrame + frame]! += plane[frame]! * weight;
			weights[chunk.paddedStartFrame + frame]! += weight;
		}
	}
	const output = new Float32Array(plan.sourceFrameCount);
	for (let frame = 0; frame < output.length; frame += 1) {
		const padded = plan.borderFrames + frame;
		const weight = weights[padded]!;
		output[frame] = weight > 0 ? accumulator[padded]! / weight : 0;
	}
	return output;
}

/** The reference's per-frame linear fade weight for one chunk position. */
export function dereverbRoomFadeWeightV1(frame: number, fadeIn: boolean, fadeOut: boolean): number {
	const index = integer(frame, 0, ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES - 1,
		'dereverb-room fade frame');
	return fadeWeight(index, fadeIn === true, fadeOut === true);
}

/** PyTorch-compatible centered periodic-Hann STFT used before mask inference. */
export function dereverbRoomStftV1(value: unknown): DereverbRoomSpectrumV1 {
	const row = exactRecord(value, STFT_FIELDS, 'dereverb-room STFT request');
	version(row.schemaVersion, 'dereverb-room STFT');
	rate(row.sampleRate);
	const channel = finitePlane(row.channel, null, 'dereverb-room STFT source');
	if (channel.length <= CENTER_PADDING_FRAMES) {
		throw new RangeError('dereverb-room centered reflection padding needs more than 1024 source frames.');
	}
	const timeFrameCount = Math.floor(channel.length
		/ ASSISTANCE_DEREVERB_ROOM_STFT_HOP_FRAMES) + 1;
	const window = periodicHann();
	const realOutput = new Float32Array(timeFrameCount * FREQUENCY_BIN_COUNT);
	const imaginaryOutput = new Float32Array(realOutput.length);
	for (let time = 0; time < timeFrameCount; time += 1) {
		const real = new Float64Array(ASSISTANCE_DEREVERB_ROOM_FFT_SIZE);
		const imaginary = new Float64Array(ASSISTANCE_DEREVERB_ROOM_FFT_SIZE);
		const paddedStart = time * ASSISTANCE_DEREVERB_ROOM_STFT_HOP_FRAMES;
		for (let frame = 0; frame < ASSISTANCE_DEREVERB_ROOM_FFT_SIZE; frame += 1) {
			real[frame] = reflectedSample(channel, paddedStart + frame - CENTER_PADDING_FRAMES)
				* window[frame]!;
		}
		fft(real, imaginary, false);
		for (let bin = 0; bin < FREQUENCY_BIN_COUNT; bin += 1) {
			const offset = time * FREQUENCY_BIN_COUNT + bin;
			realOutput[offset] = real[bin]!;
			imaginaryOutput[offset] = imaginary[bin]!;
		}
	}
	return Object.freeze({
		schemaVersion: 1,
		sampleRate: ASSISTANCE_DEREVERB_ROOM_SAMPLE_RATE,
		fftSize: ASSISTANCE_DEREVERB_ROOM_FFT_SIZE,
		hopFrames: ASSISTANCE_DEREVERB_ROOM_STFT_HOP_FRAMES,
		frequencyBinCount: FREQUENCY_BIN_COUNT,
		timeFrameCount,
		real: realOutput,
		imaginary: imaginaryOutput,
	});
}

/** Invert only an exact owned dereverb-room spectrum and crop to its source authority. */
export function dereverbRoomIstftV1(value: unknown): Float32Array {
	const row = exactRecord(value, ISTFT_FIELDS, 'dereverb-room ISTFT request');
	version(row.schemaVersion, 'dereverb-room ISTFT');
	const sourceFrameCount = integer(row.sourceFrameCount, CENTER_PADDING_FRAMES + 1,
		MAXIMUM_SOURCE_FRAMES, 'dereverb-room ISTFT source frame count');
	const spectrum = validateSpectrum(row.spectrum, sourceFrameCount);
	const paddedFrameCount = (spectrum.timeFrameCount - 1) * spectrum.hopFrames + spectrum.fftSize;
	const window = periodicHann();
	const normalization = new Float64Array(paddedFrameCount);
	for (let time = 0; time < spectrum.timeFrameCount; time += 1) {
		const start = time * spectrum.hopFrames;
		for (let frame = 0; frame < spectrum.fftSize; frame += 1) {
			normalization[start + frame]! += window[frame]! * window[frame]!;
		}
	}
	const accumulator = new Float64Array(paddedFrameCount);
	for (let time = 0; time < spectrum.timeFrameCount; time += 1) {
		const real = new Float64Array(spectrum.fftSize);
		const imaginary = new Float64Array(spectrum.fftSize);
		for (let bin = 0; bin < spectrum.frequencyBinCount; bin += 1) {
			const offset = time * spectrum.frequencyBinCount + bin;
			real[bin] = spectrum.real[offset]!;
			imaginary[bin] = spectrum.imaginary[offset]!;
		}
		for (let bin = 1; bin < spectrum.frequencyBinCount - 1; bin += 1) {
			real[spectrum.fftSize - bin] = real[bin]!;
			imaginary[spectrum.fftSize - bin] = -imaginary[bin]!;
		}
		fft(real, imaginary, true);
		const start = time * spectrum.hopFrames;
		for (let frame = 0; frame < spectrum.fftSize; frame += 1) {
			accumulator[start + frame]! += real[frame]! * window[frame]!;
		}
	}
	const result = new Float32Array(sourceFrameCount);
	for (let frame = 0; frame < sourceFrameCount; frame += 1) {
		const padded = CENTER_PADDING_FRAMES + frame;
		const divisor = normalization[padded]!;
		if (!(divisor > 0)) {
			throw new RangeError('dereverb-room ISTFT has an uncovered source frame.');
		}
		result[frame] = accumulator[padded]! / divisor;
	}
	return result;
}

function fadeWeight(frame: number, fadeIn: boolean, fadeOut: boolean): number {
	const fade = ASSISTANCE_DEREVERB_ROOM_FADE_FRAMES;
	if (fadeIn && frame < fade) return frame / (fade - 1);
	const fromEnd = ASSISTANCE_DEREVERB_ROOM_CHUNK_FRAMES - 1 - frame;
	if (fadeOut && fromEnd < fade) return fromEnd / (fade - 1);
	return 1;
}

function validatePlan(value: unknown): DereverbRoomChunkPlanV1 {
	const row = exactRecord(value, PLAN_FIELDS, 'dereverb-room chunk plan');
	version(row.schemaVersion, 'dereverb-room chunk plan');
	const expected = createDereverbRoomChunkPlanV1({
		schemaVersion: 1,
		sourceFrameCount: row.sourceFrameCount,
	});
	if (row.borderFrames !== expected.borderFrames
		|| row.paddedFrameCount !== expected.paddedFrameCount) {
		throw new TypeError('The dereverb-room chunk plan geometry is not canonical.');
	}
	const chunks = boundedArray(row.chunks, expected.chunks.length, expected.chunks.length,
		'dereverb-room chunk plan inventory');
	for (let index = 0; index < chunks.length; index += 1) {
		const chunk = exactRecord(chunks[index], CHUNK_FIELDS,
			`dereverb-room chunk ${String(index)}`);
		const canonical = expected.chunks[index]!;
		if (chunk.chunkIndex !== canonical.chunkIndex
			|| chunk.paddedStartFrame !== canonical.paddedStartFrame
			|| chunk.availableFrameCount !== canonical.availableFrameCount
			|| chunk.tailPadMode !== canonical.tailPadMode
			|| chunk.fadeIn !== canonical.fadeIn
			|| chunk.fadeOut !== canonical.fadeOut) {
			throw new TypeError('The dereverb-room chunk plan inventory is not canonical.');
		}
	}
	return expected;
}

function validateSpectrum(value: unknown, sourceFrameCount: number): DereverbRoomSpectrumV1 {
	const row = exactRecord(value, SPECTRUM_FIELDS, 'dereverb-room spectrum');
	version(row.schemaVersion, 'dereverb-room spectrum');
	rate(row.sampleRate);
	if (row.fftSize !== ASSISTANCE_DEREVERB_ROOM_FFT_SIZE
		|| row.hopFrames !== ASSISTANCE_DEREVERB_ROOM_STFT_HOP_FRAMES
		|| row.frequencyBinCount !== FREQUENCY_BIN_COUNT) {
		throw new RangeError('The dereverb-room spectrum geometry is not canonical.');
	}
	const timeFrameCount = Math.floor(sourceFrameCount
		/ ASSISTANCE_DEREVERB_ROOM_STFT_HOP_FRAMES) + 1;
	if (row.timeFrameCount !== timeFrameCount) {
		throw new RangeError('The dereverb-room spectrum time geometry is invalid.');
	}
	const tensorLength = timeFrameCount * FREQUENCY_BIN_COUNT;
	return Object.freeze({
		schemaVersion: 1,
		sampleRate: ASSISTANCE_DEREVERB_ROOM_SAMPLE_RATE,
		fftSize: ASSISTANCE_DEREVERB_ROOM_FFT_SIZE,
		hopFrames: ASSISTANCE_DEREVERB_ROOM_STFT_HOP_FRAMES,
		frequencyBinCount: FREQUENCY_BIN_COUNT,
		timeFrameCount,
		real: finitePlane(row.real, tensorLength, 'dereverb-room real spectrum'),
		imaginary: finitePlane(row.imaginary, tensorLength, 'dereverb-room imaginary spectrum'),
	});
}

function finitePlane(value: unknown, length: number | null, label: string): Float32Array {
	if (!(value instanceof Float32Array) || value.length < 1
		|| (length !== null && value.length !== length)
		|| value.length > MAXIMUM_SOURCE_FRAMES) {
		throw new RangeError(`${label} has invalid tensor geometry.`);
	}
	for (const sample of value) {
		if (!Number.isFinite(sample)) throw new RangeError(`${label} must contain only finite values.`);
	}
	return value;
}

function periodicHann(): Float64Array {
	return Float64Array.from({ length: ASSISTANCE_DEREVERB_ROOM_FFT_SIZE }, (_, frame) =>
		0.5 - 0.5 * Math.cos(2 * Math.PI * frame / ASSISTANCE_DEREVERB_ROOM_FFT_SIZE));
}

function reflectedSample(channel: Float32Array, frame: number): number {
	let reflected = frame;
	while (reflected < 0 || reflected >= channel.length) {
		if (reflected < 0) reflected = -reflected;
		else reflected = 2 * channel.length - 2 - reflected;
	}
	return channel[reflected]!;
}

function fft(real: Float64Array, imaginary: Float64Array, inverse: boolean): void {
	const size = real.length;
	for (let source = 1, destination = 0; source < size; source += 1) {
		let bit = size >> 1;
		for (; destination & bit; bit >>= 1) destination ^= bit;
		destination ^= bit;
		if (source < destination) {
			[real[source], real[destination]] = [real[destination]!, real[source]!];
			[imaginary[source], imaginary[destination]] = [imaginary[destination]!, imaginary[source]!];
		}
	}
	for (let length = 2; length <= size; length *= 2) {
		const angle = (inverse ? 2 : -2) * Math.PI / length;
		const rootReal = Math.cos(angle);
		const rootImaginary = Math.sin(angle);
		for (let offset = 0; offset < size; offset += length) {
			let factorReal = 1;
			let factorImaginary = 0;
			for (let index = 0; index < length / 2; index += 1) {
				const even = offset + index;
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
		for (let index = 0; index < size; index += 1) {
			real[index] = (real[index] ?? 0) / size;
			imaginary[index] = (imaginary[index] ?? 0) / size;
		}
	}
}

function version(value: unknown, label: string): void {
	if (value !== 1) throw new TypeError(`The ${label} schema version is unsupported.`);
}

function rate(value: unknown): void {
	if (value !== ASSISTANCE_DEREVERB_ROOM_SAMPLE_RATE) {
		throw new RangeError('dereverb-room audio must be exactly 44100 Hz.');
	}
}

function boundedArray(value: unknown, minimum: number, maximum: number, label: string): readonly unknown[] {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new RangeError(`The ${label} is outside its exact bound.`);
	}
	return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const row = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(row);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return row as Record<Field, unknown>;
}
