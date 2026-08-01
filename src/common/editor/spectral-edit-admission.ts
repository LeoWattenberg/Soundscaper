/* SPDX-License-Identifier: AGPL-3.0-only */

const MIB = 1024 * 1024;
const FLOAT32_BYTES = Float32Array.BYTES_PER_ELEMENT;
const FLOAT64_BYTES = Float64Array.BYTES_PER_ELEMENT;
const MINIMUM_WINDOW_SIZE = 32;
const MAXIMUM_WINDOW_SIZE = 16_384;
const MAXIMUM_CHANNEL_COUNT = 32;
const MAXIMUM_SAFE_BYTES = BigInt(Number.MAX_SAFE_INTEGER);
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Float32Array.prototype) as object;
const TYPED_ARRAY_LENGTH_GETTER = intrinsicGetter(TYPED_ARRAY_PROTOTYPE, 'length');
const TYPED_ARRAY_BYTE_LENGTH_GETTER = intrinsicGetter(TYPED_ARRAY_PROTOTYPE, 'byteLength');
const TYPED_ARRAY_BYTE_OFFSET_GETTER = intrinsicGetter(TYPED_ARRAY_PROTOTYPE, 'byteOffset');
const TYPED_ARRAY_BUFFER_GETTER = intrinsicGetter(TYPED_ARRAY_PROTOTYPE, 'buffer');
const TYPED_ARRAY_TAG_GETTER = intrinsicGetter(TYPED_ARRAY_PROTOTYPE, Symbol.toStringTag);
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = intrinsicGetter(ArrayBuffer.prototype, 'byteLength');
const ARRAY_BUFFER_RESIZABLE_GETTER = optionalIntrinsicGetter(ArrayBuffer.prototype, 'resizable');

export const MAXIMUM_SPECTRAL_EDIT_USEFUL_BINARY_BYTES = 256 * MIB;

export type SpectralEditUsefulBinaryScope =
	| 'spectral-edit-target-useful-binary-working-set'
	| 'spectral-edit-workflow-useful-binary-working-set';

export interface SpectralEditTargetGeometry {
	readonly channelCount: number;
	readonly frameCount: number;
	readonly selectionFrameCount: number;
	readonly windowSize: number;
}

export interface SpectralEditWorkflowAdmissionInput {
	readonly targets: readonly SpectralEditTargetGeometry[];
	readonly initialRetainedCompletedOutputBytes?: number;
	readonly maximumUsefulBinaryBytes?: number;
}

export interface SpectralEditJobAdmissionInput extends SpectralEditTargetGeometry {
	readonly retainedCompletedOutputBytes?: number;
	readonly maximumUsefulBinaryBytes?: number;
}

export interface SpectralEditUsefulBinaryBound {
	readonly bytes: number;
	readonly certainty: 'upper-bound';
	readonly scope: SpectralEditUsefulBinaryScope;
}

export interface SpectralEditAdmissionPhase extends SpectralEditTargetGeometry {
	readonly targetIndex: number;
	readonly retainedCompletedOutputBytes: number;
	readonly dryRenderInputBytes: number;
	readonly workerTransferCopyBytes: number;
	readonly equalShapeOutputBytes: number;
	readonly spectralSelectionScratchBytes: number;
	readonly windowAndFftScratchBytes: number;
	readonly usefulBinaryWorkingSet: Readonly<SpectralEditUsefulBinaryBound>;
}

export interface SpectralEditAdmissionPlan {
	readonly phases: readonly Readonly<SpectralEditAdmissionPhase>[];
	readonly peakTargetIndex: number;
	readonly initialRetainedCompletedOutputBytes: number;
	readonly finalRetainedCompletedOutputBytes: number;
	readonly maximumUsefulBinaryBytes: number;
	readonly usefulBinaryWorkingSet: Readonly<SpectralEditUsefulBinaryBound>;
	readonly browserHeapBytes: null;
	readonly processResidentSetBytes: null;
	readonly garbageCollectionHeadroomBytes: null;
}

