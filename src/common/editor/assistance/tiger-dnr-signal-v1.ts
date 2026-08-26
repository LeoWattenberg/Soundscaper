/* SPDX-License-Identifier: AGPL-3.0-only */

/** Owned deterministic signal geometry for the pinned TIGER-DnR reference. */

export const ASSISTANCE_TIGER_DNR_SAMPLE_RATE = 44_100;
export const ASSISTANCE_TIGER_DNR_FFT_SIZE = 2_048;
export const ASSISTANCE_TIGER_DNR_STFT_HOP_FRAMES = 512;
export const ASSISTANCE_TIGER_DNR_CHUNK_FRAMES = 12 * ASSISTANCE_TIGER_DNR_SAMPLE_RATE;
export const ASSISTANCE_TIGER_DNR_CHUNK_HOP_FRAMES = 4 * ASSISTANCE_TIGER_DNR_SAMPLE_RATE;

const CHUNK_PADDING_FRAMES = ASSISTANCE_TIGER_DNR_CHUNK_FRAMES
	- ASSISTANCE_TIGER_DNR_CHUNK_HOP_FRAMES;
const OVERLAP_DIVISOR = ASSISTANCE_TIGER_DNR_CHUNK_FRAMES
	/ ASSISTANCE_TIGER_DNR_CHUNK_HOP_FRAMES;
const CENTER_PADDING_FRAMES = ASSISTANCE_TIGER_DNR_FFT_SIZE / 2;
const FREQUENCY_BIN_COUNT = ASSISTANCE_TIGER_DNR_FFT_SIZE / 2 + 1;
const MAXIMUM_SOURCE_FRAMES = 24 * 60 * 60 * ASSISTANCE_TIGER_DNR_SAMPLE_RATE;
const MAXIMUM_CHANNELS = 32;
const MAXIMUM_CHUNKS = 100_000;

const PLAN_REQUEST_FIELDS = Object.freeze(['schemaVersion', 'sourceFrameCount'] as const);
const PLAN_FIELDS = Object.freeze([
	'schemaVersion', 'sourceFrameCount', 'paddedFrameCount', 'cropStartFrame',
	'overlapDivisor', 'chunks',
] as const);
const CHUNK_FIELDS = Object.freeze([
	'chunkIndex', 'paddedStartFrame', 'availableFrameCount',
] as const);
const EXTRACT_FIELDS = Object.freeze([
	'schemaVersion', 'plan', 'chunkIndex', 'channels',
] as const);
const MERGE_FIELDS = Object.freeze([
	'schemaVersion', 'plan', 'channelCount', 'chunks',
] as const);
const MERGE_CHUNK_FIELDS = Object.freeze(['chunkIndex', 'channels'] as const);
const STFT_FIELDS = Object.freeze(['schemaVersion', 'sampleRate', 'channels'] as const);
const ISTFT_FIELDS = Object.freeze(['schemaVersion', 'spectrum', 'sourceFrameCount'] as const);
const SPECTRUM_FIELDS = Object.freeze([
	'schemaVersion', 'sampleRate', 'channelCount', 'fftSize', 'hopFrames',
	'frequencyBinCount', 'timeFrameCount', 'channels',
] as const);
const SPECTRUM_CHANNEL_FIELDS = Object.freeze(['real', 'imaginary'] as const);

export interface TigerDnrChunkV1 {
	readonly chunkIndex: number;
	readonly paddedStartFrame: number;
	readonly availableFrameCount: number;
}

export interface TigerDnrChunkPlanV1 {
	readonly schemaVersion: 1;
	readonly sourceFrameCount: number;
	readonly paddedFrameCount: number;
	readonly cropStartFrame: number;
	readonly overlapDivisor: 3;
	readonly chunks: readonly TigerDnrChunkV1[];
}

export interface TigerDnrSpectrumChannelV1 {
	readonly real: Float32Array;
	readonly imaginary: Float32Array;
}

