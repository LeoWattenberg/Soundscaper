/* SPDX-License-Identifier: AGPL-3.0-only */

const MIB = 1024 * 1024;
const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;
const MAXIMUM_SAFE_BYTES = BigInt(Number.MAX_SAFE_INTEGER);

export const MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES = 256 * MIB;

export type OfflineRenderOutputUsefulBinaryScope =
	| 'offline-context-output-float32-useful-binary'
	| 'offline-render-crop-float32-useful-binary'
	| 'offline-render-output-peak-float32-useful-binary';

export interface OfflineRenderOutputGeometry {
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly contextFrames: number;
	readonly captureOffsetFrames: number;
	readonly requestedFrames: number;
}

export interface OfflineRenderOutputAdmissionOptions {
	readonly maximumUsefulBinaryBytes?: number;
}

export interface OfflineRenderOutputUsefulBinaryBytes {
	readonly bytes: number;
	readonly certainty: 'exact';
	readonly scope: OfflineRenderOutputUsefulBinaryScope;
}

export interface OfflineRenderOutputAdmissionPlan extends OfflineRenderOutputGeometry {
	readonly maximumUsefulBinaryBytes: number;
	readonly contextOutput: Readonly<OfflineRenderOutputUsefulBinaryBytes>;
	readonly cropOutput: Readonly<OfflineRenderOutputUsefulBinaryBytes>;
	readonly peakUsefulBinaryWorkingSet: Readonly<OfflineRenderOutputUsefulBinaryBytes>;
	readonly browserHeapBytes: null;
	readonly processResidentSetBytes: null;
	readonly garbageCollectionHeadroomBytes: null;
}

export class OfflineRenderOutputMemoryLimitError extends RangeError {
	readonly code = 'OFFLINE_RENDER_OUTPUT_MEMORY_LIMIT';
	readonly peakUsefulBinaryBytes: number;
	readonly maximumUsefulBinaryBytes: number;

	constructor(peakUsefulBinaryBytes: number, maximumUsefulBinaryBytes: number) {
		super(
			`Offline render output needs ${peakUsefulBinaryBytes} useful-binary bytes, `
			+ `exceeding the ${maximumUsefulBinaryBytes}-byte maximum.`,
		);
		this.name = 'OfflineRenderOutputMemoryLimitError';
		this.peakUsefulBinaryBytes = peakUsefulBinaryBytes;
		this.maximumUsefulBinaryBytes = maximumUsefulBinaryBytes;
	}
}

/**
 * Admits the exact Float32 output payload owned by one OfflineAudioContext and
 * the maintained crop copy which can coexist with it. This does not account
 * for sources, graph state, browser heap, process RSS, or GC headroom.
 */
export function planOfflineRenderOutputAdmission(
	geometry: OfflineRenderOutputGeometry,
	options: OfflineRenderOutputAdmissionOptions = {},
): Readonly<OfflineRenderOutputAdmissionPlan> {
	const channelCount = safeIntegerRange(
		geometry?.channelCount,
		1,
		32,
		'Offline render output channel count',
	);
	const sampleRate = safeIntegerRange(
		geometry?.sampleRate,
		1,
		Number.MAX_SAFE_INTEGER,
		'Offline render output sample rate',
	);
	const contextFrames = safeIntegerRange(
		geometry?.contextFrames,
		1,
		Number.MAX_SAFE_INTEGER,
		'Offline render output context frames',
	);
	const captureOffsetFrames = safeIntegerRange(
		geometry?.captureOffsetFrames,
		0,
		Number.MAX_SAFE_INTEGER,
		'Offline render output capture offset frames',
	);
	const requestedFrames = safeIntegerRange(
		geometry?.requestedFrames,
		1,
		Number.MAX_SAFE_INTEGER,
		'Offline render output requested frames',
	);
	if (BigInt(captureOffsetFrames) + BigInt(requestedFrames) !== BigInt(contextFrames)) {
		throw new RangeError(
			'Offline render output context frames must equal capture offset plus requested frames.',
		);
	}
	const maximumUsefulBinaryBytes = normalizeMaximumUsefulBinaryBytes(
		options.maximumUsefulBinaryBytes,
	);
	const bytesPerFrame = BigInt(channelCount) * BigInt(FLOAT32_BYTES);
	const contextOutputValue = BigInt(contextFrames) * bytesPerFrame;
	const cropOutputValue = captureOffsetFrames === 0
		? 0n
		: BigInt(requestedFrames) * bytesPerFrame;
	const peakValue = contextOutputValue + cropOutputValue;
	const contextOutputBytes = safeByteNumber(
		contextOutputValue,
		'Offline render output context useful-binary bytes',
	);
	const cropOutputBytes = safeByteNumber(
		cropOutputValue,
		'Offline render output crop useful-binary bytes',
	);
	const peakUsefulBinaryBytes = safeByteNumber(
		peakValue,
		'Offline render output peak useful-binary bytes',
	);
	if (peakUsefulBinaryBytes > maximumUsefulBinaryBytes) {
		throw new OfflineRenderOutputMemoryLimitError(
			peakUsefulBinaryBytes,
			maximumUsefulBinaryBytes,
		);
	}

	return Object.freeze({
		channelCount,
		sampleRate,
		contextFrames,
		captureOffsetFrames,
		requestedFrames,
		maximumUsefulBinaryBytes,
		contextOutput: exactBytes(
			contextOutputBytes,
			'offline-context-output-float32-useful-binary',
		),
		cropOutput: exactBytes(
			cropOutputBytes,
			'offline-render-crop-float32-useful-binary',
		),
		peakUsefulBinaryWorkingSet: exactBytes(
			peakUsefulBinaryBytes,
			'offline-render-output-peak-float32-useful-binary',
		),
		browserHeapBytes: null,
		processResidentSetBytes: null,
		garbageCollectionHeadroomBytes: null,
	});
}