export interface SpectralEditChannelInspectionOptions {
	readonly label?: string;
	readonly expectedChannelCount?: number;
	readonly expectedFrameCount?: number;
}

export interface InspectedSpectralEditChannels {
	readonly channels: readonly Float32Array[];
	readonly channelCount: number;
	readonly frameCount: number;
	readonly byteLength: number;
}

export class SpectralEditMemoryLimitError extends RangeError {
	readonly code = 'SPECTRAL_EDIT_MEMORY_LIMIT';
	readonly targetIndex: number;
	readonly peakUsefulBinaryBytes: number;
	readonly maximumUsefulBinaryBytes: number;

	constructor(
		targetIndex: number,
		peakUsefulBinaryBytes: number,
		maximumUsefulBinaryBytes: number,
	) {
		super(
			`Spectral edit target ${targetIndex} needs ${peakUsefulBinaryBytes} useful-binary bytes, `
			+ `exceeding the ${maximumUsefulBinaryBytes}-byte maximum.`,
		);
		this.name = 'SpectralEditMemoryLimitError';
		this.targetIndex = targetIndex;
		this.peakUsefulBinaryBytes = peakUsefulBinaryBytes;
		this.maximumUsefulBinaryBytes = maximumUsefulBinaryBytes;
	}
}

/**
 * Plans the conservative useful-binary ownership peak for sequential spectral
 * targets. Arithmetic is exact for the modeled phase: all completed outputs,
 * current dry input, its worker transfer copy, equal-shape output, two
 * selection-sized Float64 accumulators, a Float64 Hann/real/imaginary set, and
 * PFFFT's three interleaved-complex Float32 transform regions. The result is an
 * upper bound because cheaper DSP branches can omit scratch. It is not a
 * browser-heap, whole-process RSS, or garbage-collection-headroom bound.
 */