export interface TigerDnrSpectrumV1 {
	readonly schemaVersion: 1;
	readonly sampleRate: typeof ASSISTANCE_TIGER_DNR_SAMPLE_RATE;
	readonly channelCount: number;
	readonly fftSize: typeof ASSISTANCE_TIGER_DNR_FFT_SIZE;
	readonly hopFrames: typeof ASSISTANCE_TIGER_DNR_STFT_HOP_FRAMES;
	readonly frequencyBinCount: typeof FREQUENCY_BIN_COUNT;
	readonly timeFrameCount: number;
	readonly channels: readonly TigerDnrSpectrumChannelV1[];
}

/** Reproduce TIGER-DnR's 12-second sessions, four-second hop, and edge padding. */
export function createTigerDnrChunkPlanV1(value: unknown): TigerDnrChunkPlanV1 {
	const row = exactRecord(value, PLAN_REQUEST_FIELDS, 'TIGER-DnR chunk-plan request');
	version(row.schemaVersion, 'TIGER-DnR chunk plan');
	const sourceFrameCount = integer(row.sourceFrameCount, 1, MAXIMUM_SOURCE_FRAMES,
		'TIGER-DnR source frame count');
	const paddedFrameCount = sourceFrameCount + 2 * CHUNK_PADDING_FRAMES;
	const chunkCount = Math.floor((paddedFrameCount - ASSISTANCE_TIGER_DNR_CHUNK_FRAMES)
		/ ASSISTANCE_TIGER_DNR_CHUNK_HOP_FRAMES) + 2;
	if (chunkCount < 1 || chunkCount > MAXIMUM_CHUNKS) {
		throw new RangeError('The TIGER-DnR chunk inventory exceeds its exact bound.');
	}
	const chunks = Array.from({ length: chunkCount }, (_, chunkIndex) => {
		const paddedStartFrame = chunkIndex * ASSISTANCE_TIGER_DNR_CHUNK_HOP_FRAMES;
		return Object.freeze({
			chunkIndex,
			paddedStartFrame,
			availableFrameCount: Math.min(ASSISTANCE_TIGER_DNR_CHUNK_FRAMES,
				Math.max(0, paddedFrameCount - paddedStartFrame)),
		});
	});
	return Object.freeze({
		schemaVersion: 1,
		sourceFrameCount,
		paddedFrameCount,
		cropStartFrame: CHUNK_PADDING_FRAMES,
		overlapDivisor: OVERLAP_DIVISOR as 3,
		chunks: Object.freeze(chunks),
	});
}

/** Materialize one zero-padded, channel-preserving model session. */
export function extractTigerDnrChunkV1(value: unknown): readonly Float32Array[] {
	const row = exactRecord(value, EXTRACT_FIELDS, 'TIGER-DnR chunk extraction');
	version(row.schemaVersion, 'TIGER-DnR chunk extraction');
	const plan = validatePlan(row.plan);
	const chunkIndex = integer(row.chunkIndex, 0, plan.chunks.length - 1,
		'TIGER-DnR chunk index');
	const input = channelPlanes(row.channels, plan.sourceFrameCount, 'TIGER-DnR source');
	const chunk = plan.chunks[chunkIndex]!;
	const sourceStart = Math.max(0, chunk.paddedStartFrame - plan.cropStartFrame);
	const localStart = Math.max(0, plan.cropStartFrame - chunk.paddedStartFrame);
	const copyFrames = Math.min(
		plan.sourceFrameCount - sourceStart,
		ASSISTANCE_TIGER_DNR_CHUNK_FRAMES - localStart,
		chunk.availableFrameCount - localStart,
	);
	return Object.freeze(input.map((channel) => {
		const output = new Float32Array(ASSISTANCE_TIGER_DNR_CHUNK_FRAMES);
		if (copyFrames > 0) output.set(channel.subarray(sourceStart, sourceStart + copyFrames), localStart);
		return output;
	}));
}