/** Fail before graph work when a created context differs from its admission. */
export function assertOfflineRenderOutputContextGeometry(
	context: unknown,
	plan: Readonly<OfflineRenderOutputAdmissionPlan>,
): void {
	const candidate = context as Partial<Pick<
		OfflineAudioContext,
		'length' | 'sampleRate'
	>> | null;
	if (!candidate
		|| !Number.isSafeInteger(candidate.sampleRate)
		|| candidate.sampleRate !== plan.sampleRate
		|| !Number.isSafeInteger(candidate.length)
		|| candidate.length !== plan.contextFrames) {
		throw new RangeError(
			'Offline render context geometry does not match its admitted output plan.',
		);
	}
}

/** Fail closed when a rendered AudioBuffer differs from its admitted payload. */
export function assertOfflineRenderOutputBufferGeometry(
	buffer: unknown,
	plan: Readonly<OfflineRenderOutputAdmissionPlan>,
): void {
	const candidate = buffer as Partial<Pick<
		AudioBuffer,
		'numberOfChannels' | 'length' | 'sampleRate' | 'getChannelData'
	>> | null;
	if (!candidate
		|| !Number.isSafeInteger(candidate.numberOfChannels)
		|| candidate.numberOfChannels !== plan.channelCount
		|| !Number.isSafeInteger(candidate.sampleRate)
		|| candidate.sampleRate !== plan.sampleRate
		|| !Number.isSafeInteger(candidate.length)
		|| candidate.length !== plan.contextFrames
		|| typeof candidate.getChannelData !== 'function') {
		throw new RangeError(
			'Offline render output buffer geometry does not match its admitted context output.',
		);
	}
	for (let channel = 0; channel < plan.channelCount; channel += 1) {
		let values: unknown;
		try {
			values = candidate.getChannelData(channel);
		} catch {
			throw new RangeError('Offline render output buffer channel data is unavailable.');
		}
		if (!(values instanceof Float32Array) || values.length !== plan.contextFrames) {
			throw new RangeError(
				'Offline render output buffer channel data does not match its admitted geometry.',
			);
		}
	}
}

function normalizeMaximumUsefulBinaryBytes(value: unknown): number {
	const normalized = value === undefined
		? MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES
		: value;
	if (typeof normalized !== 'number'
		|| !Number.isSafeInteger(normalized)
		|| normalized < 0
		|| normalized > MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES) {
		throw new RangeError(
			'Offline render output maximum must be a non-negative safe integer no greater than '
			+ `${MAXIMUM_OFFLINE_RENDER_OUTPUT_USEFUL_BINARY_BYTES} bytes.`,
		);
	}
	return normalized;
}

function safeIntegerRange(
	value: unknown,
	minimum: number,
	maximum: number,
	field: string,
): number {
	if (typeof value !== 'number'
		|| !Number.isSafeInteger(value)
		|| value < minimum
		|| value > maximum) {
		throw new RangeError(`${field} must be a safe integer between ${minimum} and ${maximum}.`);
	}
	return value;
}

function safeByteNumber(value: bigint, field: string): number {
	if (value < 0n || value > MAXIMUM_SAFE_BYTES) {
		throw new RangeError(`${field} exceeds the supported safe integer range.`);
	}
	return Number(value);
}

function exactBytes(
	bytes: number,
	scope: OfflineRenderOutputUsefulBinaryScope,
): Readonly<OfflineRenderOutputUsefulBinaryBytes> {
	return Object.freeze({ bytes, certainty: 'exact', scope });
}