export function planSpectralEditWorkflowAdmission(
	input: SpectralEditWorkflowAdmissionInput,
): Readonly<SpectralEditAdmissionPlan> {
	const candidate = input as Partial<SpectralEditWorkflowAdmissionInput> | null;
	const targets = normalizeTargets(candidate?.targets);
	const initialRetainedCompletedOutputBytes = nonNegativeSafeInteger(
		candidate?.initialRetainedCompletedOutputBytes ?? 0,
		'Spectral edit retained completed output bytes',
	);
	const maximumUsefulBinaryBytes = normalizeSpectralEditMaximumUsefulBinaryBytes(
		candidate?.maximumUsefulBinaryBytes,
	);
	let retainedValue = BigInt(initialRetainedCompletedOutputBytes);
	const phases: Readonly<SpectralEditAdmissionPhase>[] = [];
	let peakTargetIndex = 0;
	let peakBytes = 0;

	for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
		const target = targets[targetIndex]!;
		const planarPcmValue = BigInt(target.channelCount)
			* BigInt(target.frameCount)
			* BigInt(FLOAT32_BYTES);
		const spectralSelectionScratchValue = BigInt(target.selectionFrameCount)
			* 2n
			* BigInt(FLOAT64_BYTES);
		const javascriptWindowAndFftValue = BigInt(target.windowSize)
			* 3n
			* BigInt(FLOAT64_BYTES);
		const pffftTransformValue = BigInt(target.windowSize)
			* 3n
			* 2n
			* BigInt(FLOAT32_BYTES);
		const windowAndFftScratchValue = javascriptWindowAndFftValue + pffftTransformValue;
		const workingSetValue = retainedValue
			+ planarPcmValue
			+ planarPcmValue
			+ planarPcmValue
			+ spectralSelectionScratchValue
			+ windowAndFftScratchValue;
		const phaseBytes = safeByteNumber(
			workingSetValue,
			'Spectral edit useful-binary working set',
		);
		if (phaseBytes > maximumUsefulBinaryBytes) {
			throw new SpectralEditMemoryLimitError(
				targetIndex,
				phaseBytes,
				maximumUsefulBinaryBytes,
			);
		}
		const phase = Object.freeze({
			targetIndex,
			...target,
			retainedCompletedOutputBytes: safeByteNumber(
				retainedValue,
				'Spectral edit retained completed output bytes',
			),
			dryRenderInputBytes: safeByteNumber(
				planarPcmValue,
				'Spectral edit dry-render input bytes',
			),
			workerTransferCopyBytes: safeByteNumber(
				planarPcmValue,
				'Spectral edit worker transfer copy bytes',
			),
			equalShapeOutputBytes: safeByteNumber(
				planarPcmValue,
				'Spectral edit equal-shape output bytes',
			),
			spectralSelectionScratchBytes: safeByteNumber(
				spectralSelectionScratchValue,
				'Spectral edit Float64 selection scratch bytes',
			),
			windowAndFftScratchBytes: safeByteNumber(
				windowAndFftScratchValue,
				'Spectral edit window and FFT scratch bytes',
			),
			usefulBinaryWorkingSet: bound(
				phaseBytes,
				'spectral-edit-target-useful-binary-working-set',
			),
		});
		phases.push(phase);
		if (phaseBytes > peakBytes) {
			peakBytes = phaseBytes;
			peakTargetIndex = targetIndex;
		}
		retainedValue += planarPcmValue;
		safeByteNumber(
			retainedValue,
			'Spectral edit retained completed output bytes',
		);
	}

	return Object.freeze({
		phases: Object.freeze(phases),
		peakTargetIndex,
		initialRetainedCompletedOutputBytes,
		finalRetainedCompletedOutputBytes: safeByteNumber(
			retainedValue,
			'Spectral edit final retained completed output bytes',
		),
		maximumUsefulBinaryBytes,
		usefulBinaryWorkingSet: bound(
			peakBytes,
			'spectral-edit-workflow-useful-binary-working-set',
		),
		browserHeapBytes: null,
		processResidentSetBytes: null,
		garbageCollectionHeadroomBytes: null,
	});
}

/** Use the workflow formula for one independently admitted worker job. */
export function planSpectralEditJobAdmission(
	input: SpectralEditJobAdmissionInput,
): Readonly<SpectralEditAdmissionPlan> {
	const candidate = input as Partial<SpectralEditJobAdmissionInput> | null;
	return planSpectralEditWorkflowAdmission({
		targets: [candidate as SpectralEditTargetGeometry],
		initialRetainedCompletedOutputBytes: candidate?.retainedCompletedOutputBytes,
		maximumUsefulBinaryBytes: candidate?.maximumUsefulBinaryBytes,
	});
}

/**
 * Inspects transferable planar PCM without copying it. Tight, distinct,
 * ordinary non-resizable ArrayBuffers make the inspected byte count the whole
 * retained backing payload and let the same check validate worker results.
 */