/** Merge every authenticated model session using the reference's fixed overlap divisor. */
export function mergeTigerDnrStemV1(value: unknown): readonly Float32Array[] {
	const row = exactRecord(value, MERGE_FIELDS, 'TIGER-DnR stem merge');
	version(row.schemaVersion, 'TIGER-DnR stem merge');
	const plan = validatePlan(row.plan);
	const channelCount = integer(row.channelCount, 1, MAXIMUM_CHANNELS,
		'TIGER-DnR output channel count');
	const chunks = boundedArray(row.chunks, plan.chunks.length, plan.chunks.length,
		'TIGER-DnR output chunk inventory');
	const accumulator = Array.from({ length: channelCount },
		() => new Float32Array(plan.paddedFrameCount));
	for (let index = 0; index < chunks.length; index += 1) {
		const record = exactRecord(chunks[index], MERGE_CHUNK_FIELDS,
			`TIGER-DnR output chunk ${String(index)}`);
		if (record.chunkIndex !== index) {
			throw new TypeError('The TIGER-DnR output chunk inventory must be complete and ordered.');
		}
		const planes = channelPlanes(record.channels, ASSISTANCE_TIGER_DNR_CHUNK_FRAMES,
			`TIGER-DnR output chunk ${String(index)}`);
		if (planes.length !== channelCount) {
			throw new RangeError('A TIGER-DnR output chunk changed channel geometry.');
		}
		const chunk = plan.chunks[index]!;
		for (let channel = 0; channel < channelCount; channel += 1) {
			const destination = accumulator[channel]!;
			const source = planes[channel]!;
			for (let frame = 0; frame < chunk.availableFrameCount; frame += 1) {
				destination[chunk.paddedStartFrame + frame] = Math.fround(
					destination[chunk.paddedStartFrame + frame]! + source[frame]!,
				);
			}
		}
	}
	return Object.freeze(accumulator.map((channel) => {
		const output = new Float32Array(plan.sourceFrameCount);
		for (let frame = 0; frame < output.length; frame += 1) {
			output[frame] = channel[plan.cropStartFrame + frame]! / plan.overlapDivisor;
		}
		return output;
	}));
}