export function inspectSpectralEditChannels(
	input: unknown,
	options: SpectralEditChannelInspectionOptions = {},
): Readonly<InspectedSpectralEditChannels> {
	const label = inspectionLabel(options.label);
	if (!Array.isArray(input)) {
		throw new TypeError(`${label} must contain 1 to 32 channels.`);
	}
	const channelCount = input.length;
	if (!Number.isSafeInteger(channelCount)
		|| channelCount < 1
		|| channelCount > MAXIMUM_CHANNEL_COUNT) {
		throw new TypeError(`${label} must contain 1 to 32 channels.`);
	}
	const expectedChannelCount = optionalSafeIntegerRange(
		options.expectedChannelCount,
		1,
		MAXIMUM_CHANNEL_COUNT,
		`${label} expected channel count`,
	);
	if (expectedChannelCount !== null && channelCount !== expectedChannelCount) {
		throw new RangeError(`${label} channel count does not match its admitted geometry.`);
	}
	const expectedFrameCount = optionalSafeIntegerRange(
		options.expectedFrameCount,
		1,
		Number.MAX_SAFE_INTEGER,
		`${label} expected frame count`,
	);
	const buffers = new Set<ArrayBuffer>();
	const channels: Float32Array[] = [];
	let frameCount: number | null = null;
	for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
		const channel = input[channelIndex];
		if (!(channel instanceof Float32Array)) {
			throw new TypeError(`${label} channels must be non-empty, equally sized Float32Array values.`);
		}
		const geometry = intrinsicFloat32Geometry(channel, label);
		if (frameCount === null) frameCount = geometry.frameCount;
		if (geometry.frameCount < 1 || geometry.frameCount !== frameCount) {
			throw new TypeError(`${label} channels must be non-empty, equally sized Float32Array values.`);
		}
		const backing = intrinsicArrayBufferGeometry(geometry.buffer);
		if (!backing
			|| geometry.byteOffset !== 0
			|| geometry.byteLength !== geometry.frameCount * FLOAT32_BYTES
			|| geometry.byteLength !== backing.byteLength
			|| backing.resizable) {
			throw new TypeError(`${label} channels require tight ArrayBuffer backing.`);
		}
		if (buffers.has(backing.buffer)) {
			throw new TypeError(`${label} channels require distinct ArrayBuffer backing.`);
		}
		buffers.add(backing.buffer);
		channels.push(channel);
	}
	const admittedFrameCount = frameCount as number;
	if (expectedFrameCount !== null && admittedFrameCount !== expectedFrameCount) {
		throw new RangeError(`${label} frame count does not match its admitted geometry.`);
	}
	return Object.freeze({
		channels: Object.freeze(channels) as readonly Float32Array[],
		channelCount,
		frameCount: admittedFrameCount,
		byteLength: safeByteNumber(
			BigInt(channelCount) * BigInt(admittedFrameCount) * BigInt(FLOAT32_BYTES),
			`${label} byte length`,
		),
	});
}

/** Normalize a test seam without allowing the production ceiling to rise. */
export function normalizeSpectralEditMaximumUsefulBinaryBytes(
	value: unknown = MAXIMUM_SPECTRAL_EDIT_USEFUL_BINARY_BYTES,
): number {
	if (typeof value !== 'number'
		|| !Number.isSafeInteger(value)
		|| value < 0
		|| value > MAXIMUM_SPECTRAL_EDIT_USEFUL_BINARY_BYTES) {
		throw new RangeError(
			'Spectral edit maximum must be a non-negative safe integer no greater than '
			+ `${MAXIMUM_SPECTRAL_EDIT_USEFUL_BINARY_BYTES} bytes.`,
		);
	}
	return value;
}

function normalizeTargets(value: unknown): readonly Readonly<SpectralEditTargetGeometry>[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new RangeError('Spectral edit workflow must contain at least one target.');
	}
	return value.map((candidate: unknown, targetIndex) => normalizeTarget(candidate, targetIndex));
}

function normalizeTarget(value: unknown, targetIndex: number): Readonly<SpectralEditTargetGeometry> {
	const target = value as Partial<SpectralEditTargetGeometry> | null;
	const channelCount = safeIntegerRange(
		target?.channelCount,
		1,
		MAXIMUM_CHANNEL_COUNT,
		`Spectral edit target ${targetIndex} channel count`,
	);
	const frameCount = safeIntegerRange(
		target?.frameCount,
		1,
		Number.MAX_SAFE_INTEGER,
		`Spectral edit target ${targetIndex} frame count`,
	);
	const selectionFrameCount = safeIntegerRange(
		target?.selectionFrameCount,
		1,
		frameCount,
		`Spectral edit target ${targetIndex} selection frame count`,
	);
	const windowSize = safeIntegerRange(
		target?.windowSize,
		MINIMUM_WINDOW_SIZE,
		MAXIMUM_WINDOW_SIZE,
		`Spectral edit target ${targetIndex} window size`,
	);
	if ((windowSize & (windowSize - 1)) !== 0) {
		throw new RangeError(
			`Spectral edit target ${targetIndex} window size must be a power of two `
			+ `between ${MINIMUM_WINDOW_SIZE} and ${MAXIMUM_WINDOW_SIZE}.`,
		);
	}
	return Object.freeze({ channelCount, frameCount, selectionFrameCount, windowSize });
}

function inspectionLabel(value: unknown): string {
	if (value === undefined) return 'Spectral edit channels';
	if (typeof value !== 'string' || !value.trim()) {
		throw new TypeError('Spectral edit channel inspection label must be a non-empty string.');
	}
	return value;
}

function intrinsicFloat32Geometry(
	channel: Float32Array,
	label: string,
): Readonly<{
	frameCount: number;
	byteLength: number;
	byteOffset: number;
	buffer: unknown;
}> {
	try {
		const tag = TYPED_ARRAY_TAG_GETTER.call(channel);
		const frameCount = TYPED_ARRAY_LENGTH_GETTER.call(channel);
		const byteLength = TYPED_ARRAY_BYTE_LENGTH_GETTER.call(channel);
		const byteOffset = TYPED_ARRAY_BYTE_OFFSET_GETTER.call(channel);
		const buffer = TYPED_ARRAY_BUFFER_GETTER.call(channel);
		if (tag !== 'Float32Array'
			|| typeof frameCount !== 'number'
			|| typeof byteLength !== 'number'
			|| typeof byteOffset !== 'number') {
			throw new TypeError();
		}
		return { frameCount, byteLength, byteOffset, buffer };
	} catch {
		throw new TypeError(`${label} channels must be genuine Float32Array values.`);
	}
}

function intrinsicArrayBufferGeometry(input: unknown): Readonly<{
	buffer: ArrayBuffer;
	byteLength: number;
	resizable: boolean;
}> | null {
	if (!(input instanceof ArrayBuffer)) return null;
	try {
		const byteLength = ARRAY_BUFFER_BYTE_LENGTH_GETTER.call(input);
		const resizable = ARRAY_BUFFER_RESIZABLE_GETTER?.call(input) ?? false;
		if (typeof byteLength !== 'number' || typeof resizable !== 'boolean') return null;
		return { buffer: input, byteLength, resizable };
	} catch {
		return null;
	}
}

function intrinsicGetter(prototype: object, property: PropertyKey): (this: unknown) => unknown {
	const getter = Object.getOwnPropertyDescriptor(prototype, property)?.get;
	if (typeof getter !== 'function') throw new Error('Required binary intrinsic accessors are unavailable.');
	return getter;
}

function optionalIntrinsicGetter(
	prototype: object,
	property: PropertyKey,
): ((this: unknown) => unknown) | null {
	const getter = Object.getOwnPropertyDescriptor(prototype, property)?.get;
	return typeof getter === 'function' ? getter : null;
}

function optionalSafeIntegerRange(
	value: unknown,
	minimum: number,
	maximum: number,
	field: string,
): number | null {
	return value === undefined ? null : safeIntegerRange(value, minimum, maximum, field);
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

function nonNegativeSafeInteger(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${field} must be a finite non-negative safe integer.`);
	}
	return value;
}

function safeByteNumber(value: bigint, field: string): number {
	if (value < 0n || value > MAXIMUM_SAFE_BYTES) {
		throw new RangeError(`${field} exceeds the supported safe integer range.`);
	}
	return Number(value);
}

function bound(
	bytes: number,
	scope: SpectralEditUsefulBinaryScope,
): Readonly<SpectralEditUsefulBinaryBound> {
	return Object.freeze({ bytes, certainty: 'upper-bound', scope });
}