/** PyTorch-compatible centered periodic-Hann STFT used before TIGER mask inference. */
export function tigerDnrStftV1(value: unknown): TigerDnrSpectrumV1 {
	const row = exactRecord(value, STFT_FIELDS, 'TIGER-DnR STFT request');
	version(row.schemaVersion, 'TIGER-DnR STFT');
	rate(row.sampleRate);
	const channels = channelPlanes(row.channels, null, 'TIGER-DnR STFT source');
	const sourceFrameCount = channels[0]!.length;
	if (sourceFrameCount <= CENTER_PADDING_FRAMES) {
		throw new RangeError('TIGER-DnR centered reflection padding needs more than 1024 source frames.');
	}
	const timeFrameCount = Math.floor(sourceFrameCount
		/ ASSISTANCE_TIGER_DNR_STFT_HOP_FRAMES) + 1;
	const window = periodicHann();
	const spectra = channels.map((channel) => {
		const realOutput = new Float32Array(timeFrameCount * FREQUENCY_BIN_COUNT);
		const imaginaryOutput = new Float32Array(realOutput.length);
		for (let time = 0; time < timeFrameCount; time += 1) {
			const real = new Float64Array(ASSISTANCE_TIGER_DNR_FFT_SIZE);
			const imaginary = new Float64Array(ASSISTANCE_TIGER_DNR_FFT_SIZE);
			const paddedStart = time * ASSISTANCE_TIGER_DNR_STFT_HOP_FRAMES;
			for (let frame = 0; frame < ASSISTANCE_TIGER_DNR_FFT_SIZE; frame += 1) {
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
		return Object.freeze({ real: realOutput, imaginary: imaginaryOutput });
	});
	return Object.freeze({
		schemaVersion: 1,
		sampleRate: ASSISTANCE_TIGER_DNR_SAMPLE_RATE,
		channelCount: channels.length,
		fftSize: ASSISTANCE_TIGER_DNR_FFT_SIZE,
		hopFrames: ASSISTANCE_TIGER_DNR_STFT_HOP_FRAMES,
		frequencyBinCount: FREQUENCY_BIN_COUNT,
		timeFrameCount,
		channels: Object.freeze(spectra),
	});
}

/** Invert only an exact owned TIGER spectrum and crop to its source authority. */
export function tigerDnrIstftV1(value: unknown): readonly Float32Array[] {
	const row = exactRecord(value, ISTFT_FIELDS, 'TIGER-DnR ISTFT request');
	version(row.schemaVersion, 'TIGER-DnR ISTFT');
	const sourceFrameCount = integer(row.sourceFrameCount, CENTER_PADDING_FRAMES + 1,
		MAXIMUM_SOURCE_FRAMES, 'TIGER-DnR ISTFT source frame count');
	const spectrum = validateSpectrum(row.spectrum, sourceFrameCount);
	const paddedFrameCount = (spectrum.timeFrameCount - 1) * spectrum.hopFrames + spectrum.fftSize;
	const window = periodicHann();
	const normalization = new Float64Array(paddedFrameCount);
	for (let time = 0; time < spectrum.timeFrameCount; time += 1) {
		const start = time * spectrum.hopFrames;
		for (let frame = 0; frame < spectrum.fftSize; frame += 1) {
			normalization[start + frame] += window[frame]! * window[frame]!;
		}
	}
	const output = spectrum.channels.map((channel) => {
		const accumulator = new Float64Array(paddedFrameCount);
		for (let time = 0; time < spectrum.timeFrameCount; time += 1) {
			const real = new Float64Array(spectrum.fftSize);
			const imaginary = new Float64Array(spectrum.fftSize);
			for (let bin = 0; bin < spectrum.frequencyBinCount; bin += 1) {
				const offset = time * spectrum.frequencyBinCount + bin;
				real[bin] = channel.real[offset]!;
				imaginary[bin] = channel.imaginary[offset]!;
			}
			for (let bin = 1; bin < spectrum.frequencyBinCount - 1; bin += 1) {
				real[spectrum.fftSize - bin] = real[bin]!;
				imaginary[spectrum.fftSize - bin] = -imaginary[bin]!;
			}
			fft(real, imaginary, true);
			const start = time * spectrum.hopFrames;
			for (let frame = 0; frame < spectrum.fftSize; frame += 1) {
				accumulator[start + frame] += real[frame]! * window[frame]!;
			}
		}
		const result = new Float32Array(sourceFrameCount);
		for (let frame = 0; frame < sourceFrameCount; frame += 1) {
			const padded = CENTER_PADDING_FRAMES + frame;
			const divisor = normalization[padded]!;
			if (!(divisor > 0)) throw new RangeError('TIGER-DnR ISTFT has an uncovered source frame.');
			result[frame] = accumulator[padded]! / divisor;
		}
		return result;
	});
	return Object.freeze(output);
}

function validatePlan(value: unknown): TigerDnrChunkPlanV1 {
	const row = exactRecord(value, PLAN_FIELDS, 'TIGER-DnR chunk plan');
	version(row.schemaVersion, 'TIGER-DnR chunk plan');
	const expected = createTigerDnrChunkPlanV1({
		schemaVersion: 1,
		sourceFrameCount: row.sourceFrameCount,
	});
	if (row.paddedFrameCount !== expected.paddedFrameCount
		|| row.cropStartFrame !== expected.cropStartFrame
		|| row.overlapDivisor !== expected.overlapDivisor) {
		throw new TypeError('The TIGER-DnR chunk plan geometry is not canonical.');
	}
	const chunks = boundedArray(row.chunks, expected.chunks.length, expected.chunks.length,
		'TIGER-DnR chunk plan inventory');
	for (let index = 0; index < chunks.length; index += 1) {
		const chunk = exactRecord(chunks[index], CHUNK_FIELDS, `TIGER-DnR chunk ${String(index)}`);
		const canonical = expected.chunks[index]!;
		if (chunk.chunkIndex !== canonical.chunkIndex
			|| chunk.paddedStartFrame !== canonical.paddedStartFrame
			|| chunk.availableFrameCount !== canonical.availableFrameCount) {
			throw new TypeError('The TIGER-DnR chunk plan inventory is not canonical.');
		}
	}
	return expected;
}

function validateSpectrum(value: unknown, sourceFrameCount: number): TigerDnrSpectrumV1 {
	const row = exactRecord(value, SPECTRUM_FIELDS, 'TIGER-DnR spectrum');
	version(row.schemaVersion, 'TIGER-DnR spectrum');
	rate(row.sampleRate);
	const channelCount = integer(row.channelCount, 1, MAXIMUM_CHANNELS,
		'TIGER-DnR spectrum channel count');
	if (row.fftSize !== ASSISTANCE_TIGER_DNR_FFT_SIZE
		|| row.hopFrames !== ASSISTANCE_TIGER_DNR_STFT_HOP_FRAMES
		|| row.frequencyBinCount !== FREQUENCY_BIN_COUNT) {
		throw new RangeError('The TIGER-DnR spectrum geometry is not canonical.');
	}
	const timeFrameCount = Math.floor(sourceFrameCount
		/ ASSISTANCE_TIGER_DNR_STFT_HOP_FRAMES) + 1;
	if (row.timeFrameCount !== timeFrameCount) {
		throw new RangeError('The TIGER-DnR spectrum time geometry is invalid.');
	}
	const candidates = boundedArray(row.channels, channelCount, channelCount,
		'TIGER-DnR spectrum channels');
	const tensorLength = timeFrameCount * FREQUENCY_BIN_COUNT;
	const channels = candidates.map((candidate, index) => {
		const channel = exactRecord(candidate, SPECTRUM_CHANNEL_FIELDS,
			`TIGER-DnR spectrum channel ${String(index)}`);
		return Object.freeze({
			real: finitePlane(channel.real, tensorLength, 'TIGER-DnR real spectrum'),
			imaginary: finitePlane(channel.imaginary, tensorLength, 'TIGER-DnR imaginary spectrum'),
		});
	});
	return Object.freeze({
		schemaVersion: 1,
		sampleRate: ASSISTANCE_TIGER_DNR_SAMPLE_RATE,
		channelCount,
		fftSize: ASSISTANCE_TIGER_DNR_FFT_SIZE,
		hopFrames: ASSISTANCE_TIGER_DNR_STFT_HOP_FRAMES,
		frequencyBinCount: FREQUENCY_BIN_COUNT,
		timeFrameCount,
		channels: Object.freeze(channels),
	});
}

function channelPlanes(value: unknown, expectedFrames: number | null, label: string): readonly Float32Array[] {
	const candidates = boundedArray(value, 1, MAXIMUM_CHANNELS, `${label} channels`);
	let frameCount = expectedFrames;
	const channels = candidates.map((candidate, index) => {
		if (!(candidate instanceof Float32Array)) {
			throw new TypeError(`${label} channel ${String(index)} must be Float32.`);
		}
		frameCount ??= candidate.length;
		return finitePlane(candidate, frameCount, `${label} channel ${String(index)}`);
	});
	if (frameCount === null || frameCount < 1 || frameCount > MAXIMUM_SOURCE_FRAMES) {
		throw new RangeError(`${label} frame geometry is invalid.`);
	}
	return Object.freeze(channels);
}

function finitePlane(value: unknown, length: number, label: string): Float32Array {
	if (!(value instanceof Float32Array) || value.length !== length) {
		throw new RangeError(`${label} has invalid tensor geometry.`);
	}
	for (const sample of value) {
		if (!Number.isFinite(sample)) throw new RangeError(`${label} must contain only finite values.`);
	}
	return value;
}

function periodicHann(): Float64Array {
	return Float64Array.from({ length: ASSISTANCE_TIGER_DNR_FFT_SIZE }, (_, frame) =>
		0.5 - 0.5 * Math.cos(2 * Math.PI * frame / ASSISTANCE_TIGER_DNR_FFT_SIZE));
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
				real[even] += oddReal;
				imaginary[even] += oddImaginary;
				const nextReal = factorReal * rootReal - factorImaginary * rootImaginary;
				factorImaginary = factorReal * rootImaginary + factorImaginary * rootReal;
				factorReal = nextReal;
			}
		}
	}
	if (inverse) {
		for (let index = 0; index < size; index += 1) {
			real[index] /= size;
			imaginary[index] /= size;
		}
	}
}

function version(value: unknown, label: string): void {
	if (value !== 1) throw new TypeError(`The ${label} schema version is unsupported.`);
}

function rate(value: unknown): void {
	if (value !== ASSISTANCE_TIGER_DNR_SAMPLE_RATE) {
		throw new RangeError('TIGER-DnR audio must be exactly 44100 Hz.');
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
